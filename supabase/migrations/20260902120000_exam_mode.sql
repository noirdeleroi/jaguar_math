-- Per-assignment browser Exam Mode. This records minimal page/fullscreen
-- telemetry only; it is not a device lockdown or a cheating determination.

alter table public.assignments
  add column if not exists exam_mode boolean not null default false,
  add column if not exists exam_require_fullscreen boolean not null default true,
  add column if not exists exam_track_focus_exits boolean not null default true,
  add column if not exists exam_allowed_focus_exits integer not null default 2 check (exam_allowed_focus_exits >= 0),
  add column if not exists exam_violation_action text not null default 'warn' check (exam_violation_action in ('warn', 'auto_submit'));

alter table public.attempts
  add column if not exists exam_focus_violations integer not null default 0 check (exam_focus_violations >= 0);

create table public.attempt_exam_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  client_event_id uuid,
  event_type text not null check (event_type in ('assessment_started', 'page_hidden', 'page_visible', 'window_blur', 'window_focus', 'fullscreen_exited', 'fullscreen_restored', 'fullscreen_unavailable', 'auto_submit', 'manual_submit')),
  occurred_at timestamptz not null default now(),
  away_duration_seconds integer check (away_duration_seconds is null or away_duration_seconds between 0 and 86400),
  created_at timestamptz not null default now(),
  unique (attempt_id, client_event_id)
);

create index attempt_exam_events_attempt_occurred_idx on public.attempt_exam_events (attempt_id, occurred_at);

alter table public.attempt_exam_events enable row level security;
revoke all on table public.attempt_exam_events from anon, public;
grant select on table public.attempt_exam_events to authenticated;

create policy "exam events: students read own" on public.attempt_exam_events
for select to authenticated
using (exists (select 1 from public.attempts a where a.id = attempt_exam_events.attempt_id and a.student_id = auth.uid()));

create policy "exam events: teachers read owned assignments" on public.attempt_exam_events
for select to authenticated
using (public.owns_attempt(attempt_id));

create function public.create_assignment_draft_with_exam(
  p_title text,
  p_description text,
  p_kind text,
  p_due_at timestamptz,
  p_duration_minutes integer,
  p_max_attempts integer,
  p_show_score_after_submit boolean,
  p_show_answers_after_submit boolean,
  p_shuffle_questions boolean,
  p_class_ids uuid[],
  p_questions jsonb,
  p_exam_mode boolean,
  p_exam_require_fullscreen boolean,
  p_exam_track_focus_exits boolean,
  p_exam_allowed_focus_exits integer,
  p_exam_violation_action text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_assignment_id uuid;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can create assignments';
  end if;
  if p_exam_mode and (p_exam_allowed_focus_exits is null or p_exam_allowed_focus_exits < 0 or p_exam_violation_action not in ('warn', 'auto_submit')) then
    raise exception 'Exam Mode settings are invalid';
  end if;
  select public.create_assignment_draft(p_title, p_description, p_kind, p_due_at, p_duration_minutes, p_max_attempts, p_show_score_after_submit, p_show_answers_after_submit, p_shuffle_questions, p_class_ids, p_questions)
  into v_assignment_id;
  update public.assignments
  set exam_mode = coalesce(p_exam_mode, false),
      exam_require_fullscreen = coalesce(p_exam_require_fullscreen, true),
      exam_track_focus_exits = coalesce(p_exam_track_focus_exits, true),
      exam_allowed_focus_exits = coalesce(p_exam_allowed_focus_exits, 2),
      exam_violation_action = coalesce(p_exam_violation_action, 'warn')
  where id = v_assignment_id and created_by = v_user;
  return v_assignment_id;
end;
$$;

create function public.update_owned_assignment_with_exam(
  p_assignment_id uuid,
  p_title text,
  p_description text,
  p_kind text,
  p_due_at timestamptz,
  p_duration_minutes integer,
  p_max_attempts integer,
  p_show_score_after_submit boolean,
  p_show_answers_after_submit boolean,
  p_shuffle_questions boolean,
  p_class_ids uuid[],
  p_exam_mode boolean,
  p_exam_require_fullscreen boolean,
  p_exam_track_focus_exits boolean,
  p_exam_allowed_focus_exits integer,
  p_exam_violation_action text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can edit assignments';
  end if;
  if p_exam_mode and (p_exam_allowed_focus_exits is null or p_exam_allowed_focus_exits < 0 or p_exam_violation_action not in ('warn', 'auto_submit')) then
    raise exception 'Exam Mode settings are invalid';
  end if;
  perform public.update_owned_assignment(p_assignment_id, p_title, p_description, p_kind, p_due_at, p_duration_minutes, p_max_attempts, p_show_score_after_submit, p_show_answers_after_submit, p_shuffle_questions, p_class_ids);
  update public.assignments
  set exam_mode = coalesce(p_exam_mode, false),
      exam_require_fullscreen = coalesce(p_exam_require_fullscreen, true),
      exam_track_focus_exits = coalesce(p_exam_track_focus_exits, true),
      exam_allowed_focus_exits = coalesce(p_exam_allowed_focus_exits, 2),
      exam_violation_action = coalesce(p_exam_violation_action, 'warn')
  where id = p_assignment_id and created_by = v_user;
end;
$$;

create function public.duplicate_owned_assignment_with_exam(p_assignment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_source public.assignments;
  v_copy_id uuid;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can duplicate assignments';
  end if;
  select * into v_source from public.assignments where id = p_assignment_id and created_by = v_user;
  if not found then raise exception 'Assignment is not managed by this teacher'; end if;
  select public.duplicate_owned_assignment(p_assignment_id) into v_copy_id;
  update public.assignments
  set exam_mode = v_source.exam_mode,
      exam_require_fullscreen = v_source.exam_require_fullscreen,
      exam_track_focus_exits = v_source.exam_track_focus_exits,
      exam_allowed_focus_exits = v_source.exam_allowed_focus_exits,
      exam_violation_action = v_source.exam_violation_action
  where id = v_copy_id and created_by = v_user;
  return v_copy_id;
end;
$$;

create function public.start_exam_attempt(p_assignment_id uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.attempts;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'student') then
    raise exception 'Only authenticated students can start attempts';
  end if;
  if not exists (select 1 from public.assignments where id = p_assignment_id and exam_mode and status = 'published') then
    raise exception 'Exam Mode is not available';
  end if;
  select * into v_attempt from public.attempts
  where assignment_id = p_assignment_id and student_id = v_user and status = 'in_progress'
  order by started_at desc, attempt_number desc limit 1;
  if found then return v_attempt; end if;
  select * into v_attempt from public.start_attempt(p_assignment_id);
  insert into public.attempt_exam_events (attempt_id, event_type)
  values (v_attempt.id, 'assessment_started');
  return v_attempt;
end;
$$;

create function public.finish_exam_attempt(p_attempt_id uuid, p_event_type text)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.attempts;
  v_exam_mode boolean;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'student') then
    raise exception 'Only authenticated students can submit attempts';
  end if;
  if p_event_type not in ('manual_submit', 'auto_submit') then raise exception 'Exam submission type is invalid'; end if;
  select a.* into v_attempt from public.attempts a where a.id = p_attempt_id and a.student_id = v_user and a.status = 'in_progress';
  if not found then raise exception 'Attempt is not available'; end if;
  select exam_mode into v_exam_mode from public.assignments where id = v_attempt.assignment_id;
  if not v_exam_mode then raise exception 'Exam Mode is not enabled'; end if;
  select * into v_attempt from public.submit_attempt(p_attempt_id);
  insert into public.attempt_exam_events (attempt_id, event_type)
  values (v_attempt.id, p_event_type);
  return v_attempt;
end;
$$;

create function public.submit_exam_attempt(p_attempt_id uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$ begin return public.finish_exam_attempt(p_attempt_id, 'manual_submit'); end; $$;

create function public.record_exam_activity(
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
  select * into v_attempt from public.attempts where id = p_attempt_id and student_id = v_user for update;
  if not found then raise exception 'Attempt is not available'; end if;
  select * into v_assignment from public.assignments where id = v_attempt.assignment_id;
  if not v_assignment.exam_mode then raise exception 'Exam Mode is not enabled'; end if;
  if v_attempt.status <> 'in_progress' then
    return query select v_attempt.exam_focus_violations, false;
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
    if v_assignment.exam_violation_action = 'auto_submit' and v_count > v_assignment.exam_allowed_focus_exits then
      begin
        perform public.finish_exam_attempt(p_attempt_id, 'auto_submit');
        v_auto_submitted := true;
      exception when sqlstate 'P0001' then
        v_auto_submitted := false;
      end;
    end if;
  else
    v_count := v_attempt.exam_focus_violations;
  end if;
  return query select v_count, v_auto_submitted;
end;
$$;

revoke all on function public.create_assignment_draft_with_exam(text, text, text, timestamptz, integer, integer, boolean, boolean, boolean, uuid[], jsonb, boolean, boolean, boolean, integer, text) from public;
revoke all on function public.update_owned_assignment_with_exam(uuid, text, text, text, timestamptz, integer, integer, boolean, boolean, boolean, uuid[], boolean, boolean, boolean, integer, text) from public;
revoke all on function public.duplicate_owned_assignment_with_exam(uuid) from public;
revoke all on function public.start_exam_attempt(uuid) from public;
revoke all on function public.finish_exam_attempt(uuid, text) from public;
revoke all on function public.submit_exam_attempt(uuid) from public;
revoke all on function public.record_exam_activity(uuid, uuid, text, integer) from public;
grant execute on function public.create_assignment_draft_with_exam(text, text, text, timestamptz, integer, integer, boolean, boolean, boolean, uuid[], jsonb, boolean, boolean, boolean, integer, text) to authenticated;
grant execute on function public.update_owned_assignment_with_exam(uuid, text, text, text, timestamptz, integer, integer, boolean, boolean, boolean, uuid[], boolean, boolean, boolean, integer, text) to authenticated;
grant execute on function public.duplicate_owned_assignment_with_exam(uuid) to authenticated;
grant execute on function public.start_exam_attempt(uuid) to authenticated;
grant execute on function public.submit_exam_attempt(uuid) to authenticated;
grant execute on function public.record_exam_activity(uuid, uuid, text, integer) to authenticated;
