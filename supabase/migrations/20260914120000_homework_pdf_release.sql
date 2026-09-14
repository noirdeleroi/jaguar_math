-- Teacher-controlled printable homework packets. The answer key remains behind
-- a security-definer function and is released only after the homework deadline.

alter table public.assignments
  add column homework_pdf_released_at timestamptz;

alter table public.assignments
  add constraint assignments_homework_pdf_release_check
  check (homework_pdf_released_at is null or kind = 'homework');

create function public.set_owned_homework_pdf_release(
  p_assignment_id uuid,
  p_released boolean
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_assignment public.assignments;
  v_released_at timestamptz;
begin
  if v_user is null or not exists (
    select 1 from public.profiles where id = v_user and role = 'teacher'
  ) then
    raise exception 'Only authenticated teachers can release homework PDFs';
  end if;

  select * into v_assignment
  from public.assignments
  where id = p_assignment_id and created_by = v_user;

  if not found then raise exception 'Assignment is not managed by this teacher'; end if;
  if v_assignment.kind <> 'homework' then raise exception 'PDF release is available only for homework'; end if;
  if v_assignment.status = 'draft' then raise exception 'Publish the homework before releasing its PDF'; end if;
  if v_assignment.due_at is null then raise exception 'Add a homework deadline before releasing its PDF'; end if;

  update public.assignments
  set homework_pdf_released_at = case
    when p_released then coalesce(homework_pdf_released_at, now())
    else null
  end
  where id = p_assignment_id and created_by = v_user
  returning homework_pdf_released_at into v_released_at;

  return v_released_at;
end;
$$;

create function public.get_assignment_pdf_material(p_assignment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_assignment public.assignments;
  v_authorized boolean := false;
  v_questions jsonb;
begin
  if v_user is null then raise exception 'Authentication is required'; end if;

  select role into v_role from public.profiles where id = v_user;
  select * into v_assignment from public.assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment is not available'; end if;

  if v_role = 'teacher' and v_assignment.created_by = v_user then
    v_authorized := true;
  elsif v_role = 'student'
    and v_assignment.kind = 'homework'
    and v_assignment.status in ('published', 'closed')
    and v_assignment.due_at is not null
    and v_assignment.due_at <= now()
    and v_assignment.homework_pdf_released_at is not null
    and v_assignment.homework_pdf_released_at <= now()
    and exists (
      select 1
      from public.assignment_classes assignment_class
      join public.class_members member on member.class_id = assignment_class.class_id
      where assignment_class.assignment_id = v_assignment.id
        and member.student_id = v_user
    )
  then
    v_authorized := true;
  end if;

  if not v_authorized then raise exception 'Assignment PDF is not available'; end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'position', material.position,
      'variant_index', material.variant_index,
      'prompt', question.prompt,
      'type', question.type,
      'options', question.options,
      'points', material.points,
      'correct_answer', answer_key.correct_answer,
      'numeric_tolerance', answer_key.numeric_tolerance,
      'explanation', answer_key.explanation
    ) order by material.position, material.variant_index
  ), '[]'::jsonb)
  into v_questions
  from (
    select assignment_question.position, 1 as variant_index,
           assignment_question.question_id, assignment_question.points
    from public.assignment_questions assignment_question
    where assignment_question.assignment_id = v_assignment.id
    union all
    select variant.slot_position, variant.variant_index,
           variant.question_id, assignment_question.points
    from public.assignment_question_variants variant
    join public.assignment_questions assignment_question
      on assignment_question.assignment_id = variant.assignment_id
     and assignment_question.position = variant.slot_position
    where variant.assignment_id = v_assignment.id
  ) material
  join public.questions question on question.id = material.question_id
  join public.question_keys answer_key on answer_key.question_id = material.question_id;

  return jsonb_build_object(
    'title', v_assignment.title,
    'description', v_assignment.description,
    'kind', v_assignment.kind,
    'due_at', v_assignment.due_at,
    'questions', v_questions
  );
end;
$$;

revoke all on function public.set_owned_homework_pdf_release(uuid, boolean) from public, anon;
revoke all on function public.get_assignment_pdf_material(uuid) from public, anon;
grant execute on function public.set_owned_homework_pdf_release(uuid, boolean) to authenticated;
grant execute on function public.get_assignment_pdf_material(uuid) to authenticated;
