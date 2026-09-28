-- Homework is an autosaved workspace, not a student-submitted assessment.
-- It stays editable until the assignment due_at, closes on that deadline, and
-- exposes the graded per-question review afterward. Attempts continue to use
-- the existing `submitted` storage state internally so gradebook/reporting
-- queries remain compatible.

update public.assignments
set duration_minutes = null,
    show_score_after_submit = true,
    show_answers_after_submit = true
where kind = 'homework'
  and (
    duration_minutes is not null
    or not show_score_after_submit
    or not show_answers_after_submit
  );

create function public.enforce_deadline_only_homework_policy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'homework' then
    new.duration_minutes := null;
    new.show_score_after_submit := true;
    new.show_answers_after_submit := true;
  end if;
  return new;
end;
$$;

create trigger assignments_enforce_deadline_only_homework
before insert or update of kind, duration_minutes, show_score_after_submit, show_answers_after_submit
on public.assignments
for each row execute function public.enforce_deadline_only_homework_policy();

revoke all on function public.enforce_deadline_only_homework_policy() from public, anon, authenticated;

-- Keep the mature grading implementation, but put a policy gate in front of
-- the public RPC so homework cannot be finalized by a student button or a
-- forged early request.
alter function public.submit_attempt(uuid)
  rename to submit_attempt_before_deadline_only_homework;

revoke all on function public.submit_attempt_before_deadline_only_homework(uuid)
  from public, anon, authenticated;

create function public.submit_attempt(p_attempt_id uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
begin
  select assignment.kind into v_kind
  from public.attempts attempt
  join public.assignments assignment on assignment.id = attempt.assignment_id
  where attempt.id = p_attempt_id;

  if v_kind = 'homework' then
    raise exception 'Homework saves automatically and closes only at its deadline';
  end if;

  return public.submit_attempt_before_deadline_only_homework(p_attempt_id);
end;
$$;

revoke all on function public.submit_attempt(uuid) from public, anon;
grant execute on function public.submit_attempt(uuid) to authenticated;

alter function public.submit_attempt_snapshot(uuid, jsonb, timestamptz, boolean)
  rename to submit_attempt_snapshot_before_deadline_only_homework;

revoke all on function public.submit_attempt_snapshot_before_deadline_only_homework(uuid, jsonb, timestamptz, boolean)
  from public, anon, authenticated;

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
  v_kind text;
  v_deadline timestamptz;
begin
  select attempt.* into v_attempt
  from public.attempts attempt
  where attempt.id = p_attempt_id and attempt.student_id = v_user;

  select assignment.kind, public.effective_attempt_deadline(attempt.id)
  into v_kind, v_deadline
  from public.attempts attempt
  join public.assignments assignment on assignment.id = attempt.assignment_id
  where attempt.id = p_attempt_id and attempt.student_id = v_user;

  if v_kind = 'homework' then
    if not coalesce(p_timed, false) then
      raise exception 'Homework does not accept manual submission';
    end if;
    if v_deadline is null then
      raise exception 'Homework without a deadline remains open';
    end if;
    if v_deadline > now() then
      raise exception 'Homework cannot close before its deadline';
    end if;
    if v_attempt.status = 'submitted' then
      return v_attempt;
    end if;
  end if;

  return public.submit_attempt_snapshot_before_deadline_only_homework(
    p_attempt_id,
    p_responses,
    p_client_submitted_at,
    p_timed
  );
end;
$$;

revoke all on function public.submit_attempt_snapshot(uuid, jsonb, timestamptz, boolean)
  from public, anon;
grant execute on function public.submit_attempt_snapshot(uuid, jsonb, timestamptz, boolean)
  to authenticated;

-- Homework review is always available after its deadline, even for legacy
-- rows whose old teacher-controlled visibility flags were off.
create or replace function public.get_attempt_answer_review(p_attempt_id uuid)
returns table(
  question_id uuid,
  prompt text,
  question_type text,
  options jsonb,
  student_answer text,
  is_correct boolean,
  points_awarded numeric,
  points numeric,
  correct_answer text,
  explanation text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1
    from public.attempts attempt
    join public.assignments assignment on assignment.id = attempt.assignment_id
    where attempt.id = p_attempt_id
      and attempt.student_id = v_user
      and attempt.status = 'submitted'
      and (
        assignment.show_answers_after_submit
        or (
          assignment.kind = 'homework'
          and public.effective_attempt_deadline(attempt.id) is not null
          and public.effective_attempt_deadline(attempt.id) <= now()
        )
      )
  ) then raise exception 'Answer review is not available'; end if;

  return query
  select question.id,
         question.prompt,
         question.type,
         question.options,
         response.student_answer,
         response.is_correct,
         response.points_awarded,
         attempt_question.points,
         answer_key.correct_answer,
         answer_key.explanation
  from public.attempt_questions attempt_question
  join public.questions question on question.id = attempt_question.question_id
  join public.responses response
    on response.attempt_id = attempt_question.attempt_id
   and response.question_id = question.id
  join public.question_keys answer_key on answer_key.question_id = question.id
  where attempt_question.attempt_id = p_attempt_id
  order by attempt_question.position;
end;
$$;

revoke all on function public.get_attempt_answer_review(uuid) from public, anon;
grant execute on function public.get_attempt_answer_review(uuid) to authenticated;
