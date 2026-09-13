-- Teacher controls for monitoring and managing active Test attempts.

alter table public.attempts
  add column if not exists teacher_extra_minutes integer not null default 0
    check (teacher_extra_minutes >= 0);

create table public.assignment_student_test_time (
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  extra_minutes integer not null default 0 check (extra_minutes between 0 and 10080),
  updated_at timestamptz not null default now(),
  primary key (assignment_id, student_id)
);
alter table public.assignment_student_test_time enable row level security;
revoke all on table public.assignment_student_test_time from anon, authenticated;
grant select on table public.assignment_student_test_time to authenticated;
create policy "test time: students read own" on public.assignment_student_test_time
for select to authenticated using (student_id = auth.uid());

create function public.effective_attempt_deadline(p_attempt_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(adjustment.extra_minutes, 0) > 0 then coalesce(attempt.expires_at, assignment.due_at)
    when attempt.expires_at is null then assignment.due_at
    when assignment.due_at is null then attempt.expires_at
    else least(attempt.expires_at, assignment.due_at)
  end
  from public.attempts attempt
  join public.assignments assignment on assignment.id = attempt.assignment_id
  left join public.assignment_student_test_time adjustment
    on adjustment.assignment_id = attempt.assignment_id
    and adjustment.student_id = attempt.student_id
  where attempt.id = p_attempt_id;
$$;

drop function public.get_my_assignment_attempts(uuid);
create function public.get_my_assignment_attempts(p_assignment_id uuid default null)
returns table (
  id uuid,
  assignment_id uuid,
  status text,
  started_at timestamptz,
  expires_at timestamptz,
  form_code text,
  submitted_at timestamptz,
  score numeric,
  max_score numeric,
  attempt_number integer,
  exam_focus_violations integer,
  teacher_extra_minutes integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select attempt.id,
         attempt.assignment_id,
         attempt.status,
         attempt.started_at,
         attempt.expires_at,
         attempt.form_code,
         attempt.submitted_at,
         case when assignment.show_score_after_submit then attempt.score else null end,
         case when assignment.show_score_after_submit then attempt.max_score else null end,
         attempt.attempt_number,
         attempt.exam_focus_violations,
         coalesce(adjustment.extra_minutes, attempt.teacher_extra_minutes, 0)
  from public.attempts attempt
  join public.assignments assignment on assignment.id = attempt.assignment_id
  left join public.assignment_student_test_time adjustment
    on adjustment.assignment_id = attempt.assignment_id
    and adjustment.student_id = attempt.student_id
  where attempt.student_id = auth.uid()
    and (p_assignment_id is null or attempt.assignment_id = p_assignment_id)
    and exists (
      select 1
      from public.assignment_classes assignment_class
      join public.class_members member on member.class_id = assignment_class.class_id
      where assignment_class.assignment_id = assignment.id
        and member.student_id = auth.uid()
    )
  order by attempt.attempt_number desc;
$$;

alter table public.attempt_exam_events
  drop constraint if exists attempt_exam_events_event_type_check;
alter table public.attempt_exam_events
  add constraint attempt_exam_events_event_type_check check (event_type in (
    'assessment_started', 'page_hidden', 'page_visible', 'window_blur',
    'window_focus', 'fullscreen_exited', 'fullscreen_restored',
    'fullscreen_unavailable', 'auto_submit', 'manual_submit', 'time_expired',
    'teacher_closed', 'teacher_submitted', 'teacher_unsubmitted',
    'teacher_extra_time'
  ));

create function public.get_owned_test_roster(
  p_assignment_id uuid,
  p_class_id uuid default null
)
returns table (
  student_id uuid,
  attempt_id uuid,
  attempt_number integer,
  status text,
  started_at timestamptz,
  submitted_at timestamptz,
  expires_at timestamptz,
  teacher_extra_minutes integer,
  answered_count integer,
  total_questions integer,
  last_activity_at timestamptz,
  focus_violations integer,
  form_code text,
  offline_recovery_used boolean,
  offline_recovery_seconds integer
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
    raise exception 'Only authenticated teachers can manage tests';
  end if;
  if not exists (
    select 1 from public.assignments
    where id = p_assignment_id and created_by = v_user and kind = 'test'
  ) then
    raise exception 'Test is not managed by this teacher';
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
    select assignment.due_at,
           (select count(*)::integer from public.assignment_questions question where question.assignment_id = assignment.id) as question_count
    from public.assignments assignment
    where assignment.id = p_assignment_id
  )
  select expected.student_id,
         attempt.id,
         attempt.attempt_number,
         coalesce(attempt.status, 'not_started'),
         attempt.started_at,
         attempt.submitted_at,
         case
           when coalesce(time_adjustment.extra_minutes, 0) > 0 then coalesce(attempt.expires_at, details.due_at)
           when attempt.expires_at is null then details.due_at
           when details.due_at is null then attempt.expires_at
           else least(attempt.expires_at, details.due_at)
         end,
         coalesce(time_adjustment.extra_minutes, attempt.teacher_extra_minutes, 0),
         coalesce(progress.answered_count, 0),
         coalesce(progress.total_questions, details.question_count),
         progress.last_activity_at,
         coalesce(attempt.exam_focus_violations, 0),
         attempt.form_code,
         coalesce(attempt.offline_recovery_used, false),
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
           count(response.id) filter (
             where nullif(btrim(response.student_answer), '') is not null
           )::integer as answered_count,
           max(response.updated_at) as last_activity_at
    from public.attempt_questions question
    left join public.responses response
      on response.attempt_id = question.attempt_id
      and response.question_id = question.question_id
    where question.attempt_id = attempt.id
  ) progress on attempt.id is not null
  left join public.assignment_student_test_time time_adjustment
    on time_adjustment.assignment_id = p_assignment_id
    and time_adjustment.student_id = expected.student_id
  order by expected.student_id;
end;
$$;

create function public.force_submit_owned_test_attempt(
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
    and assignment.status = 'published'
  for update of attempt;
  if not found then raise exception 'Active Test attempt is not available'; end if;

  select * into v_attempt from public.finalize_attempt_unchecked(p_attempt_id);
  insert into public.attempt_exam_events (attempt_id, event_type)
  values (p_attempt_id, 'teacher_submitted');
  return v_attempt;
end;
$$;

create function public.unsubmit_owned_test_attempt(
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
    and attempt.status = 'submitted'
    and assignment.created_by = v_user
    and assignment.kind = 'test'
    and assignment.status = 'published'
  for update of attempt;
  if not found then raise exception 'Submitted Test attempt is not available'; end if;

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

create function public.grant_owned_test_extra_time(
  p_assignment_id uuid,
  p_student_ids uuid[],
  p_extra_minutes integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_updated integer;
begin
  if v_user is null or not exists (
    select 1 from public.profiles where id = v_user and role = 'teacher'
  ) then
    raise exception 'Only authenticated teachers can manage tests';
  end if;
  if p_extra_minutes is null or p_extra_minutes not between 1 and 1440 then
    raise exception 'Extra time must be between 1 and 1440 minutes';
  end if;
  if p_student_ids is null or cardinality(p_student_ids) < 1 or cardinality(p_student_ids) > 1000 then
    raise exception 'Select at least one student';
  end if;
  if cardinality(p_student_ids) <> (
    select count(distinct requested.id)::integer from unnest(p_student_ids) requested(id)
  ) then
    raise exception 'Selected attempts must be unique';
  end if;
  if not exists (
    select 1 from public.assignments
    where id = p_assignment_id
      and created_by = v_user
      and kind = 'test'
      and status = 'published'
  ) then
    raise exception 'Published Test is not managed by this teacher';
  end if;
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
    raise exception 'One or more selected students are not assigned to this Test';
  end if;

  insert into public.assignment_student_test_time (assignment_id, student_id, extra_minutes)
  select p_assignment_id, requested.id, p_extra_minutes
  from unnest(p_student_ids) requested(id)
  on conflict (assignment_id, student_id) do update
  set extra_minutes = public.assignment_student_test_time.extra_minutes + excluded.extra_minutes,
      updated_at = now();
  get diagnostics v_updated = row_count;

  update public.attempts
  set expires_at = greatest(coalesce(expires_at, now()), now()) + make_interval(mins => p_extra_minutes),
      teacher_extra_minutes = teacher_extra_minutes + p_extra_minutes
  where assignment_id = p_assignment_id
    and student_id = any(p_student_ids)
    and id = (
      select candidate.id
      from public.attempts candidate
      where candidate.assignment_id = p_assignment_id
        and candidate.student_id = public.attempts.student_id
      order by candidate.attempt_number desc, candidate.started_at desc, candidate.id desc
      limit 1
    );

  insert into public.attempt_exam_events (attempt_id, event_type)
  select attempt.id, 'teacher_extra_time'
  from public.attempts attempt
  where attempt.assignment_id = p_assignment_id
    and attempt.student_id = any(p_student_ids)
    and attempt.id = (
      select candidate.id
      from public.attempts candidate
      where candidate.assignment_id = p_assignment_id
        and candidate.student_id = attempt.student_id
      order by candidate.attempt_number desc, candidate.started_at desc, candidate.id desc
      limit 1
    );
  return v_updated;
end;
$$;

-- Apply pre-granted time when a selected student starts the Test. The wrapped
-- function remains the existing variant-aware attempt builder.
create or replace function public.start_attempt(p_assignment_id uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.attempts;
  v_extra_minutes integer;
  v_delta integer;
begin
  if exists (
    select 1
    from public.assignments assignment
    where assignment.id = p_assignment_id
      and assignment.status = 'published'
      and assignment.kind = 'test'
      and assignment.teacher_controlled_question_release
      and assignment.questions_released_at is null
      and exists (
        select 1
        from public.assignment_classes assignment_class
        join public.class_members member on member.class_id = assignment_class.class_id
        where assignment_class.assignment_id = assignment.id
          and member.student_id = auth.uid()
      )
  ) then
    raise exception 'Test questions have not been released';
  end if;

  select * into v_attempt from public.start_attempt_before_teacher_release(p_assignment_id);
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
    where id = v_attempt.id
    returning * into v_attempt;
  end if;
  return v_attempt;
end;
$$;

create or replace function public.save_response_batch(p_attempt_id uuid, p_responses jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.attempts;
  v_assignment_status text;
  v_deadline timestamptz;
  v_saved integer := 0;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'student') then
    raise exception 'Only authenticated students can save responses';
  end if;
  if p_responses is null or jsonb_typeof(p_responses) <> 'array' or jsonb_array_length(p_responses) not between 1 and 200 then
    raise exception 'Response batch is invalid';
  end if;

  select attempt.* into v_attempt
  from public.attempts attempt
  where attempt.id = p_attempt_id and attempt.student_id = v_user and attempt.status = 'in_progress'
  for update;
  if not found then raise exception 'Attempt is not available for editing'; end if;
  select status into v_assignment_status from public.assignments where id = v_attempt.assignment_id;
  if v_assignment_status <> 'published' then raise exception 'Assignment is closed'; end if;
  v_deadline := public.effective_attempt_deadline(p_attempt_id);
  if v_deadline is not null and now() > v_deadline then raise exception 'The response window has closed'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_responses) as response_item(question_id uuid, student_answer text, client_revision bigint)
    left join public.attempt_questions question
      on question.attempt_id = p_attempt_id and question.question_id = response_item.question_id
    where question.question_id is null
      or response_item.client_revision is null
      or response_item.client_revision < 0
      or char_length(coalesce(response_item.student_answer, '')) > 20000
  ) then raise exception 'A response is invalid for this attempt'; end if;

  if (
    select count(*) <> count(distinct response_item.question_id)
    from jsonb_to_recordset(p_responses) as response_item(question_id uuid)
  ) then raise exception 'Response questions must be unique'; end if;

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
  get diagnostics v_saved = row_count;
  return v_saved;
end;
$$;

create or replace function public.submit_attempt_snapshot(
  p_attempt_id uuid,
  p_responses jsonb,
  p_client_submitted_at timestamptz,
  p_timed boolean default false
)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.attempts;
  v_assignment public.assignments;
  v_deadline timestamptz;
  v_recovery_seconds integer := 0;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'student') then
    raise exception 'Only authenticated students can submit attempts';
  end if;
  if p_responses is null or jsonb_typeof(p_responses) <> 'array' or jsonb_array_length(p_responses) > 200 then
    raise exception 'Response snapshot is invalid';
  end if;
  select attempt.* into v_attempt
  from public.attempts attempt
  where attempt.id = p_attempt_id and attempt.student_id = v_user and attempt.status = 'in_progress'
  for update;
  if not found then raise exception 'Attempt is not available'; end if;
  select * into v_assignment from public.assignments where id = v_attempt.assignment_id;
  if v_assignment.status <> 'published' then raise exception 'Assignment is closed'; end if;

  v_deadline := public.effective_attempt_deadline(p_attempt_id);
  if p_client_submitted_at is null or p_client_submitted_at < v_attempt.started_at - interval '1 minute' or p_client_submitted_at > now() + interval '1 minute' then
    raise exception 'Submission timestamp is invalid';
  end if;
  if v_deadline is not null and now() > v_deadline then
    if p_client_submitted_at > v_deadline + interval '5 seconds' or now() > v_deadline + interval '5 minutes' then
      raise exception 'The submission recovery window has closed';
    end if;
    v_recovery_seconds := greatest(1, ceil(extract(epoch from now() - v_deadline))::integer);
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_responses) as response_item(question_id uuid, student_answer text, client_revision bigint)
    left join public.attempt_questions question on question.attempt_id = p_attempt_id and question.question_id = response_item.question_id
    where question.question_id is null or response_item.client_revision is null or response_item.client_revision < 0 or char_length(coalesce(response_item.student_answer, '')) > 20000
  ) then raise exception 'A response is invalid for this attempt'; end if;
  if (
    select count(*) <> count(distinct response_item.question_id)
    from jsonb_to_recordset(p_responses) as response_item(question_id uuid)
  ) then raise exception 'Response questions must be unique'; end if;

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
    update public.attempts set offline_recovery_used = true, offline_recovery_seconds = v_recovery_seconds where id = p_attempt_id;
  end if;
  select * into v_attempt from public.finalize_attempt_unchecked(p_attempt_id);
  if v_assignment.exam_mode then
    insert into public.attempt_exam_events (attempt_id, event_type)
    values (p_attempt_id, case when p_timed then 'time_expired' else 'manual_submit' end);
  end if;
  return v_attempt;
end;
$$;

revoke all on function public.get_owned_test_roster(uuid, uuid) from public, anon;
revoke all on function public.force_submit_owned_test_attempt(uuid, uuid) from public, anon;
revoke all on function public.unsubmit_owned_test_attempt(uuid, uuid) from public, anon;
revoke all on function public.grant_owned_test_extra_time(uuid, uuid[], integer) from public, anon;
revoke all on function public.effective_attempt_deadline(uuid) from public, anon;
revoke all on function public.get_my_assignment_attempts(uuid) from public, anon;
grant execute on function public.get_owned_test_roster(uuid, uuid) to authenticated;
grant execute on function public.force_submit_owned_test_attempt(uuid, uuid) to authenticated;
grant execute on function public.unsubmit_owned_test_attempt(uuid, uuid) to authenticated;
grant execute on function public.grant_owned_test_extra_time(uuid, uuid[], integer) to authenticated;
grant execute on function public.get_my_assignment_attempts(uuid) to authenticated;
revoke all on function public.start_attempt(uuid) from public, anon;
grant execute on function public.start_attempt(uuid) to authenticated;
