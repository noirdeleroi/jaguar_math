-- Assessment results are private until the teacher explicitly releases them.
-- The two existing booleans represent three states:
--   false/false = submission confirmation only
--   true/false  = score only
--   true/true   = full question and answer review

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
  elsif new.kind = 'quiz' then
    new.max_attempts := 1;
    new.show_feedback_after_each_question := false;
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
  end if;
  return new;
end;
$$;

-- Tests could not previously be explicitly released, so make every existing test
-- private as the safe migration default. Teachers may release results afterward.
update public.assignments
set show_score_after_submit = false,
    show_answers_after_submit = false
where kind = 'test';

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
  set status = 'closed'
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
  set status = 'published'
  where id = p_assignment_id and status = 'closed';
  if not found then raise exception 'Only closed assignments can be reopened'; end if;
end;
$$;

create or replace function public.set_owned_assignment_result_visibility(
  p_assignment_id uuid,
  p_visibility text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can release results';
  end if;
  if p_visibility not in ('private', 'score_only', 'full_review') then
    raise exception 'Result visibility is invalid';
  end if;
  update public.assignments
  set show_score_after_submit = p_visibility in ('score_only', 'full_review'),
      show_answers_after_submit = p_visibility = 'full_review'
  where id = p_assignment_id and created_by = v_user;
  if not found then raise exception 'Assignment is not managed by this teacher'; end if;
end;
$$;

-- A private submitted attempt must not expose its score through the table API.
drop policy "attempts: students read own" on public.attempts;
create policy "attempts: students read active or released own" on public.attempts
for select to authenticated
using (
  student_id = auth.uid()
  and (
    status = 'in_progress'
    or exists (
      select 1 from public.assignments assignment
      where assignment.id = attempts.assignment_id
        and assignment.show_score_after_submit
    )
  )
);

-- This safe function lets the UI show that a private attempt was submitted while
-- returning null for score fields until score release.
create or replace function public.get_my_assignment_attempts(p_assignment_id uuid default null)
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
  exam_focus_violations integer
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
         attempt.exam_focus_violations
  from public.attempts attempt
  join public.assignments assignment on assignment.id = attempt.assignment_id
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

drop policy "responses: students read own" on public.responses;
create policy "responses: students read active or fully released own" on public.responses
for select to authenticated
using (exists (
  select 1
  from public.attempts attempt
  join public.assignments assignment on assignment.id = attempt.assignment_id
  where attempt.id = responses.attempt_id
    and attempt.student_id = auth.uid()
    and (attempt.status = 'in_progress' or assignment.show_answers_after_submit)
));

drop policy "attempt questions: students read own" on public.attempt_questions;
create policy "attempt questions: students read active or fully released own" on public.attempt_questions
for select to authenticated
using (exists (
  select 1
  from public.attempts attempt
  join public.assignments assignment on assignment.id = attempt.assignment_id
  where attempt.id = attempt_questions.attempt_id
    and attempt.student_id = auth.uid()
    and (attempt.status = 'in_progress' or assignment.show_answers_after_submit)
));

drop policy "questions: students read eligible assessment questions" on public.questions;
create policy "questions: students read eligible assessment questions" on public.questions
for select to authenticated
using (
  exists (
    select 1
    from public.assignment_questions assignment_question
    join public.assignments assignment on assignment.id = assignment_question.assignment_id
    join public.assignment_classes assignment_class on assignment_class.assignment_id = assignment.id
    join public.class_members member on member.class_id = assignment_class.class_id
    where assignment_question.question_id = questions.id
      and assignment.kind = 'homework'
      and assignment.status in ('published', 'closed')
      and member.student_id = auth.uid()
  )
  or exists (
    select 1
    from public.attempt_questions attempt_question
    join public.attempts attempt on attempt.id = attempt_question.attempt_id
    join public.assignments assignment on assignment.id = attempt.assignment_id
    where attempt_question.question_id = questions.id
      and attempt.student_id = auth.uid()
      and assignment.status in ('published', 'closed')
      and (attempt.status = 'in_progress' or assignment.show_answers_after_submit)
  )
);

drop policy "question skills: students read eligible assessment mappings" on public.question_skills;
create policy "question skills: students read eligible assessment mappings" on public.question_skills
for select to authenticated
using (
  exists (
    select 1
    from public.assignment_questions assignment_question
    join public.assignments assignment on assignment.id = assignment_question.assignment_id
    join public.assignment_classes assignment_class on assignment_class.assignment_id = assignment.id
    join public.class_members member on member.class_id = assignment_class.class_id
    where assignment_question.question_id = question_skills.question_id
      and assignment.kind = 'homework'
      and assignment.status in ('published', 'closed')
      and member.student_id = auth.uid()
  )
  or exists (
    select 1
    from public.attempt_questions attempt_question
    join public.attempts attempt on attempt.id = attempt_question.attempt_id
    join public.assignments assignment on assignment.id = attempt.assignment_id
    where attempt_question.question_id = question_skills.question_id
      and attempt.student_id = auth.uid()
      and assignment.status in ('published', 'closed')
      and (attempt.status = 'in_progress' or assignment.show_answers_after_submit)
  )
);

revoke all on function public.set_owned_assignment_result_visibility(uuid, text) from public;
revoke all on function public.get_my_assignment_attempts(uuid) from public;
grant execute on function public.set_owned_assignment_result_visibility(uuid, text) to authenticated;
grant execute on function public.get_my_assignment_attempts(uuid) to authenticated;
