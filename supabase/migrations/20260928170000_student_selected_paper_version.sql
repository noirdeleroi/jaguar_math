alter table public.attempts
  add column if not exists paper_version_confirmed_at timestamptz;

-- Paper attempts enter a pending state until the student copies the version
-- number printed on their physical paper. Online tests keep their existing
-- system-assigned question selection behavior.
create or replace function public.start_attempt(p_assignment_id uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.attempts;
  v_assignment public.assignments;
  v_extra_minutes integer;
  v_delta integer;
  v_adjustment_seconds integer;
begin
  select * into v_assignment from public.assignments where id = p_assignment_id;
  if v_assignment.id is null then raise exception 'Assignment is not available'; end if;

  if v_assignment.kind = 'test'
     and v_assignment.status = 'published'
     and v_assignment.teacher_controlled_question_release
     and v_assignment.questions_released_at is null
     and exists (
       select 1
       from public.assignment_classes assignment_class
       join public.class_members member on member.class_id = assignment_class.class_id
       where assignment_class.assignment_id = v_assignment.id
         and member.student_id = auth.uid()
     ) then
    raise exception 'Assessment has not been released';
  end if;

  select * into v_attempt from public.start_attempt_before_teacher_release(p_assignment_id);

  if v_assignment.kind = 'paper'
     and v_attempt.paper_version_confirmed_at is null
     and not exists (select 1 from public.responses where attempt_id = v_attempt.id) then
    update public.attempts
    set form_code = null
    where id = v_attempt.id
    returning * into v_attempt;
    delete from public.attempt_questions where attempt_id = v_attempt.id;
  end if;

  if v_assignment.kind = 'test' then
    select coalesce(adjustment.extra_minutes, 0) into v_extra_minutes
    from public.assignment_student_test_time adjustment
    where adjustment.assignment_id = p_assignment_id
      and adjustment.student_id = auth.uid();
    v_extra_minutes := coalesce(v_extra_minutes, 0);
    v_delta := greatest(0, v_extra_minutes - coalesce(v_attempt.teacher_extra_minutes, 0));
    if v_delta > 0 then
      update public.attempts
      set expires_at = case when expires_at is null then null else expires_at + make_interval(mins => v_delta) end,
          teacher_extra_minutes = v_extra_minutes
      where id = v_attempt.id returning * into v_attempt;
    end if;
  elsif v_assignment.kind = 'paper' then
    select coalesce(adjustment.adjustment_seconds, 0) into v_adjustment_seconds
    from public.assignment_student_paper_time adjustment
    where adjustment.assignment_id = p_assignment_id
      and adjustment.student_id = auth.uid();
    v_adjustment_seconds := coalesce(v_adjustment_seconds, 0);
    update public.attempts
    set expires_at = case when v_assignment.questions_released_at is null then null
      else v_assignment.questions_released_at + make_interval(secs => greatest(10, v_assignment.paper_answer_duration_seconds + v_adjustment_seconds)) end,
        teacher_extra_minutes = 0
    where id = v_attempt.id returning * into v_attempt;
  end if;
  return v_attempt;
end;
$$;

create function public.start_my_paper_attempt(
  p_assignment_id uuid,
  p_version integer
)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.attempts;
  v_version_count integer;
  v_existing_version integer;
  v_response_count integer;
begin
  if v_user is null or not exists (
    select 1 from public.profiles where id = v_user and role = 'student'
  ) then
    raise exception 'Only authenticated students can choose a paper version';
  end if;

  if not exists (
    select 1
    from public.assignments assignment
    join public.assignment_classes assignment_class on assignment_class.assignment_id = assignment.id
    join public.class_members member on member.class_id = assignment_class.class_id
    where assignment.id = p_assignment_id
      and assignment.kind = 'paper'
      and assignment.status = 'published'
      and member.student_id = v_user
  ) then raise exception 'Paper test is not available'; end if;

  select greatest(1, coalesce(max(variant.variant_index), 1))
  into v_version_count
  from public.assignment_question_variants variant
  where variant.assignment_id = p_assignment_id;

  if p_version is null or p_version < 1 or p_version > v_version_count then
    raise exception 'Choose a paper version between 1 and %', v_version_count;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_assignment_id::text), hashtext(v_user::text));
  select * into v_attempt
  from public.attempts
  where assignment_id = p_assignment_id
    and student_id = v_user
    and status = 'in_progress'
  order by attempt_number desc, started_at desc, id desc
  limit 1
  for update;

  if not found then
    select * into v_attempt from public.start_attempt(p_assignment_id);
  end if;

  v_existing_version := case
    when v_attempt.form_code ~ '^Version [1-4]$'
      then substring(v_attempt.form_code from '[1-4]$')::integer
    else null
  end;
  select count(*)::integer into v_response_count
  from public.responses where attempt_id = v_attempt.id;

  if v_response_count > 0 and v_existing_version is distinct from p_version then
    raise exception 'The paper version cannot change after answers are saved';
  end if;

  if v_response_count = 0 and (
    v_attempt.paper_version_confirmed_at is null
    or v_existing_version is distinct from p_version
  ) then
    delete from public.attempt_questions where attempt_id = v_attempt.id;
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
      where candidate.variant_index = p_version
      limit 1
    ) chosen
    join public.questions source on source.id = chosen.question_id
    where question.assignment_id = p_assignment_id
    order by question.position;
  end if;

  update public.attempts
  set form_code = 'Version ' || p_version::text,
      paper_version_confirmed_at = coalesce(paper_version_confirmed_at, now())
  where id = v_attempt.id
  returning * into v_attempt;
  return v_attempt;
end;
$$;

drop function public.get_my_paper_session_state(uuid);

create function public.get_my_paper_session_state(p_assignment_id uuid)
returns table (
  server_now timestamptz,
  writing_started_at timestamptz,
  writing_ends_at timestamptz,
  writing_paused_at timestamptz,
  answers_released_at timestamptz,
  answer_ends_at timestamptz,
  answer_duration_seconds integer,
  paper_version_count integer,
  paper_version_confirmed boolean,
  attempt_id uuid,
  attempt_status text,
  form_code text,
  focus_violations integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select now(), assignment.paper_started_at, assignment.paper_writing_ends_at,
         assignment.paper_writing_paused_at, effective.release_at,
         case when effective.release_at is null then null
           else coalesce(attempt.expires_at, effective.release_at + make_interval(secs => effective.duration_seconds))
         end,
         effective.duration_seconds, versions.version_count,
         attempt.paper_version_confirmed_at is not null,
         attempt.id, attempt.status, attempt.form_code,
         coalesce(attempt.exam_focus_violations, 0)
  from public.assignments assignment
  left join public.assignment_student_paper_time adjustment
    on adjustment.assignment_id = assignment.id
   and adjustment.student_id = auth.uid()
  cross join lateral (
    select coalesce(adjustment.answers_released_at, assignment.questions_released_at) as release_at,
           greatest(10, assignment.paper_answer_duration_seconds + coalesce(adjustment.adjustment_seconds, 0))::integer as duration_seconds
  ) effective
  cross join lateral (
    select greatest(1, coalesce(max(variant.variant_index), 1))::integer as version_count
    from public.assignment_question_variants variant
    where variant.assignment_id = assignment.id
  ) versions
  left join lateral (
    select candidate.id, candidate.status, candidate.expires_at, candidate.form_code,
           candidate.paper_version_confirmed_at, candidate.exam_focus_violations
    from public.attempts candidate
    where candidate.assignment_id = assignment.id
      and candidate.student_id = auth.uid()
    order by candidate.attempt_number desc, candidate.started_at desc, candidate.id desc
    limit 1
  ) attempt on true
  where assignment.id = p_assignment_id
    and assignment.kind = 'paper'
    and assignment.status in ('published', 'closed')
    and exists (
      select 1 from public.assignment_classes assignment_class
      join public.class_members member on member.class_id = assignment_class.class_id
      where assignment_class.assignment_id = assignment.id
        and member.student_id = auth.uid()
    );
$$;

revoke all on function public.start_attempt(uuid) from public, anon;
revoke all on function public.start_my_paper_attempt(uuid, integer) from public, anon;
revoke all on function public.get_my_paper_session_state(uuid) from public, anon;

grant execute on function public.start_attempt(uuid) to authenticated;
grant execute on function public.start_my_paper_attempt(uuid, integer) to authenticated;
grant execute on function public.get_my_paper_session_state(uuid) to authenticated;
