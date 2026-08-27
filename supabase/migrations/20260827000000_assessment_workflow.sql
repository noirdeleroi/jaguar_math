-- Assessment authoring and student runner. This migration deliberately extends
-- the applied core schema instead of changing its historical definition.

create or replace function public.owns_assignment(p_assignment_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.assignments where id = p_assignment_id and created_by = auth.uid()); $$;

create or replace function public.owns_question(p_question_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.questions where id = p_question_id and created_by = auth.uid()); $$;

create or replace function public.owns_attempt(p_attempt_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.attempts at join public.assignments a on a.id = at.assignment_id where at.id = p_attempt_id and a.created_by = auth.uid()); $$;

-- Keep the student visibility policies from the core migration, but replace the
-- broad teacher policies for assessment material with teacher-owned policies.
drop policy "assignments: teachers manage" on public.assignments;
create policy "assignments: teachers read own" on public.assignments for select to authenticated using (created_by = auth.uid());
create policy "assignments: teachers insert own" on public.assignments for insert to authenticated with check (public.is_teacher() and created_by = auth.uid());
create policy "assignments: teachers update own" on public.assignments for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "assignments: teachers delete own" on public.assignments for delete to authenticated using (created_by = auth.uid());

drop policy "assignment classes: teachers manage" on public.assignment_classes;
create policy "assignment classes: teachers own" on public.assignment_classes for all to authenticated using (public.owns_assignment(assignment_id)) with check (public.owns_assignment(assignment_id));

drop policy "assignment questions: teachers manage" on public.assignment_questions;
create policy "assignment questions: teachers own" on public.assignment_questions for all to authenticated using (public.owns_assignment(assignment_id)) with check (public.owns_assignment(assignment_id));

drop policy "questions: teachers manage" on public.questions;
create policy "questions: teachers own" on public.questions for all to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());

drop policy "question keys: teachers only" on public.question_keys;
create policy "question keys: teachers own" on public.question_keys for all to authenticated using (public.owns_question(question_id)) with check (public.owns_question(question_id));

drop policy "question skills: teachers manage" on public.question_skills;
create policy "question skills: teachers own" on public.question_skills for all to authenticated using (public.owns_question(question_id)) with check (public.owns_question(question_id));

drop policy "attempts: students read own" on public.attempts;
create policy "attempts: students read own" on public.attempts for select to authenticated using (student_id = auth.uid());
create policy "attempts: teachers read own work" on public.attempts for select to authenticated using (public.owns_assignment(assignment_id));

drop policy "responses: students read own" on public.responses;
create policy "responses: students read own" on public.responses for select to authenticated using (exists (select 1 from public.attempts a where a.id = responses.attempt_id and a.student_id = auth.uid()));
create policy "responses: teachers read own work" on public.responses for select to authenticated using (public.owns_attempt(attempt_id));

create or replace function public.create_assignment_draft(
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
  p_questions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_assignment_id uuid;
  v_question jsonb;
  v_question_id uuid;
  v_position integer := 0;
  v_requested_classes integer;
  v_owned_classes integer;
  v_skill_count integer;
  v_found_skill_count integer;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can create assignments';
  end if;
  if nullif(btrim(p_title), '') is null then raise exception 'Title is required'; end if;
  if p_kind not in ('homework', 'quiz', 'test') then raise exception 'Invalid assignment kind'; end if;
  if p_duration_minutes is not null and p_duration_minutes <= 0 then raise exception 'Duration must be positive'; end if;
  if p_max_attempts is null or p_max_attempts < 1 then raise exception 'Maximum attempts must be at least one'; end if;
  if p_class_ids is null or cardinality(p_class_ids) = 0 then raise exception 'At least one class is required'; end if;
  select count(*) into v_requested_classes from (select distinct unnest(p_class_ids) as id) requested;
  if v_requested_classes <> cardinality(p_class_ids) then raise exception 'Classes must be unique'; end if;
  select count(*) into v_owned_classes from public.classes where id = any(p_class_ids) and teacher_id = v_user;
  if v_owned_classes <> v_requested_classes then raise exception 'A selected class is not managed by this teacher'; end if;
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0 then raise exception 'At least one question is required'; end if;

  insert into public.assignments (title, description, kind, due_at, duration_minutes, max_attempts, show_score_after_submit, show_answers_after_submit, shuffle_questions, created_by)
  values (btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_kind, p_due_at, p_duration_minutes, p_max_attempts, p_show_score_after_submit, p_show_answers_after_submit, p_shuffle_questions, v_user)
  returning id into v_assignment_id;

  insert into public.assignment_classes (assignment_id, class_id)
  select v_assignment_id, unnest(p_class_ids);

  for v_question in select value from jsonb_array_elements(p_questions)
  loop
    v_position := v_position + 1;
    if nullif(btrim(v_question ->> 'prompt'), '') is null or coalesce(v_question ->> 'type', '') not in ('multiple_choice', 'numeric', 'short_text') then
      raise exception 'Question % is invalid', v_position;
    end if;
    if coalesce((v_question ->> 'difficulty')::smallint, 0) not between 1 and 5 or coalesce((v_question ->> 'points')::numeric, 0) <= 0 then
      raise exception 'Question % has invalid difficulty or points', v_position;
    end if;
    if nullif(v_question ->> 'correct_answer', '') is null then raise exception 'Question % needs an answer key', v_position; end if;
    if jsonb_typeof(v_question -> 'skills') <> 'array' or jsonb_array_length(v_question -> 'skills') = 0 then raise exception 'Question % needs a skill', v_position; end if;
    if (v_question -> 'options') is not null and jsonb_typeof(v_question -> 'options') <> 'array' then raise exception 'Question % has invalid options', v_position; end if;

    select count(*), count(distinct item ->> 'code') into v_skill_count, v_found_skill_count from jsonb_array_elements(v_question -> 'skills') item;
    if v_skill_count <> v_found_skill_count then raise exception 'Question % has duplicate skills', v_position; end if;
    select count(*) into v_found_skill_count from public.skills s join jsonb_array_elements(v_question -> 'skills') item on item ->> 'code' = s.code;
    if v_found_skill_count <> v_skill_count then raise exception 'Question % references an unknown skill', v_position; end if;

    insert into public.questions (prompt, type, options, difficulty, icfes_competency, created_by)
    values (btrim(v_question ->> 'prompt'), v_question ->> 'type', v_question -> 'options', (v_question ->> 'difficulty')::smallint, nullif(v_question ->> 'icfes_competency', ''), v_user)
    returning id into v_question_id;
    insert into public.question_keys (question_id, correct_answer, numeric_tolerance, explanation)
    values (v_question_id, v_question ->> 'correct_answer', coalesce((v_question ->> 'numeric_tolerance')::numeric, 0), nullif(v_question ->> 'explanation', ''));
    insert into public.question_skills (question_id, skill_id, weight, is_primary)
    select v_question_id, s.id, coalesce((item ->> 'weight')::numeric, 1), coalesce((item ->> 'is_primary')::boolean, false)
    from jsonb_array_elements(v_question -> 'skills') item join public.skills s on s.code = item ->> 'code';
    insert into public.assignment_questions (assignment_id, question_id, position, points)
    values (v_assignment_id, v_question_id, v_position, (v_question ->> 'points')::numeric);
  end loop;
  return v_assignment_id;
end;
$$;

create or replace function public.update_owned_assignment(
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
  p_class_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_requested integer; v_owned integer;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then raise exception 'Only authenticated teachers can edit assignments'; end if;
  if not exists (select 1 from public.assignments where id = p_assignment_id and created_by = v_user) then raise exception 'Assignment is not managed by this teacher'; end if;
  if nullif(btrim(p_title), '') is null or p_kind not in ('homework', 'quiz', 'test') or p_max_attempts < 1 or (p_duration_minutes is not null and p_duration_minutes <= 0) then raise exception 'Invalid assignment settings'; end if;
  if p_class_ids is null or cardinality(p_class_ids) = 0 then raise exception 'At least one class is required'; end if;
  select count(*) into v_requested from (select distinct unnest(p_class_ids) as id) requested;
  if v_requested <> cardinality(p_class_ids) then raise exception 'Classes must be unique'; end if;
  select count(*) into v_owned from public.classes where id = any(p_class_ids) and teacher_id = v_user;
  if v_owned <> v_requested then raise exception 'A selected class is not managed by this teacher'; end if;
  update public.assignments set title = btrim(p_title), description = nullif(btrim(coalesce(p_description, '')), ''), kind = p_kind, due_at = p_due_at, duration_minutes = p_duration_minutes, max_attempts = p_max_attempts, show_score_after_submit = p_show_score_after_submit, show_answers_after_submit = p_show_answers_after_submit, shuffle_questions = p_shuffle_questions where id = p_assignment_id;
  delete from public.assignment_classes where assignment_id = p_assignment_id;
  insert into public.assignment_classes (assignment_id, class_id) select p_assignment_id, unnest(p_class_ids);
end;
$$;

create or replace function public.publish_owned_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then raise exception 'Only authenticated teachers can publish assignments'; end if;
  if not exists (select 1 from public.assignments where id = p_assignment_id and created_by = v_user) then raise exception 'Assignment is not managed by this teacher'; end if;
  if not exists (select 1 from public.assignment_classes where assignment_id = p_assignment_id) or not exists (select 1 from public.assignment_questions where assignment_id = p_assignment_id) then raise exception 'Assignments need classes and questions before publishing'; end if;
  update public.assignments set status = 'published', published_at = coalesce(published_at, now()) where id = p_assignment_id;
end;
$$;

create or replace function public.save_response(p_attempt_id uuid, p_question_id uuid, p_student_answer text)
returns public.responses
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_response public.responses; v_started_at timestamptz; v_duration integer; v_due_at timestamptz;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'student') then raise exception 'Only authenticated students can save responses'; end if;
  select a.started_at, assignment.duration_minutes, assignment.due_at into v_started_at, v_duration, v_due_at from public.attempts a join public.assignments assignment on assignment.id = a.assignment_id where a.id = p_attempt_id and a.student_id = v_user and a.status = 'in_progress';
  if not found then raise exception 'Attempt is not available for editing'; end if;
  if (v_duration is not null and now() > v_started_at + make_interval(mins => v_duration)) or (v_due_at is not null and now() > v_due_at) then raise exception 'The response window has closed'; end if;
  if not exists (select 1 from public.attempts a join public.assignment_questions aq on aq.assignment_id = a.assignment_id where a.id = p_attempt_id and aq.question_id = p_question_id) then raise exception 'Question is not part of this attempt'; end if;
  insert into public.responses (attempt_id, question_id, student_answer) values (p_attempt_id, p_question_id, p_student_answer)
  on conflict (attempt_id, question_id) do update set student_answer = excluded.student_answer, is_correct = null, points_awarded = null, answered_at = now(), updated_at = now()
  returning * into v_response;
  return v_response;
end;
$$;

create or replace function public.start_attempt(p_assignment_id uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_assignment public.assignments; v_attempt public.attempts; v_next integer;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'student') then raise exception 'Only authenticated students can start attempts'; end if;
  select * into v_assignment from public.assignments where id = p_assignment_id and status = 'published';
  if not found or (v_assignment.due_at is not null and now() > v_assignment.due_at) then raise exception 'Assignment is not available'; end if;
  if not exists (select 1 from public.assignment_classes ac join public.class_members cm on cm.class_id = ac.class_id where ac.assignment_id = p_assignment_id and cm.student_id = v_user) then raise exception 'Assignment is not assigned to this student'; end if;
  perform pg_advisory_xact_lock(hashtext(p_assignment_id::text), hashtext(v_user::text));
  select count(*) + 1 into v_next from public.attempts where assignment_id = p_assignment_id and student_id = v_user;
  if v_next > v_assignment.max_attempts then raise exception 'Maximum attempts reached'; end if;
  insert into public.attempts (assignment_id, student_id, attempt_number) values (p_assignment_id, v_user, v_next) returning * into v_attempt;
  return v_attempt;
end;
$$;

create or replace function public.get_attempt_answer_review(p_attempt_id uuid)
returns table(question_id uuid, prompt text, question_type text, options jsonb, student_answer text, is_correct boolean, points_awarded numeric, points numeric, correct_answer text, explanation text)
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.attempts a join public.assignments assignment on assignment.id = a.assignment_id where a.id = p_attempt_id and a.student_id = v_user and a.status = 'submitted' and assignment.show_answers_after_submit) then
    raise exception 'Answer review is not available';
  end if;
  return query select q.id, q.prompt, q.type, q.options, r.student_answer, r.is_correct, r.points_awarded, aq.points, key.correct_answer, key.explanation
  from public.attempts a join public.assignment_questions aq on aq.assignment_id = a.assignment_id join public.questions q on q.id = aq.question_id join public.responses r on r.attempt_id = a.id and r.question_id = q.id join public.question_keys key on key.question_id = q.id
  where a.id = p_attempt_id order by aq.position;
end;
$$;

revoke all on function public.create_assignment_draft(text, text, text, timestamptz, integer, integer, boolean, boolean, boolean, uuid[], jsonb) from public;
revoke all on function public.update_owned_assignment(uuid, text, text, text, timestamptz, integer, integer, boolean, boolean, boolean, uuid[]) from public;
revoke all on function public.publish_owned_assignment(uuid) from public;
revoke all on function public.get_attempt_answer_review(uuid) from public;
revoke all on function public.owns_assignment(uuid) from public;
revoke all on function public.owns_question(uuid) from public;
revoke all on function public.owns_attempt(uuid) from public;
revoke all on function public.start_attempt(uuid) from public;
revoke all on function public.save_response(uuid, uuid, text) from public;
grant execute on function public.create_assignment_draft(text, text, text, timestamptz, integer, integer, boolean, boolean, boolean, uuid[], jsonb) to authenticated;
grant execute on function public.update_owned_assignment(uuid, text, text, text, timestamptz, integer, integer, boolean, boolean, boolean, uuid[]) to authenticated;
grant execute on function public.publish_owned_assignment(uuid) to authenticated;
grant execute on function public.get_attempt_answer_review(uuid) to authenticated;
grant execute on function public.owns_assignment(uuid) to authenticated;
grant execute on function public.owns_question(uuid) to authenticated;
grant execute on function public.owns_attempt(uuid) to authenticated;
grant execute on function public.start_attempt(uuid) to authenticated;
grant execute on function public.save_response(uuid, uuid, text) to authenticated;
