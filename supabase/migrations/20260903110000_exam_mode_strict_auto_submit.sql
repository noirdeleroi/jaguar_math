-- Exam Mode focus exits are tolerated up to the configured limit. The next
-- confirmed violation always submits the attempt; the legacy action column is
-- retained only for compatibility with already-created assignments.

alter table public.assignments
  alter column exam_violation_action set default 'auto_submit';

create or replace function public.record_exam_activity(
  p_attempt_id uuid,
  p_client_event_id uuid,
  p_event_type text,
  p_away_duration_seconds integer default null
)
returns table(focus_violations integer, auto_submitted boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.attempts;
  v_assignment public.assignments;
  v_inserted boolean := false;
  v_is_violation boolean := false;
  v_count integer;
  v_auto_submitted boolean := false;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'student') then
    raise exception 'Only authenticated students can record Exam Mode activity';
  end if;
  if p_client_event_id is null or p_event_type not in ('page_hidden', 'page_visible', 'window_blur', 'window_focus', 'fullscreen_exited', 'fullscreen_restored', 'fullscreen_unavailable') then
    raise exception 'Exam activity is invalid';
  end if;
  if p_away_duration_seconds is not null and p_away_duration_seconds not between 0 and 86400 then
    raise exception 'Exam activity duration is invalid';
  end if;

  -- The row lock serializes simultaneous browser events and submission. This
  -- keeps the confirmed count authoritative and permits only one auto-submit.
  select * into v_attempt
  from public.attempts
  where id = p_attempt_id and student_id = v_user
  for update;
  if not found then raise exception 'Attempt is not available'; end if;

  select * into v_assignment from public.assignments where id = v_attempt.assignment_id;
  if not v_assignment.exam_mode then raise exception 'Exam Mode is not enabled'; end if;
  if v_attempt.status <> 'in_progress' then
    return query select v_attempt.exam_focus_violations, v_attempt.status = 'submitted';
    return;
  end if;

  insert into public.attempt_exam_events (attempt_id, client_event_id, event_type, away_duration_seconds)
  values (p_attempt_id, p_client_event_id, p_event_type, p_away_duration_seconds)
  on conflict (attempt_id, client_event_id) do nothing
  returning true into v_inserted;
  if not found then
    return query select v_attempt.exam_focus_violations, false;
    return;
  end if;

  v_is_violation := (p_event_type = 'page_hidden' and v_assignment.exam_track_focus_exits)
    or (p_event_type = 'fullscreen_exited' and v_assignment.exam_require_fullscreen);
  if v_is_violation then
    update public.attempts
    set exam_focus_violations = exam_focus_violations + 1
    where id = p_attempt_id
    returning exam_focus_violations into v_count;

    if v_count > v_assignment.exam_allowed_focus_exits then
      perform public.finish_exam_attempt(p_attempt_id, 'auto_submit');
      v_auto_submitted := true;
    end if;
  else
    v_count := v_attempt.exam_focus_violations;
  end if;

  return query select v_count, v_auto_submitted;
end;
$$;
