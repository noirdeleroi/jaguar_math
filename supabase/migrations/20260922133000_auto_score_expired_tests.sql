-- Grade saved Test answers when the effective deadline has passed, even if
-- the student's browser did not deliver its final submission request.

create function public.finalize_expired_test_attempts(
  p_assignment_id uuid default null
)
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
    raise exception 'Only authenticated students and teachers can finalize expired tests';
  end if;

  for v_attempt_id in
    select attempt.id
    from public.attempts attempt
    join public.assignments assignment on assignment.id = attempt.assignment_id
    where attempt.status = 'in_progress'
      and assignment.kind = 'test'
      and assignment.status in ('published', 'closed')
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

-- Teachers may also explicitly score any still-open Test they own, including
-- a preserved attempt on a Test that has since been closed or archived.
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
    raise exception 'Only authenticated teachers can manage tests';
  end if;

  select attempt.* into v_attempt
  from public.attempts attempt
  join public.assignments assignment on assignment.id = attempt.assignment_id
  where attempt.id = p_attempt_id
    and attempt.assignment_id = p_assignment_id
    and attempt.status = 'in_progress'
    and assignment.created_by = v_user
    and assignment.kind = 'test'
  for update of attempt;
  if not found then raise exception 'Active Test attempt is not available'; end if;

  select * into v_attempt from public.finalize_attempt_unchecked(p_attempt_id);
  insert into public.attempt_exam_events (attempt_id, event_type)
  values (p_attempt_id, 'teacher_submitted');
  return v_attempt;
end;
$$;

revoke all on function public.finalize_expired_test_attempts(uuid) from public, anon;
grant execute on function public.finalize_expired_test_attempts(uuid) to authenticated;
revoke all on function public.force_submit_owned_test_attempt(uuid, uuid) from public, anon;
grant execute on function public.force_submit_owned_test_attempt(uuid, uuid) to authenticated;
