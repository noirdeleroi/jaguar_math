-- Teacher transcription is independent of the student's timed answer window.
-- An owning teacher may prepare a sheet for any assigned student as soon as a
-- Paper test is published, while student write permissions remain unchanged.

create or replace function public.prepare_owned_paper_answer_entry(
  p_assignment_id uuid,
  p_student_id uuid
)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_assignment public.assignments;
  v_attempt public.attempts;
  v_version_count integer;
  v_paper_version integer;
  v_adjustment_seconds integer;
begin
  if v_user is null or not exists (
    select 1 from public.profiles where id = v_user and role = 'teacher'
  ) then
    raise exception 'Only authenticated teachers can enter paper answers';
  end if;

  select * into v_assignment
  from public.assignments
  where id = p_assignment_id
    and created_by = v_user
    and kind = 'paper'
    and status in ('published', 'closed');
  if not found then raise exception 'Paper answer entry is not available'; end if;

  if not exists (
    select 1
    from public.assignment_classes assignment_class
    join public.class_members member on member.class_id = assignment_class.class_id
    where assignment_class.assignment_id = p_assignment_id
      and member.student_id = p_student_id
  ) then raise exception 'Student is not assigned to this paper test'; end if;

  perform pg_advisory_xact_lock(hashtext(p_assignment_id::text), hashtext(p_student_id::text));
  select * into v_attempt
  from public.attempts
  where assignment_id = p_assignment_id and student_id = p_student_id
  order by attempt_number desc, started_at desc, id desc
  limit 1;
  if found then return v_attempt; end if;

  select coalesce(adjustment.adjustment_seconds, 0)
  into v_adjustment_seconds
  from public.assignment_student_paper_time adjustment
  where adjustment.assignment_id = p_assignment_id
    and adjustment.student_id = p_student_id;
  v_adjustment_seconds := coalesce(v_adjustment_seconds, 0);

  insert into public.attempts (
    assignment_id, student_id, attempt_number, expires_at
  ) values (
    p_assignment_id,
    p_student_id,
    1,
    coalesce(v_assignment.questions_released_at, now()) + make_interval(
      secs => greatest(10, v_assignment.paper_answer_duration_seconds + v_adjustment_seconds)
    )
  ) returning * into v_attempt;

  select greatest(1, coalesce(max(variant.variant_index), 1))
  into v_version_count
  from public.assignment_question_variants variant
  where variant.assignment_id = p_assignment_id;
  v_paper_version := 1 + mod(
    get_byte(decode(md5(v_attempt.id::text), 'hex'), 0),
    v_version_count
  );

  update public.attempts
  set form_code = 'Version ' || v_paper_version::text
  where id = v_attempt.id
  returning * into v_attempt;

  insert into public.attempt_questions (
    attempt_id, question_id, position, slot_position, points, option_order
  )
  select v_attempt.id, chosen.question_id, question.position,
         question.position, question.points,
         coalesce((
           select array_agg(option_item.value ->> 'id' order by option_item.ordinality)
           from jsonb_array_elements(coalesce(source.options, '[]'::jsonb))
             with ordinality as option_item(value, ordinality)
         ), '{}'::text[])
  from public.assignment_questions question
  cross join lateral (
    select candidate.question_id
    from (
      select question.question_id, 1 as variant_index
      union all
      select variant.question_id, variant.variant_index
      from public.assignment_question_variants variant
      where variant.assignment_id = question.assignment_id
        and variant.slot_position = question.position
    ) candidate
    where candidate.variant_index = v_paper_version
    limit 1
  ) chosen
  join public.questions source on source.id = chosen.question_id
  where question.assignment_id = p_assignment_id
  order by question.position;

  return v_attempt;
end;
$$;
