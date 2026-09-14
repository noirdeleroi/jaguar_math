-- A fullscreen/focus violation must never reach auto-submit before the answers
-- that were visible in the browser at that moment. Persist the snapshot and
-- activity under one attempt lock, then apply the configured violation policy.
create function public.record_exam_activity_with_snapshot(
  p_attempt_id uuid,
  p_client_event_id uuid,
  p_event_type text,
  p_client_occurred_at timestamptz,
  p_away_duration_seconds integer default null,
  p_responses jsonb default '[]'::jsonb
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
  v_deadline timestamptz;
  v_inserted boolean := false;
  v_is_violation boolean := false;
  v_count integer;
  v_auto_submitted boolean := false;
  v_recovery_seconds integer := 0;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'student') then
    raise exception 'Only authenticated students can record Exam Mode activity';
  end if;
  if p_client_event_id is null
     or p_event_type not in ('page_hidden', 'page_visible', 'window_blur', 'window_focus', 'fullscreen_exited', 'fullscreen_restored', 'fullscreen_unavailable')
     or p_client_occurred_at is null
     or p_client_occurred_at > now() + interval '1 minute'
     or (p_away_duration_seconds is not null and p_away_duration_seconds not between 0 and 86400)
     or p_responses is null
     or jsonb_typeof(p_responses) <> 'array'
     or jsonb_array_length(p_responses) > 200 then
    raise exception 'Exam activity is invalid';
  end if;

  select attempt.* into v_attempt
  from public.attempts attempt
  where attempt.id = p_attempt_id and attempt.student_id = v_user
  for update;
  if not found then raise exception 'Attempt is not available'; end if;

  select * into v_assignment from public.assignments where id = v_attempt.assignment_id;
  if not v_assignment.exam_mode then raise exception 'Exam Mode is not enabled'; end if;
  if p_client_occurred_at < v_attempt.started_at - interval '1 minute' then raise exception 'Exam activity timestamp is invalid'; end if;
  if v_attempt.status <> 'in_progress' then
    return query select v_attempt.exam_focus_violations, exists (
      select 1 from public.attempt_exam_events
      where attempt_id = p_attempt_id and event_type = 'auto_submit'
    );
    return;
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_responses) as response_item(question_id uuid, student_answer text, client_revision bigint)
    left join public.attempt_questions question on question.attempt_id = p_attempt_id and question.question_id = response_item.question_id
    where question.question_id is null
      or response_item.client_revision is null
      or response_item.client_revision < 0
      or char_length(coalesce(response_item.student_answer, '')) > 20000
  ) then raise exception 'A response is invalid for this attempt'; end if;
  if (
    select count(*) <> count(distinct response_item.question_id)
    from jsonb_to_recordset(p_responses) as response_item(question_id uuid)
  ) then raise exception 'Response questions must be unique'; end if;

  v_deadline := public.effective_attempt_deadline(p_attempt_id);
  if jsonb_array_length(p_responses) > 0 and v_assignment.status = 'published' then
    if v_deadline is null or now() <= v_deadline then
      v_recovery_seconds := 0;
    elsif p_client_occurred_at <= v_deadline + interval '5 seconds' and now() <= v_deadline + interval '5 minutes' then
      v_recovery_seconds := greatest(1, ceil(extract(epoch from now() - v_deadline))::integer);
    else
      raise exception 'The response recovery window has closed';
    end if;

    insert into public.responses (attempt_id, question_id, student_answer, client_revision)
    select p_attempt_id, response_item.question_id, response_item.student_answer, response_item.client_revision
    from jsonb_to_recordset(p_responses) as response_item(question_id uuid, student_answer text, client_revision bigint)
    on conflict (attempt_id, question_id) do update
    set student_answer = excluded.student_answer,
        client_revision = excluded.client_revision,
        is_correct = null,
        points_awarded = null,
        answered_at = now(),
        updated_at = now()
    where public.responses.client_revision <= excluded.client_revision;

    if v_recovery_seconds > 0 then
      update public.attempts
      set offline_recovery_used = true,
          offline_recovery_seconds = greatest(offline_recovery_seconds, v_recovery_seconds)
      where id = p_attempt_id;
    end if;
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
    if v_assignment.exam_violation_action = 'auto_submit'
       and v_count > v_assignment.exam_allowed_focus_exits then
      perform public.finish_exam_attempt(p_attempt_id, 'auto_submit');
      v_auto_submitted := true;
    end if;
  else
    v_count := v_attempt.exam_focus_violations;
  end if;

  return query select v_count, v_auto_submitted;
end;
$$;

revoke all on function public.record_exam_activity_with_snapshot(uuid, uuid, text, timestamptz, integer, jsonb) from public, anon;
grant execute on function public.record_exam_activity_with_snapshot(uuid, uuid, text, timestamptz, integer, jsonb) to authenticated;
