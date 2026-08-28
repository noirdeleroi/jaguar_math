-- Assignment lifecycle: preserve draft/published/closed, expose closed work
-- read-only to assigned students, and enforce closure inside student RPCs.

drop policy "assignments: students read published class work" on public.assignments;
create policy "assignments: students read published or closed class work" on public.assignments
for select to authenticated
using (
  status in ('published', 'closed')
  and exists (
    select 1
    from public.assignment_classes ac
    join public.class_members cm on cm.class_id = ac.class_id
    where ac.assignment_id = assignments.id and cm.student_id = auth.uid()
  )
);

drop policy "questions: students read assigned published questions" on public.questions;
create policy "questions: students read assigned published or closed questions" on public.questions
for select to authenticated
using (
  exists (
    select 1
    from public.assignment_questions aq
    join public.assignments a on a.id = aq.assignment_id
    join public.assignment_classes ac on ac.assignment_id = a.id
    join public.class_members cm on cm.class_id = ac.class_id
    where aq.question_id = questions.id
      and a.status in ('published', 'closed')
      and cm.student_id = auth.uid()
  )
);

drop policy "question skills: students read assigned mappings" on public.question_skills;
create policy "question skills: students read assigned published or closed mappings" on public.question_skills
for select to authenticated
using (
  exists (
    select 1
    from public.assignment_questions aq
    join public.assignments a on a.id = aq.assignment_id
    join public.assignment_classes ac on ac.assignment_id = a.id
    join public.class_members cm on cm.class_id = ac.class_id
    where aq.question_id = question_skills.question_id
      and a.status in ('published', 'closed')
      and cm.student_id = auth.uid()
  )
);

drop policy "assignment questions: students read assigned composition" on public.assignment_questions;
create policy "assignment questions: students read published or closed composition" on public.assignment_questions
for select to authenticated
using (
  exists (
    select 1
    from public.assignments a
    join public.assignment_classes ac on ac.assignment_id = a.id
    join public.class_members cm on cm.class_id = ac.class_id
    where a.id = assignment_questions.assignment_id
      and a.status in ('published', 'closed')
      and cm.student_id = auth.uid()
  )
);

create or replace function public.close_owned_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can close assignments';
  end if;
  if not exists (select 1 from public.assignments where id = p_assignment_id and created_by = v_user) then
    raise exception 'Assignment is not managed by this teacher';
  end if;
  update public.assignments
  set status = 'closed'
  where id = p_assignment_id and status = 'published';
  if not found then
    raise exception 'Only published assignments can be closed';
  end if;
end;
$$;

create or replace function public.reopen_owned_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can reopen assignments';
  end if;
  if not exists (select 1 from public.assignments where id = p_assignment_id and created_by = v_user) then
    raise exception 'Assignment is not managed by this teacher';
  end if;
  update public.assignments
  set status = 'published'
  where id = p_assignment_id and status = 'closed';
  if not found then
    raise exception 'Only closed assignments can be reopened';
  end if;
end;
$$;

create or replace function public.save_response(p_attempt_id uuid, p_question_id uuid, p_student_answer text)
returns public.responses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_response public.responses;
  v_started_at timestamptz;
  v_duration integer;
  v_due_at timestamptz;
  v_assignment_status text;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'student') then raise exception 'Only authenticated students can save responses'; end if;
  select a.started_at, assignment.duration_minutes, assignment.due_at, assignment.status
  into v_started_at, v_duration, v_due_at, v_assignment_status
  from public.attempts a
  join public.assignments assignment on assignment.id = a.assignment_id
  where a.id = p_attempt_id and a.student_id = v_user and a.status = 'in_progress';
  if not found then raise exception 'Attempt is not available for editing'; end if;
  if v_assignment_status <> 'published' then raise exception 'Assignment is closed'; end if;
  if (v_duration is not null and now() > v_started_at + make_interval(mins => v_duration)) or (v_due_at is not null and now() > v_due_at) then raise exception 'The response window has closed'; end if;
  if not exists (select 1 from public.attempts a join public.assignment_questions aq on aq.assignment_id = a.assignment_id where a.id = p_attempt_id and aq.question_id = p_question_id) then raise exception 'Question is not part of this attempt'; end if;
  insert into public.responses (attempt_id, question_id, student_answer) values (p_attempt_id, p_question_id, p_student_answer)
  on conflict (attempt_id, question_id) do update set student_answer = excluded.student_answer, is_correct = null, points_awarded = null, answered_at = now(), updated_at = now()
  returning * into v_response;
  return v_response;
end;
$$;

create or replace function public.submit_attempt(p_attempt_id uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.attempts;
  v_score numeric;
  v_max_score numeric;
  v_assignment_status text;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'student') then raise exception 'Only authenticated students can submit attempts'; end if;
  select * into v_attempt from public.attempts where id = p_attempt_id and student_id = v_user for update;
  if not found then raise exception 'Attempt not found'; end if;
  if v_attempt.status <> 'in_progress' then raise exception 'Attempt has already been submitted'; end if;
  select status into v_assignment_status from public.assignments where id = v_attempt.assignment_id;
  if v_assignment_status <> 'published' then raise exception 'Assignment is closed'; end if;
  if exists (select 1 from public.assignment_questions aq left join public.question_keys key on key.question_id = aq.question_id where aq.assignment_id = v_attempt.assignment_id and key.question_id is null) then raise exception 'Assignment contains an ungradable question'; end if;
  insert into public.responses (attempt_id, question_id, student_answer)
  select v_attempt.id, aq.question_id, null from public.assignment_questions aq
  where aq.assignment_id = v_attempt.assignment_id and not exists (select 1 from public.responses r where r.attempt_id = v_attempt.id and r.question_id = aq.question_id);
  with grading as (
    select r.id, aq.points, case q.type
      when 'multiple_choice' then lower(btrim(coalesce(r.student_answer, ''))) = lower(btrim(key.correct_answer))
      when 'short_text' then lower(btrim(coalesce(r.student_answer, ''))) = lower(btrim(key.correct_answer))
      when 'numeric' then public.try_parse_numeric(r.student_answer) is not null and public.try_parse_numeric(key.correct_answer) is not null and abs(public.try_parse_numeric(r.student_answer) - public.try_parse_numeric(key.correct_answer)) <= key.numeric_tolerance
    end as correct
    from public.responses r join public.assignment_questions aq on aq.question_id = r.question_id and aq.assignment_id = v_attempt.assignment_id join public.questions q on q.id = r.question_id join public.question_keys key on key.question_id = q.id
    where r.attempt_id = v_attempt.id
  ) update public.responses r set is_correct = grading.correct, points_awarded = case when grading.correct then grading.points else 0 end, updated_at = now() from grading where r.id = grading.id;
  select coalesce(sum(r.points_awarded), 0), coalesce(sum(aq.points), 0) into v_score, v_max_score from public.assignment_questions aq left join public.responses r on r.question_id = aq.question_id and r.attempt_id = v_attempt.id where aq.assignment_id = v_attempt.assignment_id;
  update public.attempts set status = 'submitted', submitted_at = now(), score = v_score, max_score = v_max_score where id = v_attempt.id returning * into v_attempt;
  return v_attempt;
end;
$$;

revoke all on function public.close_owned_assignment(uuid) from public;
revoke all on function public.reopen_owned_assignment(uuid) from public;
revoke all on function public.save_response(uuid, uuid, text) from public;
revoke all on function public.submit_attempt(uuid) from public;
grant execute on function public.close_owned_assignment(uuid) to authenticated;
grant execute on function public.reopen_owned_assignment(uuid) to authenticated;
grant execute on function public.save_response(uuid, uuid, text) to authenticated;
grant execute on function public.submit_attempt(uuid) to authenticated;
