-- Avoid recursively evaluating the questions/attempt_questions RLS policies
-- for every embedded question in every simultaneous classroom launch.
create function public.get_my_exam_launch(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.attempts;
  v_questions jsonb;
begin
  if v_user is null or not exists (
    select 1 from public.profiles where id = v_user and role = 'student'
  ) then raise exception 'Only students can start tests'; end if;

  -- This entry point checks membership, publication, release and attempt limits,
  -- and reuses an existing attempt on retries under its per-student lock.
  select * into v_attempt from public.start_exam_attempt(p_assignment_id);
  if v_attempt.student_id <> v_user or v_attempt.status <> 'in_progress'
     or not exists (
       select 1 from public.assignments
       where id = v_attempt.assignment_id and kind = 'test' and status = 'published'
     ) then raise exception 'Active test unavailable'; end if;

  select jsonb_agg(jsonb_build_object(
    'id', question.id, 'prompt', question.prompt, 'type', question.type,
    'options', question.options, 'optionOrder', form.option_order,
    'points', form.points, 'answer', coalesce(response.student_answer, ''),
    'serverRevision', coalesce(response.client_revision, 0)
  ) order by form.position) into v_questions
  from public.attempt_questions form
  join public.questions question on question.id = form.question_id
  left join public.responses response
    on response.attempt_id = form.attempt_id and response.question_id = form.question_id
  where form.attempt_id = v_attempt.id;

  if v_questions is null then raise exception 'Test questions unavailable'; end if;
  return jsonb_build_object(
    'attemptId', v_attempt.id, 'expiresAt', v_attempt.expires_at,
    'formCode', v_attempt.form_code, 'focusViolations', v_attempt.exam_focus_violations,
    'questions', v_questions
  );
end;
$$;

revoke all on function public.get_my_exam_launch(uuid) from public, anon;
grant execute on function public.get_my_exam_launch(uuid) to authenticated;
