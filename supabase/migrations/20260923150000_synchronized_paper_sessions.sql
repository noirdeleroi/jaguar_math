-- Synchronized paper tests have two server-owned phases: a shared writing
-- window and a short answer-entry window. Student devices derive countdowns
-- from database timestamps, while existing snapshot recovery protects work
-- during unreliable connections.

alter table public.assignments
  add column if not exists paper_started_at timestamptz,
  add column if not exists paper_writing_ends_at timestamptz,
  add column if not exists paper_answer_duration_seconds integer not null default 90
    check (paper_answer_duration_seconds between 30 and 3600);

create table public.assignment_student_paper_time (
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  adjustment_seconds integer not null default 0 check (adjustment_seconds between -3590 and 7170),
  updated_at timestamptz not null default now(),
  primary key (assignment_id, student_id)
);
alter table public.assignment_student_paper_time enable row level security;
revoke all on table public.assignment_student_paper_time from anon, authenticated;
grant select on table public.assignment_student_paper_time to authenticated;
create policy "paper time: students read own" on public.assignment_student_paper_time
for select to authenticated using (student_id = auth.uid());

create or replace function public.enforce_assignment_kind_policy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.show_answers_after_submit then
    new.show_score_after_submit := true;
  end if;

  if new.kind = 'homework' then
    new.exam_mode := false;
    new.exam_require_fullscreen := false;
    new.exam_track_focus_exits := false;
    new.teacher_controlled_question_release := false;
    new.questions_released_at := null;
    new.paper_started_at := null;
    new.paper_writing_ends_at := null;
  elsif new.kind = 'quiz' then
    new.max_attempts := 1;
    new.show_feedback_after_each_question := false;
    new.teacher_controlled_question_release := false;
    new.questions_released_at := null;
    new.paper_started_at := null;
    new.paper_writing_ends_at := null;
  elsif new.kind = 'test' then
    new.duration_minutes := coalesce(new.duration_minutes, 60);
    new.max_attempts := 1;
    new.show_feedback_after_each_question := false;
    new.question_display_mode := 'one_at_a_time';
    new.shuffle_questions := true;
    new.shuffle_options := true;
    new.exam_mode := true;
    new.exam_require_fullscreen := true;
    new.exam_track_focus_exits := true;
    if old.kind <> 'paper' then
      new.paper_started_at := null;
      new.paper_writing_ends_at := null;
    end if;
    if not new.teacher_controlled_question_release then
      new.questions_released_at := null;
    end if;
  elsif new.kind = 'paper' then
    new.duration_minutes := coalesce(new.duration_minutes, 60);
    new.max_attempts := 1;
    new.show_feedback_after_each_question := false;
    new.question_display_mode := 'all_at_once';
    new.shuffle_questions := false;
    new.shuffle_options := false;
    new.exam_mode := true;
    new.exam_require_fullscreen := true;
    new.exam_track_focus_exits := true;
    new.exam_allowed_focus_exits := 0;
    new.exam_violation_action := 'warn';
    new.teacher_controlled_question_release := true;
    new.paper_answer_duration_seconds := coalesce(new.paper_answer_duration_seconds, 90);
  end if;
  return new;
end;
$$;

update public.assignments
set duration_minutes = coalesce(duration_minutes, 60),
    exam_mode = true,
    exam_require_fullscreen = true,
    exam_track_focus_exits = true,
    exam_allowed_focus_exits = 0,
    exam_violation_action = 'warn',
    paper_answer_duration_seconds = coalesce(paper_answer_duration_seconds, 90),
    paper_started_at = case when questions_released_at is not null then coalesce(paper_started_at, questions_released_at) else paper_started_at end,
    paper_writing_ends_at = case when questions_released_at is not null then coalesce(paper_writing_ends_at, questions_released_at) else paper_writing_ends_at end
where kind = 'paper';

create or replace function public.effective_attempt_deadline(p_attempt_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when assignment.kind = 'paper' then attempt.expires_at
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

-- Paper attempts are created when students enter the secure waiting room, not
-- when answers open. This gives every waiting-room fullscreen exit an attempt
-- to attach to and assigns the printed version before the writing timer starts.
create or replace function public.start_attempt(p_assignment_id uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.attempts;
  v_assignment public.assignments;
  v_version_count integer;
  v_paper_version integer;
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

  if v_assignment.kind = 'paper' and v_attempt.form_code not like 'Version %' then
    select greatest(1, coalesce(max(variant.variant_index), 1))
    into v_version_count
    from public.assignment_question_variants variant
    where variant.assignment_id = p_assignment_id;
    v_paper_version := 1 + mod(get_byte(decode(md5(v_attempt.id::text), 'hex'), 0), v_version_count);

    update public.attempts set form_code = 'Version ' || v_paper_version::text
    where id = v_attempt.id returning * into v_attempt;

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
      where candidate.variant_index = v_paper_version
      limit 1
    ) chosen
    join public.questions source on source.id = chosen.question_id
    where question.assignment_id = p_assignment_id
    order by question.position;
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

create function public.start_owned_paper_session(p_assignment_id uuid)
returns table(started_at timestamptz, writing_ends_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can start paper tests';
  end if;
  update public.assignments
  set paper_started_at = now(),
      paper_writing_ends_at = now() + make_interval(mins => duration_minutes)
  where id = p_assignment_id
    and created_by = v_user
    and kind = 'paper'
    and status = 'published'
    and paper_started_at is null
    and questions_released_at is null
  returning paper_started_at, paper_writing_ends_at into started_at, writing_ends_at;
  if not found then raise exception 'Paper test is not ready to start'; end if;
  return next;
end;
$$;

create function public.release_owned_paper_answers(p_assignment_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_released_at timestamptz;
  v_answer_duration integer;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can release paper answers';
  end if;
  update public.assignments
  set questions_released_at = now()
  where id = p_assignment_id
    and created_by = v_user
    and kind = 'paper'
    and status = 'published'
    and paper_started_at is not null
    and paper_writing_ends_at <= now()
    and questions_released_at is null
  returning questions_released_at, paper_answer_duration_seconds into v_released_at, v_answer_duration;
  if not found then raise exception 'The writing timer must end before answer entry opens'; end if;

  update public.attempts attempt
  set expires_at = v_released_at + make_interval(secs => greatest(10,
        v_answer_duration + coalesce((
          select adjustment.adjustment_seconds
          from public.assignment_student_paper_time adjustment
          where adjustment.assignment_id = p_assignment_id
            and adjustment.student_id = attempt.student_id
        ), 0)))
  where attempt.assignment_id = p_assignment_id and attempt.status = 'in_progress';
  return v_released_at;
end;
$$;

create function public.get_my_paper_session_state(p_assignment_id uuid)
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
         assignment.questions_released_at, attempt.expires_at,
         assignment.paper_answer_duration_seconds, attempt.id, attempt.status,
         attempt.form_code, coalesce(attempt.exam_focus_violations, 0)
  from public.assignments assignment
  left join lateral (
    select candidate.id, candidate.status, candidate.expires_at, candidate.form_code,
           candidate.exam_focus_violations
    from public.attempts candidate
    where candidate.assignment_id = assignment.id and candidate.student_id = auth.uid()
    order by candidate.attempt_number desc, candidate.started_at desc, candidate.id desc
    limit 1
  ) attempt on true
  where assignment.id = p_assignment_id
    and assignment.kind = 'paper'
    and assignment.status in ('published', 'closed')
    and exists (
      select 1 from public.assignment_classes assignment_class
      join public.class_members member on member.class_id = assignment_class.class_id
      where assignment_class.assignment_id = assignment.id and member.student_id = auth.uid()
    );
$$;

create function public.get_owned_paper_roster(p_assignment_id uuid, p_class_id uuid default null)
returns table (
  student_id uuid, attempt_id uuid, attempt_number integer, status text,
  started_at timestamptz, submitted_at timestamptz, expires_at timestamptz,
  answer_adjustment_seconds integer, answered_count integer, total_questions integer,
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
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can manage paper tests';
  end if;
  if not exists (select 1 from public.assignments where id = p_assignment_id and created_by = v_user and kind = 'paper') then
    raise exception 'Paper test is not managed by this teacher';
  end if;
  if p_class_id is not null and not exists (
    select 1 from public.assignment_classes assignment_class
    join public.classes classroom on classroom.id = assignment_class.class_id
    where assignment_class.assignment_id = p_assignment_id
      and assignment_class.class_id = p_class_id and classroom.teacher_id = v_user
  ) then raise exception 'Class results are not available'; end if;

  return query
  with expected_students as (
    select distinct member.student_id
    from public.assignment_classes assignment_class
    join public.class_members member on member.class_id = assignment_class.class_id
    where assignment_class.assignment_id = p_assignment_id
      and (p_class_id is null or assignment_class.class_id = p_class_id)
  ), assignment_details as (
    select (select count(*)::integer from public.assignment_questions question where question.assignment_id = assignment.id) as question_count
    from public.assignments assignment where assignment.id = p_assignment_id
  )
  select expected.student_id, attempt.id, attempt.attempt_number,
         coalesce(attempt.status, 'not_started'), attempt.started_at,
         attempt.submitted_at, attempt.expires_at,
         coalesce(time_adjustment.adjustment_seconds, 0),
         coalesce(progress.answered_count, 0),
         coalesce(progress.total_questions, details.question_count),
         progress.last_activity_at, coalesce(attempt.exam_focus_violations, 0),
         attempt.form_code, coalesce(attempt.offline_recovery_used, false),
         coalesce(attempt.offline_recovery_seconds, 0)
  from expected_students expected
  cross join assignment_details details
  left join lateral (
    select candidate.* from public.attempts candidate
    where candidate.assignment_id = p_assignment_id and candidate.student_id = expected.student_id
    order by candidate.attempt_number desc, candidate.started_at desc, candidate.id desc limit 1
  ) attempt on true
  left join lateral (
    select count(question.question_id)::integer as total_questions,
           count(response.id) filter (where nullif(btrim(response.student_answer), '') is not null)::integer as answered_count,
           max(response.updated_at) as last_activity_at
    from public.attempt_questions question
    left join public.responses response on response.attempt_id = question.attempt_id and response.question_id = question.question_id
    where question.attempt_id = attempt.id
  ) progress on attempt.id is not null
  left join public.assignment_student_paper_time time_adjustment
    on time_adjustment.assignment_id = p_assignment_id and time_adjustment.student_id = expected.student_id
  order by expected.student_id;
end;
$$;

create or replace function public.release_owned_test_questions(p_assignment_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_released_at timestamptz;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can release tests';
  end if;
  update public.assignments set questions_released_at = coalesce(questions_released_at, now())
  where id = p_assignment_id and created_by = v_user and kind = 'test'
    and status = 'published' and teacher_controlled_question_release
  returning questions_released_at into v_released_at;
  if not found then raise exception 'This test is not waiting for release'; end if;
  return v_released_at;
end;
$$;

create function public.adjust_owned_paper_answer_time(p_assignment_id uuid, p_student_ids uuid[], p_delta_seconds integer)
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
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can manage paper tests';
  end if;
  if p_delta_seconds is null or p_delta_seconds = 0 or p_delta_seconds not between -3600 and 3600 then
    raise exception 'Time adjustment must be between minus and plus 3600 seconds';
  end if;
  if p_student_ids is null or cardinality(p_student_ids) < 1 or cardinality(p_student_ids) > 1000
     or cardinality(p_student_ids) <> (select count(distinct requested.id)::integer from unnest(p_student_ids) requested(id)) then
    raise exception 'Select unique students';
  end if;
  select paper_answer_duration_seconds into v_duration from public.assignments
  where id = p_assignment_id and created_by = v_user and kind = 'paper'
    and status = 'published' and questions_released_at is not null;
  if not found then raise exception 'Paper answer entry is not open'; end if;
  if exists (
    select 1 from unnest(p_student_ids) requested(id)
    left join public.assignment_student_paper_time adjustment
      on adjustment.assignment_id = p_assignment_id and adjustment.student_id = requested.id
    where v_duration + coalesce(adjustment.adjustment_seconds, 0) + p_delta_seconds not between 10 and 7200
       or not exists (
         select 1 from public.assignment_classes assignment_class
         join public.class_members member on member.class_id = assignment_class.class_id
         where assignment_class.assignment_id = p_assignment_id and member.student_id = requested.id
       )
  ) then raise exception 'The requested time would be outside the allowed range'; end if;

  insert into public.assignment_student_paper_time (assignment_id, student_id, adjustment_seconds)
  select p_assignment_id, requested.id, p_delta_seconds from unnest(p_student_ids) requested(id)
  on conflict (assignment_id, student_id) do update
  set adjustment_seconds = public.assignment_student_paper_time.adjustment_seconds + excluded.adjustment_seconds,
      updated_at = now();
  get diagnostics v_updated = row_count;

  update public.attempts
  set expires_at = greatest(now(), expires_at + make_interval(secs => p_delta_seconds))
  where assignment_id = p_assignment_id and student_id = any(p_student_ids)
    and status = 'in_progress' and expires_at is not null;

  insert into public.attempt_exam_events (attempt_id, event_type)
  select attempt.id, 'teacher_extra_time' from public.attempts attempt
  where attempt.assignment_id = p_assignment_id and attempt.student_id = any(p_student_ids)
    and attempt.status = 'in_progress';
  return v_updated;
end;
$$;

create function public.force_submit_all_owned_assessment_attempts(p_assignment_id uuid)
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
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can manage assessments';
  end if;
  if not exists (
    select 1 from public.assignments where id = p_assignment_id and created_by = v_user
      and kind in ('test', 'paper')
      and (kind = 'test' or questions_released_at is not null)
  ) then raise exception 'Assessment is not available to submit'; end if;
  for v_attempt_id in
    select id from public.attempts where assignment_id = p_assignment_id and status = 'in_progress'
    order by started_at, id for update skip locked
  loop
    perform public.finalize_attempt_unchecked(v_attempt_id);
    insert into public.attempt_exam_events (attempt_id, event_type) values (v_attempt_id, 'teacher_submitted');
    v_submitted := v_submitted + 1;
  end loop;
  return v_submitted;
end;
$$;

create or replace function public.force_submit_owned_test_attempt(p_assignment_id uuid, p_attempt_id uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_attempt public.attempts;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can manage assessments';
  end if;
  select attempt.* into v_attempt from public.attempts attempt
  join public.assignments assignment on assignment.id = attempt.assignment_id
  where attempt.id = p_attempt_id and attempt.assignment_id = p_assignment_id
    and attempt.status = 'in_progress' and assignment.created_by = v_user
    and assignment.kind in ('test', 'paper')
    and (assignment.kind = 'test' or assignment.questions_released_at is not null)
  for update of attempt;
  if not found then raise exception 'Active assessment attempt is not available'; end if;
  select * into v_attempt from public.finalize_attempt_unchecked(p_attempt_id);
  insert into public.attempt_exam_events (attempt_id, event_type) values (p_attempt_id, 'teacher_submitted');
  return v_attempt;
end;
$$;

create or replace function public.finalize_expired_test_attempts(p_assignment_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_role text; v_attempt_id uuid; v_finalized integer := 0;
begin
  select profile.role into v_role from public.profiles profile where profile.id = v_user;
  if v_user is null or v_role not in ('student', 'teacher') then
    raise exception 'Only authenticated students and teachers can finalize expired assessments';
  end if;
  for v_attempt_id in
    select attempt.id from public.attempts attempt
    join public.assignments assignment on assignment.id = attempt.assignment_id
    where attempt.status = 'in_progress' and assignment.kind in ('test', 'paper')
      and assignment.status in ('published', 'closed')
      and (assignment.kind = 'test' or assignment.questions_released_at is not null)
      and (p_assignment_id is null or assignment.id = p_assignment_id)
      and public.effective_attempt_deadline(attempt.id) is not null
      and public.effective_attempt_deadline(attempt.id) <= now()
      and ((v_role = 'student' and attempt.student_id = v_user) or (v_role = 'teacher' and assignment.created_by = v_user))
    order by attempt.started_at, attempt.id for update of attempt skip locked
  loop
    perform public.finalize_attempt_unchecked(v_attempt_id);
    insert into public.attempt_exam_events (attempt_id, event_type) values (v_attempt_id, 'time_expired');
    v_finalized := v_finalized + 1;
  end loop;
  return v_finalized;
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
    select 1 from public.attempts attempt
    join public.assignments assignment on assignment.id = attempt.assignment_id
    where attempt.id = p_attempt_id and attempt.student_id = v_user
      and attempt.status = 'in_progress' and assignment.kind = 'paper'
      and assignment.status = 'published' and assignment.questions_released_at is not null
  ) then raise exception 'Paper answer sheet is not available'; end if;
  return query
  select attempt_question.question_id, attempt_question.position, attempt_question.points,
         question.type, case when question.type = 'multiple_choice' then attempt_question.option_order else '{}'::text[] end
  from public.attempt_questions attempt_question
  join public.questions question on question.id = attempt_question.question_id
  where attempt_question.attempt_id = p_attempt_id order by attempt_question.position;
end;
$$;

revoke all on function public.start_owned_paper_session(uuid) from public, anon;
revoke all on function public.release_owned_paper_answers(uuid) from public, anon;
revoke all on function public.get_my_paper_session_state(uuid) from public, anon;
revoke all on function public.get_owned_paper_roster(uuid, uuid) from public, anon;
revoke all on function public.adjust_owned_paper_answer_time(uuid, uuid[], integer) from public, anon;
revoke all on function public.force_submit_all_owned_assessment_attempts(uuid) from public, anon;
grant execute on function public.start_owned_paper_session(uuid) to authenticated;
grant execute on function public.release_owned_paper_answers(uuid) to authenticated;
grant execute on function public.get_my_paper_session_state(uuid) to authenticated;
grant execute on function public.get_owned_paper_roster(uuid, uuid) to authenticated;
grant execute on function public.adjust_owned_paper_answer_time(uuid, uuid[], integer) to authenticated;
grant execute on function public.force_submit_all_owned_assessment_attempts(uuid) to authenticated;
