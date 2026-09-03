-- Assignment presentation and immediate correctness feedback. Correct answers
-- remain in question_keys; students receive only the outcome for their own
-- response when the teacher has explicitly enabled feedback.

alter table public.assignments
  add column if not exists question_display_mode text not null default 'one_at_a_time'
    check (question_display_mode in ('one_at_a_time', 'all_at_once')),
  add column if not exists show_feedback_after_each_question boolean not null default false;

create function public.create_assignment_draft_with_presentation(
  p_title text, p_description text, p_kind text, p_due_at timestamptz,
  p_duration_minutes integer, p_max_attempts integer,
  p_show_score_after_submit boolean, p_show_answers_after_submit boolean,
  p_shuffle_questions boolean, p_class_ids uuid[], p_questions jsonb,
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
  if p_question_display_mode not in ('one_at_a_time', 'all_at_once') then
    raise exception 'Question display mode is invalid';
  end if;
  select public.create_assignment_draft_with_exam(
    p_title, p_description, p_kind, p_due_at, p_duration_minutes,
    p_max_attempts, p_show_score_after_submit, p_show_answers_after_submit,
    p_shuffle_questions, p_class_ids, p_questions, p_exam_mode,
    p_exam_require_fullscreen, p_exam_track_focus_exits,
    p_exam_allowed_focus_exits, p_exam_violation_action
  ) into v_assignment_id;
  update public.assignments
  set question_display_mode = p_question_display_mode,
      show_feedback_after_each_question = coalesce(p_show_feedback_after_each_question, false)
  where id = v_assignment_id and created_by = auth.uid();
  return v_assignment_id;
end;
$$;

create function public.update_owned_assignment_with_presentation(
  p_assignment_id uuid, p_title text, p_description text, p_kind text,
  p_due_at timestamptz, p_duration_minutes integer, p_max_attempts integer,
  p_show_score_after_submit boolean, p_show_answers_after_submit boolean,
  p_shuffle_questions boolean, p_class_ids uuid[], p_exam_mode boolean,
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
  if p_question_display_mode not in ('one_at_a_time', 'all_at_once') then
    raise exception 'Question display mode is invalid';
  end if;
  perform public.update_owned_assignment_with_exam(
    p_assignment_id, p_title, p_description, p_kind, p_due_at,
    p_duration_minutes, p_max_attempts, p_show_score_after_submit,
    p_show_answers_after_submit, p_shuffle_questions, p_class_ids,
    p_exam_mode, p_exam_require_fullscreen, p_exam_track_focus_exits,
    p_exam_allowed_focus_exits, p_exam_violation_action
  );
  update public.assignments
  set question_display_mode = p_question_display_mode,
      show_feedback_after_each_question = coalesce(p_show_feedback_after_each_question, false)
  where id = p_assignment_id and created_by = auth.uid();
end;
$$;

create function public.save_response_with_feedback(
  p_attempt_id uuid,
  p_question_id uuid,
  p_student_answer text
)
returns table(is_correct boolean, points_awarded numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_started_at timestamptz;
  v_duration integer;
  v_due_at timestamptz;
  v_assignment_status text;
  v_question_type text;
  v_correct_answer text;
  v_numeric_tolerance numeric;
  v_points numeric;
  v_correct boolean;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'student') then
    raise exception 'Only authenticated students can save responses';
  end if;
  select a.started_at, assignment.duration_minutes, assignment.due_at,
         assignment.status, q.type, key.correct_answer, key.numeric_tolerance,
         aq.points
  into v_started_at, v_duration, v_due_at, v_assignment_status,
       v_question_type, v_correct_answer, v_numeric_tolerance, v_points
  from public.attempts a
  join public.assignments assignment on assignment.id = a.assignment_id
  join public.assignment_questions aq on aq.assignment_id = assignment.id and aq.question_id = p_question_id
  join public.questions q on q.id = aq.question_id
  join public.question_keys key on key.question_id = q.id
  where a.id = p_attempt_id and a.student_id = v_user and a.status = 'in_progress'
    and assignment.show_feedback_after_each_question;
  if not found then raise exception 'Immediate feedback is not available for this response'; end if;
  if v_assignment_status <> 'published' then raise exception 'Assignment is closed'; end if;
  if (v_duration is not null and now() > v_started_at + make_interval(mins => v_duration)) or (v_due_at is not null and now() > v_due_at) then
    raise exception 'The response window has closed';
  end if;
  v_correct := case v_question_type
    when 'multiple_choice' then lower(btrim(coalesce(p_student_answer, ''))) = lower(btrim(v_correct_answer))
    when 'short_text' then lower(btrim(coalesce(p_student_answer, ''))) = lower(btrim(v_correct_answer))
    when 'numeric' then public.try_parse_numeric(p_student_answer) is not null
      and public.try_parse_numeric(v_correct_answer) is not null
      and abs(public.try_parse_numeric(p_student_answer) - public.try_parse_numeric(v_correct_answer)) <= v_numeric_tolerance
  end;
  insert into public.responses (attempt_id, question_id, student_answer, is_correct, points_awarded)
  values (p_attempt_id, p_question_id, p_student_answer, v_correct, case when v_correct then v_points else 0 end)
  on conflict (attempt_id, question_id) do update
  set student_answer = excluded.student_answer, is_correct = excluded.is_correct,
      points_awarded = excluded.points_awarded, answered_at = now(), updated_at = now();
  return query select v_correct, case when v_correct then v_points else 0 end;
end;
$$;

revoke all on function public.create_assignment_draft_with_presentation(text, text, text, timestamptz, integer, integer, boolean, boolean, boolean, uuid[], jsonb, boolean, boolean, boolean, integer, text, text, boolean) from public;
revoke all on function public.update_owned_assignment_with_presentation(uuid, text, text, text, timestamptz, integer, integer, boolean, boolean, boolean, uuid[], boolean, boolean, boolean, integer, text, text, boolean) from public;
revoke all on function public.save_response_with_feedback(uuid, uuid, text) from public;
grant execute on function public.create_assignment_draft_with_presentation(text, text, text, timestamptz, integer, integer, boolean, boolean, boolean, uuid[], jsonb, boolean, boolean, boolean, integer, text, text, boolean) to authenticated;
grant execute on function public.update_owned_assignment_with_presentation(uuid, text, text, text, timestamptz, integer, integer, boolean, boolean, boolean, uuid[], boolean, boolean, boolean, integer, text, text, boolean) to authenticated;
grant execute on function public.save_response_with_feedback(uuid, uuid, text) to authenticated;
