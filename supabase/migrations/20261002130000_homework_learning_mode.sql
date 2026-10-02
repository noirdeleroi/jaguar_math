-- Homework is formative practice. Students may check the current response,
-- see the worked solution, and revise while their attempt is still open.
-- Scoring data remains private implementation detail used for skill analysis.

create function public.check_homework_response(
  p_attempt_id uuid,
  p_question_id uuid,
  p_student_answer text
)
returns table(
  is_correct boolean,
  correct_answer text,
  explanation text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_question_type text;
  v_correct_answer text;
  v_numeric_tolerance numeric;
  v_explanation text;
  v_deadline timestamptz;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'student'
  ) then
    raise exception 'Only authenticated students can check homework';
  end if;

  select question.type,
         answer_key.correct_answer,
         answer_key.numeric_tolerance,
         answer_key.explanation,
         public.effective_attempt_deadline(attempt.id)
  into v_question_type,
       v_correct_answer,
       v_numeric_tolerance,
       v_explanation,
       v_deadline
  from public.attempts attempt
  join public.assignments assignment on assignment.id = attempt.assignment_id
  join public.attempt_questions attempt_question
    on attempt_question.attempt_id = attempt.id
   and attempt_question.question_id = p_question_id
  join public.questions question on question.id = attempt_question.question_id
  join public.question_keys answer_key on answer_key.question_id = question.id
  where attempt.id = p_attempt_id
    and attempt.student_id = auth.uid()
    and attempt.status = 'in_progress'
    and assignment.kind = 'homework'
    and assignment.status = 'published';

  if not found then
    raise exception 'Homework solution is not available';
  end if;
  if v_deadline is not null and v_deadline <= now() then
    raise exception 'The homework deadline has passed';
  end if;

  return query
  select case v_question_type
      when 'multiple_choice' then lower(btrim(coalesce(p_student_answer, ''))) = lower(btrim(v_correct_answer))
      when 'short_text' then lower(btrim(coalesce(p_student_answer, ''))) = lower(btrim(v_correct_answer))
      when 'numeric' then public.try_parse_numeric(p_student_answer) is not null
        and public.try_parse_numeric(v_correct_answer) is not null
        and abs(public.try_parse_numeric(p_student_answer) - public.try_parse_numeric(v_correct_answer)) <= v_numeric_tolerance
      else false
    end,
    v_correct_answer,
    v_explanation;
end;
$$;

revoke all on function public.check_homework_response(uuid, uuid, text)
  from public, anon;
grant execute on function public.check_homework_response(uuid, uuid, text)
  to authenticated;
