create or replace function public.adjust_owned_paper_answer_time(
  p_assignment_id uuid,
  p_student_ids uuid[],
  p_delta_seconds integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_duration integer;
  v_updated integer;
begin
  if v_user is null or not exists (
    select 1 from public.profiles where id = v_user and role = 'teacher'
  ) then
    raise exception 'Only authenticated teachers can manage paper tests';
  end if;
  if p_delta_seconds is null or p_delta_seconds = 0 or p_delta_seconds not between -3600 and 3600 then
    raise exception 'Time adjustment must be between minus and plus 3600 seconds';
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
    and status in ('published', 'closed');
  if not found then raise exception 'Paper test is not available to manage'; end if;

  if exists (
    select 1
    from unnest(p_student_ids) requested(id)
    left join public.assignment_student_paper_time adjustment
      on adjustment.assignment_id = p_assignment_id
     and adjustment.student_id = requested.id
    where v_duration + coalesce(adjustment.adjustment_seconds, 0) + p_delta_seconds not between 10 and 7200
       or not exists (
         select 1
         from public.assignment_classes assignment_class
         join public.class_members member on member.class_id = assignment_class.class_id
         where assignment_class.assignment_id = p_assignment_id
           and member.student_id = requested.id
       )
  ) then
    raise exception 'The requested time would be outside the allowed range';
  end if;

  insert into public.assignment_student_paper_time (assignment_id, student_id, adjustment_seconds)
  select p_assignment_id, requested.id, p_delta_seconds
  from unnest(p_student_ids) requested(id)
  on conflict (assignment_id, student_id) do update
  set adjustment_seconds = public.assignment_student_paper_time.adjustment_seconds + excluded.adjustment_seconds,
      updated_at = now();
  get diagnostics v_updated = row_count;

  update public.attempts
  set expires_at = case
    when p_delta_seconds > 0
      then greatest(now(), expires_at) + make_interval(secs => p_delta_seconds)
    else greatest(now(), expires_at + make_interval(secs => p_delta_seconds))
  end
  where assignment_id = p_assignment_id
    and student_id = any(p_student_ids)
    and expires_at is not null;

  insert into public.attempt_exam_events (attempt_id, event_type)
  select attempt.id, 'teacher_extra_time'
  from public.attempts attempt
  where attempt.assignment_id = p_assignment_id
    and attempt.student_id = any(p_student_ids)
    and attempt.status = 'in_progress';

  return v_updated;
end;
$$;

create or replace function public.unsubmit_owned_test_attempt(
  p_assignment_id uuid,
  p_attempt_id uuid
)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.attempts;
begin
  if v_user is null or not exists (
    select 1 from public.profiles where id = v_user and role = 'teacher'
  ) then
    raise exception 'Only authenticated teachers can manage assessments';
  end if;

  select attempt.*
  into v_attempt
  from public.attempts attempt
  join public.assignments assignment on assignment.id = attempt.assignment_id
  where attempt.id = p_attempt_id
    and attempt.assignment_id = p_assignment_id
    and attempt.status = 'submitted'
    and assignment.created_by = v_user
    and (
      (assignment.kind = 'test' and assignment.status = 'published')
      or (assignment.kind = 'paper' and assignment.status in ('published', 'closed'))
    )
  for update of attempt;
  if not found then raise exception 'Submitted assessment attempt is not available'; end if;

  update public.responses
  set is_correct = null,
      points_awarded = null,
      updated_at = now()
  where attempt_id = p_attempt_id;

  update public.attempts
  set status = 'in_progress',
      submitted_at = null,
      score = null,
      max_score = null
  where id = p_attempt_id
  returning * into v_attempt;

  insert into public.attempt_exam_events (attempt_id, event_type)
  values (p_attempt_id, 'teacher_unsubmitted');
  return v_attempt;
end;
$$;

create or replace function public.force_submit_owned_test_attempt(
  p_assignment_id uuid,
  p_attempt_id uuid
)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.attempts;
begin
  if v_user is null or not exists (
    select 1 from public.profiles where id = v_user and role = 'teacher'
  ) then
    raise exception 'Only authenticated teachers can manage assessments';
  end if;

  select attempt.*
  into v_attempt
  from public.attempts attempt
  join public.assignments assignment on assignment.id = attempt.assignment_id
  where attempt.id = p_attempt_id
    and attempt.assignment_id = p_assignment_id
    and attempt.status = 'in_progress'
    and assignment.created_by = v_user
    and assignment.kind in ('test', 'paper')
    and (assignment.kind = 'test' or assignment.status in ('published', 'closed'))
  for update of attempt;
  if not found then raise exception 'Active assessment attempt is not available'; end if;

  select * into v_attempt from public.finalize_attempt_unchecked(p_attempt_id);
  insert into public.attempt_exam_events (attempt_id, event_type)
  values (p_attempt_id, 'teacher_submitted');
  return v_attempt;
end;
$$;

create or replace function public.force_submit_all_owned_assessment_attempts(p_assignment_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_attempt_id uuid;
  v_submitted integer := 0;
begin
  if v_user is null or not exists (
    select 1 from public.profiles where id = v_user and role = 'teacher'
  ) then
    raise exception 'Only authenticated teachers can manage assessments';
  end if;
  if not exists (
    select 1
    from public.assignments
    where id = p_assignment_id
      and created_by = v_user
      and kind in ('test', 'paper')
      and (kind = 'test' or status in ('published', 'closed'))
  ) then
    raise exception 'Assessment is not available to submit';
  end if;

  for v_attempt_id in
    select id
    from public.attempts
    where assignment_id = p_assignment_id
      and status = 'in_progress'
    order by started_at, id
    for update skip locked
  loop
    perform public.finalize_attempt_unchecked(v_attempt_id);
    insert into public.attempt_exam_events (attempt_id, event_type)
    values (v_attempt_id, 'teacher_submitted');
    v_submitted := v_submitted + 1;
  end loop;
  return v_submitted;
end;
$$;

revoke all on function public.adjust_owned_paper_answer_time(uuid, uuid[], integer) from public, anon;
revoke all on function public.unsubmit_owned_test_attempt(uuid, uuid) from public, anon;
revoke all on function public.force_submit_owned_test_attempt(uuid, uuid) from public, anon;
revoke all on function public.force_submit_all_owned_assessment_attempts(uuid) from public, anon;

grant execute on function public.adjust_owned_paper_answer_time(uuid, uuid[], integer) to authenticated;
grant execute on function public.unsubmit_owned_test_attempt(uuid, uuid) to authenticated;
grant execute on function public.force_submit_owned_test_attempt(uuid, uuid) to authenticated;
grant execute on function public.force_submit_all_owned_assessment_attempts(uuid) to authenticated;
