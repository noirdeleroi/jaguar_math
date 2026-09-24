-- Let the owning teacher key in a printed answer sheet for any assigned
-- student. This is intentionally limited to Paper tests after answer entry has
-- been released; it does not weaken the student response-write policy.

create function public.prepare_owned_paper_answer_entry(
  p_assignment_id uuid,
  p_student_id uuid
)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_assignment public.assignments;
  v_attempt public.attempts;
  v_version_count integer;
  v_paper_version integer;
  v_adjustment_seconds integer;
begin
  if v_user is null or not exists (
    select 1 from public.profiles where id = v_user and role = 'teacher'
  ) then
    raise exception 'Only authenticated teachers can enter paper answers';
  end if;

  select * into v_assignment
  from public.assignments
  where id = p_assignment_id
    and created_by = v_user
    and kind = 'paper'
    and status = 'published'
    and questions_released_at is not null;
  if not found then raise exception 'Paper answer entry is not open'; end if;

  if not exists (
    select 1
    from public.assignment_classes assignment_class
    join public.class_members member on member.class_id = assignment_class.class_id
    where assignment_class.assignment_id = p_assignment_id
      and member.student_id = p_student_id
  ) then raise exception 'Student is not assigned to this paper test'; end if;

  perform pg_advisory_xact_lock(hashtext(p_assignment_id::text), hashtext(p_student_id::text));
  select * into v_attempt
  from public.attempts
  where assignment_id = p_assignment_id and student_id = p_student_id
  order by attempt_number desc, started_at desc, id desc
  limit 1;
  if found then return v_attempt; end if;

  select coalesce(adjustment.adjustment_seconds, 0)
  into v_adjustment_seconds
  from public.assignment_student_paper_time adjustment
  where adjustment.assignment_id = p_assignment_id
    and adjustment.student_id = p_student_id;
  v_adjustment_seconds := coalesce(v_adjustment_seconds, 0);

  insert into public.attempts (
    assignment_id, student_id, attempt_number, expires_at
  ) values (
    p_assignment_id,
    p_student_id,
    1,
    v_assignment.questions_released_at + make_interval(
      secs => greatest(10, v_assignment.paper_answer_duration_seconds + v_adjustment_seconds)
    )
  ) returning * into v_attempt;

  select greatest(1, coalesce(max(variant.variant_index), 1))
  into v_version_count
  from public.assignment_question_variants variant
  where variant.assignment_id = p_assignment_id;
  v_paper_version := 1 + mod(
    get_byte(decode(md5(v_attempt.id::text), 'hex'), 0),
    v_version_count
  );

  update public.attempts
  set form_code = 'Version ' || v_paper_version::text
  where id = v_attempt.id
  returning * into v_attempt;

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

  return v_attempt;
end;
$$;

create function public.save_owned_paper_answers(
  p_assignment_id uuid,
  p_student_id uuid,
  p_responses jsonb,
  p_submit boolean default false
)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.attempts;
  v_was_submitted boolean;
begin
  if v_user is null or not exists (
    select 1 from public.profiles where id = v_user and role = 'teacher'
  ) then
    raise exception 'Only authenticated teachers can enter paper answers';
  end if;
  if p_responses is null
     or jsonb_typeof(p_responses) <> 'array'
     or jsonb_array_length(p_responses) not between 1 and 200 then
    raise exception 'Response batch is invalid';
  end if;

  select * into v_attempt
  from public.prepare_owned_paper_answer_entry(p_assignment_id, p_student_id);
  select * into v_attempt from public.attempts where id = v_attempt.id for update;
  v_was_submitted := v_attempt.status = 'submitted';

  if exists (
    select 1
    from jsonb_to_recordset(p_responses) as response_item(question_id uuid, student_answer text)
    left join public.attempt_questions question
      on question.attempt_id = v_attempt.id
      and question.question_id = response_item.question_id
    where question.question_id is null
      or char_length(coalesce(response_item.student_answer, '')) > 20000
  ) then raise exception 'A response is invalid for this attempt'; end if;
  if (
    select count(*) <> count(distinct response_item.question_id)
    from jsonb_to_recordset(p_responses) as response_item(question_id uuid)
  ) then raise exception 'Response questions must be unique'; end if;

  insert into public.responses (
    attempt_id, question_id, student_answer, client_revision
  )
  select v_attempt.id, response_item.question_id,
         response_item.student_answer, 0
  from jsonb_to_recordset(p_responses)
    as response_item(question_id uuid, student_answer text)
  on conflict (attempt_id, question_id) do update
  set student_answer = excluded.student_answer,
      client_revision = public.responses.client_revision + 1,
      is_correct = null,
      points_awarded = null,
      answered_at = now(),
      updated_at = now();

  if v_was_submitted then
    update public.attempts
    set status = 'in_progress', submitted_at = null, score = null, max_score = null
    where id = v_attempt.id;
  end if;

  if v_was_submitted or coalesce(p_submit, false) then
    select * into v_attempt from public.finalize_attempt_unchecked(v_attempt.id);
    if not v_was_submitted then
      insert into public.attempt_exam_events (attempt_id, event_type)
      values (v_attempt.id, 'teacher_submitted');
    end if;
  else
    select * into v_attempt from public.attempts where id = v_attempt.id;
  end if;
  return v_attempt;
end;
$$;

revoke all on function public.prepare_owned_paper_answer_entry(uuid, uuid) from public, anon;
revoke all on function public.save_owned_paper_answers(uuid, uuid, jsonb, boolean) from public, anon;
grant execute on function public.prepare_owned_paper_answer_entry(uuid, uuid) to authenticated;
grant execute on function public.save_owned_paper_answers(uuid, uuid, jsonb, boolean) to authenticated;
