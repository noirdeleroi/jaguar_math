-- Assessment readiness: distinguish practice from secure assessments, create a
-- durable per-attempt form, and support idempotent batched response syncing.

alter table public.assignments
  add column if not exists shuffle_options boolean not null default false;

alter table public.assignments
  alter column exam_violation_action set default 'warn';

alter table public.attempts
  add column if not exists form_code text,
  add column if not exists expires_at timestamptz,
  add column if not exists offline_recovery_used boolean not null default false,
  add column if not exists offline_recovery_seconds integer not null default 0
    check (offline_recovery_seconds >= 0);

alter table public.responses
  add column if not exists client_revision bigint not null default 0
    check (client_revision >= 0);

create table public.attempt_questions (
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  position integer not null check (position > 0),
  points numeric not null check (points > 0),
  option_order text[] not null default '{}',
  primary key (attempt_id, question_id),
  unique (attempt_id, position)
);

create index attempt_questions_question_idx on public.attempt_questions (question_id);

insert into public.attempt_questions (attempt_id, question_id, position, points, option_order)
select a.id, aq.question_id, aq.position, aq.points,
       coalesce((
         select array_agg(option_item.value ->> 'id' order by option_item.ordinality)
         from jsonb_array_elements(coalesce(q.options, '[]'::jsonb)) with ordinality as option_item(value, ordinality)
       ), '{}'::text[])
from public.attempts a
join public.assignment_questions aq on aq.assignment_id = a.assignment_id
join public.questions q on q.id = aq.question_id
on conflict (attempt_id, question_id) do nothing;

update public.attempts a
set form_code = coalesce(a.form_code, upper(substr(replace(a.id::text, '-', ''), 1, 6))),
    expires_at = coalesce(a.expires_at, case when assignment.duration_minutes is null then null else a.started_at + make_interval(mins => assignment.duration_minutes) end)
from public.assignments assignment
where assignment.id = a.assignment_id;

alter table public.attempt_questions enable row level security;
revoke all on table public.attempt_questions from anon, public;
grant select on table public.attempt_questions to authenticated;

create policy "attempt questions: students read own" on public.attempt_questions
for select to authenticated
using (exists (
  select 1 from public.attempts a
  where a.id = attempt_questions.attempt_id and a.student_id = auth.uid()
));

create policy "attempt questions: teachers read owned" on public.attempt_questions
for select to authenticated
using (public.owns_attempt(attempt_id));

-- Homework is learning mode. Quizzes/tests are not readable until the student
-- has started an attempt, preventing the pre-start RSC/Supabase question leak.
drop policy "questions: students read assigned published or closed questions" on public.questions;
create policy "questions: students read eligible assessment questions" on public.questions
for select to authenticated
using (exists (
  select 1
  from public.assignment_questions aq
  join public.assignments a on a.id = aq.assignment_id
  join public.assignment_classes ac on ac.assignment_id = a.id
  join public.class_members cm on cm.class_id = ac.class_id
  where aq.question_id = questions.id
    and a.status in ('published', 'closed')
    and cm.student_id = auth.uid()
    and (
      a.kind = 'homework'
      or exists (
        select 1 from public.attempts attempt
        where attempt.assignment_id = a.id and attempt.student_id = auth.uid()
      )
    )
));

drop policy "question skills: students read assigned published or closed mappings" on public.question_skills;
create policy "question skills: students read eligible assessment mappings" on public.question_skills
for select to authenticated
using (exists (
  select 1
  from public.assignment_questions aq
  join public.assignments a on a.id = aq.assignment_id
  join public.assignment_classes ac on ac.assignment_id = a.id
  join public.class_members cm on cm.class_id = ac.class_id
  where aq.question_id = question_skills.question_id
    and a.status in ('published', 'closed')
    and cm.student_id = auth.uid()
    and (
      a.kind = 'homework'
      or exists (
        select 1 from public.attempts attempt
        where attempt.assignment_id = a.id and attempt.student_id = auth.uid()
      )
    )
));

drop policy "assignment questions: students read published or closed composition" on public.assignment_questions;
create policy "assignment questions: students read eligible composition" on public.assignment_questions
for select to authenticated
using (exists (
  select 1
  from public.assignments a
  join public.assignment_classes ac on ac.assignment_id = a.id
  join public.class_members cm on cm.class_id = ac.class_id
  where a.id = assignment_questions.assignment_id
    and a.status in ('published', 'closed')
    and cm.student_id = auth.uid()
));

create or replace function public.enforce_assignment_kind_policy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'homework' then
    new.exam_mode := false;
    new.exam_require_fullscreen := false;
    new.exam_track_focus_exits := false;
  elsif new.kind = 'quiz' then
    new.max_attempts := 1;
    new.show_feedback_after_each_question := false;
    if new.status <> 'closed' then new.show_answers_after_submit := false; end if;
  elsif new.kind = 'test' then
    new.duration_minutes := coalesce(new.duration_minutes, 60);
    new.max_attempts := 1;
    if new.status <> 'closed' then
      new.show_score_after_submit := false;
      new.show_answers_after_submit := false;
    end if;
    new.show_feedback_after_each_question := false;
    new.question_display_mode := 'one_at_a_time';
    new.shuffle_questions := true;
    new.shuffle_options := true;
    new.exam_mode := true;
    new.exam_require_fullscreen := true;
    new.exam_track_focus_exits := true;
  end if;
  return new;
end;
$$;

create trigger assignments_enforce_kind_policy
before insert or update on public.assignments
for each row execute function public.enforce_assignment_kind_policy();

-- Bring existing rows under the same semantic policy as newly created work.
update public.assignments set kind = kind where kind in ('homework', 'quiz', 'test');

create or replace function public.start_attempt(p_assignment_id uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_assignment public.assignments;
  v_attempt public.attempts;
  v_next integer;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'student') then
    raise exception 'Only authenticated students can start attempts';
  end if;
  select * into v_assignment from public.assignments where id = p_assignment_id and status = 'published';
  if not found or (v_assignment.due_at is not null and now() > v_assignment.due_at) then
    raise exception 'Assignment is not available';
  end if;
  if not exists (
    select 1 from public.assignment_classes ac
    join public.class_members cm on cm.class_id = ac.class_id
    where ac.assignment_id = p_assignment_id and cm.student_id = v_user
  ) then raise exception 'Assignment is not assigned to this student'; end if;

  perform pg_advisory_xact_lock(hashtext(p_assignment_id::text), hashtext(v_user::text));
  select * into v_attempt from public.attempts
  where assignment_id = p_assignment_id and student_id = v_user and status = 'in_progress'
  order by attempt_number desc
  limit 1;
  if found then return v_attempt; end if;
  select count(*) + 1 into v_next from public.attempts where assignment_id = p_assignment_id and student_id = v_user;
  if v_next > v_assignment.max_attempts then raise exception 'Maximum attempts reached'; end if;

  insert into public.attempts (assignment_id, student_id, attempt_number, expires_at)
  values (
    p_assignment_id,
    v_user,
    v_next,
    case when v_assignment.duration_minutes is null then null else now() + make_interval(mins => v_assignment.duration_minutes) end
  ) returning * into v_attempt;

  update public.attempts
  set form_code = upper(substr(replace(v_attempt.id::text, '-', ''), 1, 6))
  where id = v_attempt.id
  returning * into v_attempt;

  insert into public.attempt_questions (attempt_id, question_id, position, points, option_order)
  select v_attempt.id,
         ordered.question_id,
         row_number() over (order by ordered.sort_key, ordered.original_position)::integer,
         ordered.points,
         ordered.option_order
  from (
    select aq.question_id,
           aq.position as original_position,
           aq.points,
           case when v_assignment.shuffle_questions
             then md5(v_attempt.id::text || ':' || aq.question_id::text)
             else lpad(aq.position::text, 12, '0')
           end as sort_key,
           case when v_assignment.shuffle_options then
             coalesce((
               select array_agg(option_item.value ->> 'id' order by md5(v_attempt.id::text || ':' || aq.question_id::text || ':' || (option_item.value ->> 'id')))
               from jsonb_array_elements(coalesce(q.options, '[]'::jsonb)) as option_item(value)
             ), '{}'::text[])
           else
             coalesce((
               select array_agg(option_item.value ->> 'id' order by option_item.ordinality)
               from jsonb_array_elements(coalesce(q.options, '[]'::jsonb)) with ordinality as option_item(value, ordinality)
             ), '{}'::text[])
           end as option_order
    from public.assignment_questions aq
    join public.questions q on q.id = aq.question_id
    where aq.assignment_id = p_assignment_id
  ) ordered;

  return v_attempt;
end;
$$;

create function public.create_assignment_draft_ready(
  p_title text, p_description text, p_kind text, p_due_at timestamptz,
  p_duration_minutes integer, p_max_attempts integer,
  p_show_score_after_submit boolean, p_show_answers_after_submit boolean,
  p_shuffle_questions boolean, p_shuffle_options boolean,
  p_class_ids uuid[], p_questions jsonb,
  p_exam_mode boolean, p_exam_require_fullscreen boolean,
  p_exam_track_focus_exits boolean, p_exam_allowed_focus_exits integer,
  p_exam_violation_action text, p_question_display_mode text,
  p_show_feedback_after_each_question boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_assignment_id uuid;
begin
  select public.create_assignment_draft_with_presentation(
    p_title, p_description, p_kind, p_due_at, p_duration_minutes,
    p_max_attempts, p_show_score_after_submit, p_show_answers_after_submit,
    p_shuffle_questions, p_class_ids, p_questions, p_exam_mode,
    p_exam_require_fullscreen, p_exam_track_focus_exits,
    p_exam_allowed_focus_exits, p_exam_violation_action,
    p_question_display_mode, p_show_feedback_after_each_question
  ) into v_assignment_id;
  update public.assignments set shuffle_options = coalesce(p_shuffle_options, false)
  where id = v_assignment_id and created_by = auth.uid();
  return v_assignment_id;
end;
$$;

create function public.update_owned_assignment_ready(
  p_assignment_id uuid, p_title text, p_description text, p_kind text,
  p_due_at timestamptz, p_duration_minutes integer, p_max_attempts integer,
  p_show_score_after_submit boolean, p_show_answers_after_submit boolean,
  p_shuffle_questions boolean, p_shuffle_options boolean,
  p_class_ids uuid[], p_exam_mode boolean,
  p_exam_require_fullscreen boolean, p_exam_track_focus_exits boolean,
  p_exam_allowed_focus_exits integer, p_exam_violation_action text,
  p_question_display_mode text, p_show_feedback_after_each_question boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.update_owned_assignment_with_presentation(
    p_assignment_id, p_title, p_description, p_kind, p_due_at,
    p_duration_minutes, p_max_attempts, p_show_score_after_submit,
    p_show_answers_after_submit, p_shuffle_questions, p_class_ids,
    p_exam_mode, p_exam_require_fullscreen, p_exam_track_focus_exits,
    p_exam_allowed_focus_exits, p_exam_violation_action,
    p_question_display_mode, p_show_feedback_after_each_question
  );
  update public.assignments set shuffle_options = coalesce(p_shuffle_options, false)
  where id = p_assignment_id and created_by = auth.uid();
end;
$$;

create function public.duplicate_owned_assignment_ready(p_assignment_id uuid)
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
  select public.duplicate_owned_assignment_with_presentation(p_assignment_id) into v_copy_id;
  update public.assignments set shuffle_options = v_source.shuffle_options
  where id = v_copy_id and created_by = v_user;
  return v_copy_id;
end;
$$;

create function public.save_response_batch(p_attempt_id uuid, p_responses jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.attempts;
  v_assignment_status text;
  v_due_at timestamptz;
  v_saved integer := 0;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'student') then
    raise exception 'Only authenticated students can save responses';
  end if;
  if p_responses is null or jsonb_typeof(p_responses) <> 'array' or jsonb_array_length(p_responses) not between 1 and 200 then
    raise exception 'Response batch is invalid';
  end if;

  select a.* into v_attempt
  from public.attempts a
  where a.id = p_attempt_id and a.student_id = v_user and a.status = 'in_progress'
  for update;
  if not found then raise exception 'Attempt is not available for editing'; end if;
  select status, due_at into v_assignment_status, v_due_at
  from public.assignments where id = v_attempt.assignment_id;
  if v_assignment_status <> 'published' then raise exception 'Assignment is closed'; end if;
  if (v_attempt.expires_at is not null and now() > v_attempt.expires_at) or (v_due_at is not null and now() > v_due_at) then
    raise exception 'The response window has closed';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_responses) as response_item(question_id uuid, student_answer text, client_revision bigint)
    left join public.attempt_questions aq
      on aq.attempt_id = p_attempt_id and aq.question_id = response_item.question_id
    where aq.question_id is null
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

-- One grading path is shared by student submission and teacher close. It has no
-- public execute permission; its callers are responsible for authorization.
create function public.finalize_attempt_unchecked(p_attempt_id uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.attempts;
  v_score numeric;
  v_max_score numeric;
begin
  select * into v_attempt from public.attempts
  where id = p_attempt_id and status = 'in_progress'
  for update;
  if not found then raise exception 'Attempt is not available'; end if;

  if exists (
    select 1
    from public.attempt_questions aq
    left join public.question_keys key on key.question_id = aq.question_id
    where aq.attempt_id = p_attempt_id and key.question_id is null
  ) then raise exception 'Assessment contains an ungradable question'; end if;

  insert into public.responses (attempt_id, question_id, student_answer)
  select p_attempt_id, aq.question_id, null
  from public.attempt_questions aq
  where aq.attempt_id = p_attempt_id
    and not exists (
      select 1 from public.responses r
      where r.attempt_id = p_attempt_id and r.question_id = aq.question_id
    );

  with grading as (
    select r.id, aq.points, case q.type
      when 'multiple_choice' then lower(btrim(coalesce(r.student_answer, ''))) = lower(btrim(key.correct_answer))
      when 'short_text' then lower(btrim(coalesce(r.student_answer, ''))) = lower(btrim(key.correct_answer))
      when 'numeric' then public.try_parse_numeric(r.student_answer) is not null
        and public.try_parse_numeric(key.correct_answer) is not null
        and abs(public.try_parse_numeric(r.student_answer) - public.try_parse_numeric(key.correct_answer)) <= key.numeric_tolerance
    end as correct
    from public.responses r
    join public.attempt_questions aq on aq.question_id = r.question_id and aq.attempt_id = p_attempt_id
    join public.questions q on q.id = r.question_id
    join public.question_keys key on key.question_id = q.id
    where r.attempt_id = p_attempt_id
  )
  update public.responses r
  set is_correct = grading.correct,
      points_awarded = case when grading.correct then grading.points else 0 end,
      updated_at = now()
  from grading
  where r.id = grading.id;

  select coalesce(sum(r.points_awarded), 0), coalesce(sum(aq.points), 0)
  into v_score, v_max_score
  from public.attempt_questions aq
  left join public.responses r on r.question_id = aq.question_id and r.attempt_id = p_attempt_id
  where aq.attempt_id = p_attempt_id;

  update public.attempts
  set status = 'submitted', submitted_at = now(), score = v_score, max_score = v_max_score
  where id = p_attempt_id
  returning * into v_attempt;
  return v_attempt;
end;
$$;

-- Closing an assessment is the explicit release point for protected results.
-- Homework keeps the teacher's chosen feedback settings.
create or replace function public.close_owned_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_attempt_id uuid;
  v_exam_mode boolean;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can close assignments';
  end if;
  if not exists (select 1 from public.assignments where id = p_assignment_id and created_by = v_user) then
    raise exception 'Assignment is not managed by this teacher';
  end if;
  select exam_mode into v_exam_mode from public.assignments where id = p_assignment_id;
  for v_attempt_id in
    select id from public.attempts
    where assignment_id = p_assignment_id and status = 'in_progress'
    for update
  loop
    perform public.finalize_attempt_unchecked(v_attempt_id);
    if v_exam_mode then
      insert into public.attempt_exam_events (attempt_id, event_type)
      values (v_attempt_id, 'teacher_closed');
    end if;
  end loop;
  update public.assignments
  set status = 'closed',
      show_score_after_submit = case when kind in ('quiz', 'test') then true else show_score_after_submit end,
      show_answers_after_submit = case when kind in ('quiz', 'test') then true else show_answers_after_submit end
  where id = p_assignment_id and status = 'published';
  if not found then raise exception 'Only published assignments can be closed'; end if;
end;
$$;

create or replace function public.reopen_owned_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can reopen assignments';
  end if;
  if not exists (select 1 from public.assignments where id = p_assignment_id and created_by = v_user) then
    raise exception 'Assignment is not managed by this teacher';
  end if;
  update public.assignments
  set status = 'published',
      show_score_after_submit = case when kind = 'test' then false else show_score_after_submit end,
      show_answers_after_submit = case when kind in ('quiz', 'test') then false else show_answers_after_submit end
  where id = p_assignment_id and status = 'closed';
  if not found then raise exception 'Only closed assignments can be reopened'; end if;
end;
$$;

alter table public.attempt_exam_events
  drop constraint if exists attempt_exam_events_event_type_check;
alter table public.attempt_exam_events
  add constraint attempt_exam_events_event_type_check check (event_type in ('assessment_started', 'page_hidden', 'page_visible', 'window_blur', 'window_focus', 'fullscreen_exited', 'fullscreen_restored', 'fullscreen_unavailable', 'auto_submit', 'manual_submit', 'time_expired', 'teacher_closed'));

-- Direct RPC submission can grade only responses that reached the server. The
-- snapshot function below is the only path that may sync data after a deadline.
create or replace function public.submit_attempt(p_attempt_id uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.attempts;
  v_assignment public.assignments;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'student') then
    raise exception 'Only authenticated students can submit attempts';
  end if;
  select * into v_attempt from public.attempts
  where id = p_attempt_id and student_id = v_user and status = 'in_progress'
  for update;
  if not found then raise exception 'Attempt is not available'; end if;
  select * into v_assignment from public.assignments where id = v_attempt.assignment_id;
  if v_assignment.status <> 'published' then raise exception 'Assignment is closed'; end if;
  return public.finalize_attempt_unchecked(p_attempt_id);
end;
$$;

create or replace function public.finish_exam_attempt(p_attempt_id uuid, p_event_type text)
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
  if p_event_type not in ('manual_submit', 'auto_submit', 'time_expired') then raise exception 'Exam submission type is invalid'; end if;
  select a.* into v_attempt from public.attempts a where a.id = p_attempt_id and a.student_id = v_user and a.status = 'in_progress';
  if not found then raise exception 'Attempt is not available'; end if;
  select exam_mode into v_exam_mode from public.assignments where id = v_attempt.assignment_id;
  if not v_exam_mode then raise exception 'Exam Mode is not enabled'; end if;
  select * into v_attempt from public.submit_attempt(p_attempt_id);
  insert into public.attempt_exam_events (attempt_id, event_type) values (v_attempt.id, p_event_type);
  return v_attempt;
end;
$$;

create function public.submit_attempt_snapshot(
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
  select * into v_attempt from public.attempts
  where id = p_attempt_id and student_id = v_user and status = 'in_progress'
  for update;
  if not found then raise exception 'Attempt is not available'; end if;
  select * into v_assignment from public.assignments where id = v_attempt.assignment_id;
  if v_assignment.status <> 'published' then raise exception 'Assignment is closed'; end if;

  v_deadline := case
    when v_attempt.expires_at is null then v_assignment.due_at
    when v_assignment.due_at is null then v_attempt.expires_at
    else least(v_attempt.expires_at, v_assignment.due_at)
  end;
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
    left join public.attempt_questions aq on aq.attempt_id = p_attempt_id and aq.question_id = response_item.question_id
    where aq.question_id is null or response_item.client_revision is null or response_item.client_revision < 0 or char_length(coalesce(response_item.student_answer, '')) > 20000
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

-- Focus events remain evidence. Teachers can choose review-only behavior or a
-- strict auto-submit policy instead of every exam being forcibly punitive.
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

  select * into v_attempt from public.attempts
  where id = p_attempt_id and student_id = v_user for update;
  if not found then raise exception 'Attempt is not available'; end if;
  select * into v_assignment from public.assignments where id = v_attempt.assignment_id;
  if not v_assignment.exam_mode then raise exception 'Exam Mode is not enabled'; end if;
  if v_attempt.status <> 'in_progress' then
    return query select v_attempt.exam_focus_violations, exists (
      select 1 from public.attempt_exam_events
      where attempt_id = p_attempt_id and event_type = 'auto_submit'
    );
    return;
  end if;

  insert into public.attempt_exam_events (attempt_id, client_event_id, event_type, away_duration_seconds)
  values (p_attempt_id, p_client_event_id, p_event_type, p_away_duration_seconds)
  on conflict (attempt_id, client_event_id) do nothing
  returning true into v_inserted;
  if not v_inserted then
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

revoke all on function public.enforce_assignment_kind_policy() from public;
revoke all on function public.finalize_attempt_unchecked(uuid) from public;
revoke all on function public.create_assignment_draft_ready(text, text, text, timestamptz, integer, integer, boolean, boolean, boolean, boolean, uuid[], jsonb, boolean, boolean, boolean, integer, text, text, boolean) from public;
revoke all on function public.update_owned_assignment_ready(uuid, text, text, text, timestamptz, integer, integer, boolean, boolean, boolean, boolean, uuid[], boolean, boolean, boolean, integer, text, text, boolean) from public;
revoke all on function public.duplicate_owned_assignment_ready(uuid) from public;
revoke all on function public.save_response_batch(uuid, jsonb) from public;
revoke all on function public.submit_attempt_snapshot(uuid, jsonb, timestamptz, boolean) from public;
grant execute on function public.create_assignment_draft_ready(text, text, text, timestamptz, integer, integer, boolean, boolean, boolean, boolean, uuid[], jsonb, boolean, boolean, boolean, integer, text, text, boolean) to authenticated;
grant execute on function public.update_owned_assignment_ready(uuid, text, text, text, timestamptz, integer, integer, boolean, boolean, boolean, boolean, uuid[], boolean, boolean, boolean, integer, text, text, boolean) to authenticated;
grant execute on function public.duplicate_owned_assignment_ready(uuid) to authenticated;
grant execute on function public.save_response_batch(uuid, jsonb) to authenticated;
grant execute on function public.submit_attempt_snapshot(uuid, jsonb, timestamptz, boolean) to authenticated;
