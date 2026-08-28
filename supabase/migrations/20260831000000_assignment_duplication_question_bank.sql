-- Teacher-owned assignment duplication and personal question-bank reuse.
-- Copies deliberately create new question rows so historical assignments and
-- submitted attempts retain their original question/key/skill snapshots.

create or replace function public.duplicate_owned_assignment(p_assignment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_source public.assignments;
  v_item record;
  v_new_assignment_id uuid;
  v_new_question_id uuid;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can duplicate assignments';
  end if;

  select * into v_source
  from public.assignments
  where id = p_assignment_id and created_by = v_user;
  if not found then
    raise exception 'Assignment is not managed by this teacher';
  end if;

  insert into public.assignments (
    title, description, kind, due_at, duration_minutes, max_attempts,
    show_score_after_submit, show_answers_after_submit, shuffle_questions,
    status, created_by
  ) values (
    'Copy of ' || v_source.title, v_source.description, v_source.kind,
    v_source.due_at, v_source.duration_minutes, v_source.max_attempts,
    v_source.show_score_after_submit, v_source.show_answers_after_submit,
    v_source.shuffle_questions, 'draft', v_user
  ) returning id into v_new_assignment_id;

  insert into public.assignment_classes (assignment_id, class_id)
  select v_new_assignment_id, class_id
  from public.assignment_classes
  where assignment_id = v_source.id;

  for v_item in
    select aq.question_id, aq.position, aq.points, q.prompt, q.type, q.options,
           q.difficulty, q.icfes_competency, key.correct_answer,
           key.numeric_tolerance, key.explanation
    from public.assignment_questions aq
    join public.questions q on q.id = aq.question_id
    join public.question_keys key on key.question_id = q.id
    where aq.assignment_id = v_source.id
    order by aq.position
  loop
    insert into public.questions (prompt, type, options, difficulty, icfes_competency, created_by)
    values (
      v_item.prompt, v_item.type, v_item.options, v_item.difficulty,
      v_item.icfes_competency, v_user
    ) returning id into v_new_question_id;

    insert into public.question_keys (question_id, correct_answer, numeric_tolerance, explanation)
    values (v_new_question_id, v_item.correct_answer, v_item.numeric_tolerance, v_item.explanation);

    insert into public.question_skills (question_id, skill_id, weight, is_primary)
    select v_new_question_id, skill_id, weight, is_primary
    from public.question_skills
    where question_id = v_item.question_id;

    insert into public.assignment_questions (assignment_id, question_id, position, points)
    values (v_new_assignment_id, v_new_question_id, v_item.position, v_item.points);
  end loop;

  return v_new_assignment_id;
end;
$$;

create or replace function public.copy_owned_questions_to_draft(
  p_assignment_id uuid,
  p_question_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_item record;
  v_source record;
  v_key public.question_keys;
  v_new_question_id uuid;
  v_next_position integer;
  v_added integer := 0;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can reuse questions';
  end if;
  if p_question_ids is null or cardinality(p_question_ids) = 0 then
    raise exception 'Select at least one question';
  end if;
  if not exists (
    select 1 from public.assignments
    where id = p_assignment_id and created_by = v_user and status = 'draft'
  ) then
    raise exception 'Only drafts managed by this teacher can receive questions';
  end if;

  select coalesce(max(position), 0) into v_next_position
  from public.assignment_questions
  where assignment_id = p_assignment_id;

  for v_item in
    select question_id, ordinality
    from unnest(p_question_ids) with ordinality as selected(question_id, ordinality)
    order by ordinality
  loop
    select q.id, q.prompt, q.type, q.options, q.difficulty, q.icfes_competency
    into v_source
    from public.questions q
    where q.id = v_item.question_id and q.created_by = v_user;
    if not found then
      raise exception 'A selected question is not available in this teacher''s question bank';
    end if;

    select * into v_key from public.question_keys where question_id = v_source.id;
    if not found then
      raise exception 'A selected question is missing its answer key';
    end if;

    insert into public.questions (prompt, type, options, difficulty, icfes_competency, created_by)
    values (
      v_source.prompt, v_source.type, v_source.options, v_source.difficulty,
      v_source.icfes_competency, v_user
    ) returning id into v_new_question_id;

    insert into public.question_keys (question_id, correct_answer, numeric_tolerance, explanation)
    values (v_new_question_id, v_key.correct_answer, v_key.numeric_tolerance, v_key.explanation);

    insert into public.question_skills (question_id, skill_id, weight, is_primary)
    select v_new_question_id, skill_id, weight, is_primary
    from public.question_skills
    where question_id = v_source.id;

    v_next_position := v_next_position + 1;
    insert into public.assignment_questions (assignment_id, question_id, position, points)
    select p_assignment_id, v_new_question_id, v_next_position, aq.points
    from public.assignment_questions aq
    join public.assignments a on a.id = aq.assignment_id
    where aq.question_id = v_source.id and a.created_by = v_user
    order by a.updated_at desc, aq.position
    limit 1;

    if not found then
      insert into public.assignment_questions (assignment_id, question_id, position, points)
      values (p_assignment_id, v_new_question_id, v_next_position, 1);
    end if;
    v_added := v_added + 1;
  end loop;

  return v_added;
end;
$$;

revoke all on function public.duplicate_owned_assignment(uuid) from public;
revoke all on function public.copy_owned_questions_to_draft(uuid, uuid[]) from public;
grant execute on function public.duplicate_owned_assignment(uuid) to authenticated;
grant execute on function public.copy_owned_questions_to_draft(uuid, uuid[]) to authenticated;
