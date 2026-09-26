alter table public.assignment_student_paper_time
  add column if not exists answers_released_at timestamptz;

create or replace function public.release_owned_paper_answers_for_students(
  p_assignment_id uuid,
  p_student_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_duration integer;
  v_opened integer := 0;
  v_student_id uuid;
begin
  if v_user is null or not exists (
    select 1 from public.profiles where id = v_user and role = 'teacher'
  ) then
    raise exception 'Only authenticated teachers can release paper answers';
  end if;
  if p_student_ids is null or cardinality(p_student_ids) < 1 or cardinality(p_student_ids) > 1000
     or cardinality(p_student_ids) <> (
       select count(distinct requested.id)::integer from unnest(p_student_ids) requested(id)
     ) then
    raise exception 'Select unique students';
  end if;

  select paper_answer_duration_seconds
  into v_duration
  from public.assignments
  where id = p_assignment_id
    and created_by = v_user
    and kind = 'paper'
    and status = 'published';
  if not found then raise exception 'Paper test is not available to release'; end if;

  if exists (
    select 1
    from unnest(p_student_ids) requested(id)
    where not exists (
      select 1
      from public.assignment_classes assignment_class
      join public.class_members member on member.class_id = assignment_class.class_id
      where assignment_class.assignment_id = p_assignment_id
        and member.student_id = requested.id
    )
  ) then
    raise exception 'Every selected student must be assigned to this paper test';
  end if;

  insert into public.assignment_student_paper_time (
    assignment_id, student_id, adjustment_seconds, answers_released_at
  )
  select p_assignment_id, requested.id, 0, now()
  from unnest(p_student_ids) requested(id)
  on conflict (assignment_id, student_id) do update
  set answers_released_at = excluded.answers_released_at,
      updated_at = now()
  where public.assignment_student_paper_time.answers_released_at is null;
  get diagnostics v_opened = row_count;

  foreach v_student_id in array p_student_ids loop
    perform public.prepare_owned_paper_answer_entry(p_assignment_id, v_student_id);
  end loop;

  update public.attempts attempt
  set expires_at = coalesce(adjustment.answers_released_at, assignment.questions_released_at)
    + make_interval(secs => greatest(10, v_duration + adjustment.adjustment_seconds))
  from public.assignment_student_paper_time adjustment,
       public.assignments assignment
  where attempt.assignment_id = p_assignment_id
    and attempt.student_id = adjustment.student_id
    and adjustment.assignment_id = p_assignment_id
    and adjustment.student_id = any(p_student_ids)
    and assignment.id = p_assignment_id
    and attempt.status = 'in_progress'
    and coalesce(adjustment.answers_released_at, assignment.questions_released_at) is not null;

  return v_opened;
end;
$$;

create or replace function public.get_my_paper_session_state(p_assignment_id uuid)
returns table (
  server_now timestamptz,
  writing_started_at timestamptz,
  writing_ends_at timestamptz,
  answers_released_at timestamptz,
  answer_ends_at timestamptz,
  answer_duration_seconds integer,
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
         effective.release_at,
         case when effective.release_at is null then null
           else coalesce(attempt.expires_at, effective.release_at + make_interval(secs => effective.duration_seconds))
         end,
         effective.duration_seconds, attempt.id, attempt.status,
         attempt.form_code, coalesce(attempt.exam_focus_violations, 0)
  from public.assignments assignment
  left join public.assignment_student_paper_time adjustment
    on adjustment.assignment_id = assignment.id
   and adjustment.student_id = auth.uid()
  cross join lateral (
    select coalesce(adjustment.answers_released_at, assignment.questions_released_at) as release_at,
           greatest(10, assignment.paper_answer_duration_seconds + coalesce(adjustment.adjustment_seconds, 0))::integer as duration_seconds
  ) effective
  left join lateral (
    select candidate.id, candidate.status, candidate.expires_at, candidate.form_code,
           candidate.exam_focus_violations
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
      select 1
      from public.assignment_classes assignment_class
      join public.class_members member on member.class_id = assignment_class.class_id
      where assignment_class.assignment_id = assignment.id
        and member.student_id = auth.uid()
    );
$$;

drop function if exists public.get_owned_paper_roster(uuid, uuid);
create function public.get_owned_paper_roster(p_assignment_id uuid, p_class_id uuid default null)
returns table (
  student_id uuid, attempt_id uuid, attempt_number integer, status text,
  started_at timestamptz, submitted_at timestamptz, expires_at timestamptz,
  answer_adjustment_seconds integer, answers_released_at timestamptz,
  answer_duration_seconds integer, answered_count integer, total_questions integer,
  last_activity_at timestamptz, focus_violations integer, form_code text,
  offline_recovery_used boolean, offline_recovery_seconds integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not exists (
    select 1 from public.profiles where id = v_user and role = 'teacher'
  ) then
    raise exception 'Only authenticated teachers can manage paper tests';
  end if;
  if not exists (
    select 1 from public.assignments
    where id = p_assignment_id and created_by = v_user and kind = 'paper'
  ) then
    raise exception 'Paper test is not managed by this teacher';
  end if;
  if p_class_id is not null and not exists (
    select 1
    from public.assignment_classes assignment_class
    join public.classes classroom on classroom.id = assignment_class.class_id
    where assignment_class.assignment_id = p_assignment_id
      and assignment_class.class_id = p_class_id
      and classroom.teacher_id = v_user
  ) then
    raise exception 'Class results are not available';
  end if;

  return query
  with expected_students as (
    select distinct member.student_id
    from public.assignment_classes assignment_class
    join public.class_members member on member.class_id = assignment_class.class_id
    where assignment_class.assignment_id = p_assignment_id
      and (p_class_id is null or assignment_class.class_id = p_class_id)
  ), assignment_details as (
    select assignment.paper_answer_duration_seconds,
           assignment.questions_released_at,
           (select count(*)::integer from public.assignment_questions question where question.assignment_id = assignment.id) as question_count
    from public.assignments assignment
    where assignment.id = p_assignment_id
  )
  select expected.student_id, attempt.id, attempt.attempt_number,
         coalesce(attempt.status, 'not_started'), attempt.started_at,
         attempt.submitted_at, attempt.expires_at,
         coalesce(time_adjustment.adjustment_seconds, 0),
         coalesce(time_adjustment.answers_released_at, details.questions_released_at),
         greatest(10, details.paper_answer_duration_seconds + coalesce(time_adjustment.adjustment_seconds, 0))::integer,
         coalesce(progress.answered_count, 0),
         coalesce(progress.total_questions, details.question_count),
         progress.last_activity_at, coalesce(attempt.exam_focus_violations, 0),
         attempt.form_code, coalesce(attempt.offline_recovery_used, false),
         coalesce(attempt.offline_recovery_seconds, 0)
  from expected_students expected
  cross join assignment_details details
  left join lateral (
    select candidate.*
    from public.attempts candidate
    where candidate.assignment_id = p_assignment_id
      and candidate.student_id = expected.student_id
    order by candidate.attempt_number desc, candidate.started_at desc, candidate.id desc
    limit 1
  ) attempt on true
  left join lateral (
    select count(question.question_id)::integer as total_questions,
           count(response.id) filter (where nullif(btrim(response.student_answer), '') is not null)::integer as answered_count,
           max(response.updated_at) as last_activity_at
    from public.attempt_questions question
    left join public.responses response
      on response.attempt_id = question.attempt_id
     and response.question_id = question.question_id
    where question.attempt_id = attempt.id
  ) progress on attempt.id is not null
  left join public.assignment_student_paper_time time_adjustment
    on time_adjustment.assignment_id = p_assignment_id
   and time_adjustment.student_id = expected.student_id
  order by expected.student_id;
end;
$$;

create or replace function public.get_my_paper_answer_sheet(p_attempt_id uuid)
returns table (question_id uuid, answer_position integer, points numeric, question_type text, option_ids text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not exists (
    select 1
    from public.attempts attempt
    join public.assignments assignment on assignment.id = attempt.assignment_id
    left join public.assignment_student_paper_time adjustment
      on adjustment.assignment_id = assignment.id
     and adjustment.student_id = attempt.student_id
    where attempt.id = p_attempt_id
      and attempt.student_id = v_user
      and attempt.status = 'in_progress'
      and assignment.kind = 'paper'
      and assignment.status = 'published'
      and coalesce(adjustment.answers_released_at, assignment.questions_released_at) is not null
  ) then
    raise exception 'Paper answer sheet is not available';
  end if;
  return query
  select attempt_question.question_id, attempt_question.position, attempt_question.points,
         question.type,
         case when question.type = 'multiple_choice' then attempt_question.option_order else '{}'::text[] end
  from public.attempt_questions attempt_question
  join public.questions question on question.id = attempt_question.question_id
  where attempt_question.attempt_id = p_attempt_id
  order by attempt_question.position;
end;
$$;

create or replace function public.finalize_expired_test_attempts(p_assignment_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_attempt_id uuid;
  v_finalized integer := 0;
begin
  select profile.role into v_role
  from public.profiles profile
  where profile.id = v_user;
  if v_user is null or v_role not in ('student', 'teacher') then
    raise exception 'Only authenticated students and teachers can finalize expired assessments';
  end if;

  for v_attempt_id in
    select attempt.id
    from public.attempts attempt
    join public.assignments assignment on assignment.id = attempt.assignment_id
    left join public.assignment_student_paper_time adjustment
      on adjustment.assignment_id = assignment.id
     and adjustment.student_id = attempt.student_id
    where attempt.status = 'in_progress'
      and assignment.kind in ('test', 'paper')
      and assignment.status in ('published', 'closed')
      and (
        assignment.kind = 'test'
        or coalesce(adjustment.answers_released_at, assignment.questions_released_at) is not null
      )
      and (p_assignment_id is null or assignment.id = p_assignment_id)
      and public.effective_attempt_deadline(attempt.id) is not null
      and public.effective_attempt_deadline(attempt.id) <= now()
      and (
        (v_role = 'student' and attempt.student_id = v_user)
        or (v_role = 'teacher' and assignment.created_by = v_user)
      )
    order by attempt.started_at, attempt.id
    for update of attempt skip locked
  loop
    perform public.finalize_attempt_unchecked(v_attempt_id);
    insert into public.attempt_exam_events (attempt_id, event_type)
    values (v_attempt_id, 'time_expired');
    v_finalized := v_finalized + 1;
  end loop;
  return v_finalized;
end;
$$;

revoke all on function public.release_owned_paper_answers_for_students(uuid, uuid[]) from public, anon;
revoke all on function public.get_my_paper_session_state(uuid) from public, anon;
revoke all on function public.get_owned_paper_roster(uuid, uuid) from public, anon;
revoke all on function public.get_my_paper_answer_sheet(uuid) from public, anon;
revoke all on function public.finalize_expired_test_attempts(uuid) from public, anon;

grant execute on function public.release_owned_paper_answers_for_students(uuid, uuid[]) to authenticated;
grant execute on function public.get_my_paper_session_state(uuid) to authenticated;
grant execute on function public.get_owned_paper_roster(uuid, uuid) to authenticated;
grant execute on function public.get_my_paper_answer_sheet(uuid) to authenticated;
grant execute on function public.finalize_expired_test_attempts(uuid) to authenticated;
