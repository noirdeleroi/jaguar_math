-- Homework answers are immutable after their effective deadline, so finalize
-- any still-open attempt when a teacher or the owning student next loads it.
-- This keeps results complete without applying the behavior to quizzes/tests.

create function public.finalize_overdue_homework_attempts(
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
    raise exception 'Only authenticated students and teachers can finalize overdue homework';
  end if;

  for v_attempt_id in
    select attempt.id
    from public.attempts attempt
    join public.assignments assignment on assignment.id = attempt.assignment_id
    where attempt.status = 'in_progress'
      and assignment.status = 'published'
      and assignment.kind = 'homework'
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
    v_finalized := v_finalized + 1;
  end loop;

  return v_finalized;
end;
$$;

revoke all on function public.finalize_overdue_homework_attempts(uuid) from public, anon;
grant execute on function public.finalize_overdue_homework_attempts(uuid) to authenticated;
