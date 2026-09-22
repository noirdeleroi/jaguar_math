-- Allow Test and Paper assessments to use four coherent question versions.

alter table public.assignment_question_variants
  drop constraint if exists assignment_question_variants_variant_index_check;
alter table public.assignment_question_variants
  add constraint assignment_question_variants_variant_index_check
  check (variant_index between 2 and 4);

create or replace function public.create_assignment_draft_ready(
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
declare
  v_user uuid := auth.uid();
  v_assignment_id uuid;
  v_groups jsonb;
  v_primary_questions jsonb;
  v_group jsonb;
  v_question jsonb;
  v_question_id uuid;
  v_slot_position integer;
  v_variant_index integer;
  v_version_count integer;
  v_skill_count integer;
  v_found_skill_count integer;
  v_option_count integer;
  v_found_option_count integer;
  v_points numeric;
begin
  if p_questions is null or jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0 then
    raise exception 'At least one question is required';
  end if;

  if jsonb_typeof(p_questions -> 0) = 'array' then
    v_groups := p_questions;
  else
    select jsonb_agg(jsonb_build_array(item.value) order by item.ordinality)
    into v_groups from jsonb_array_elements(p_questions) with ordinality as item(value, ordinality);
  end if;

  if jsonb_array_length(v_groups) > 200 then raise exception 'An assessment can contain at most 200 question slots'; end if;
  v_version_count := jsonb_array_length(v_groups -> 0);
  if v_version_count not between 1 and 4 then raise exception 'Each question slot must contain one to four versions'; end if;
  if v_version_count > 1 and p_kind <> 'test' then raise exception 'Question versions are available only for tests'; end if;
  if exists (
    select 1 from jsonb_array_elements(v_groups) as group_item(value)
    where jsonb_typeof(group_item.value) <> 'array'
       or jsonb_array_length(group_item.value) <> v_version_count
  ) then raise exception 'Every question slot must contain the same number of versions'; end if;

  select jsonb_agg(group_item.value -> 0 order by group_item.ordinality)
  into v_primary_questions
  from jsonb_array_elements(v_groups) with ordinality as group_item(value, ordinality);

  select public.create_assignment_draft_with_presentation(
    p_title, p_description, p_kind, p_due_at, p_duration_minutes,
    p_max_attempts, p_show_score_after_submit, p_show_answers_after_submit,
    p_shuffle_questions, p_class_ids, v_primary_questions, p_exam_mode,
    p_exam_require_fullscreen, p_exam_track_focus_exits,
    p_exam_allowed_focus_exits, p_exam_violation_action,
    p_question_display_mode, p_show_feedback_after_each_question
  ) into v_assignment_id;

  update public.assignments set shuffle_options = coalesce(p_shuffle_options, false)
  where id = v_assignment_id and created_by = v_user;

  if v_version_count = 1 then return v_assignment_id; end if;

  for v_group, v_slot_position in
    select group_item.value, group_item.ordinality::integer
    from jsonb_array_elements(v_groups) with ordinality as group_item(value, ordinality)
  loop
    select points into v_points from public.assignment_questions
    where assignment_id = v_assignment_id and position = v_slot_position;

    for v_question, v_variant_index in
      select variant.value, variant.ordinality::integer
      from jsonb_array_elements(v_group) with ordinality as variant(value, ordinality)
      where variant.ordinality > 1
    loop
      if nullif(btrim(v_question ->> 'prompt'), '') is null
         or coalesce(v_question ->> 'type', '') not in ('multiple_choice', 'numeric', 'short_text') then
        raise exception 'Question %, version % is invalid', v_slot_position, v_variant_index;
      end if;
      if coalesce((v_question ->> 'difficulty')::smallint, 0) not between 1 and 5
         or coalesce((v_question ->> 'points')::numeric, 0) <= 0
         or (v_question ->> 'points')::numeric <> v_points then
        raise exception 'Question % must use valid, matching points in every version', v_slot_position;
      end if;
      if nullif(v_question ->> 'correct_answer', '') is null then
        raise exception 'Question %, version % needs an answer key', v_slot_position, v_variant_index;
      end if;
      if coalesce((v_question ->> 'numeric_tolerance')::numeric, 0) < 0 then
        raise exception 'Question %, version % has invalid numeric tolerance', v_slot_position, v_variant_index;
      end if;
      if jsonb_typeof(v_question -> 'skills') <> 'array' or jsonb_array_length(v_question -> 'skills') = 0 then
        raise exception 'Question %, version % needs a skill', v_slot_position, v_variant_index;
      end if;

      select count(*), count(distinct item ->> 'code')
      into v_skill_count, v_found_skill_count from jsonb_array_elements(v_question -> 'skills') item;
      if v_skill_count <> v_found_skill_count then raise exception 'Question %, version % has duplicate skills', v_slot_position, v_variant_index; end if;
      select count(*) into v_found_skill_count
      from public.skills s join jsonb_array_elements(v_question -> 'skills') item on item ->> 'code' = s.code
      where coalesce((item ->> 'weight')::numeric, 0) > 0;
      if v_found_skill_count <> v_skill_count then raise exception 'Question %, version % has invalid skills', v_slot_position, v_variant_index; end if;
      if (select count(*) from jsonb_array_elements(v_question -> 'skills') item where coalesce((item ->> 'is_primary')::boolean, false)) <> 1 then
        raise exception 'Question %, version % needs exactly one primary skill', v_slot_position, v_variant_index;
      end if;

      if v_question ->> 'type' = 'multiple_choice' then
        if jsonb_typeof(v_question -> 'options') <> 'array' or jsonb_array_length(v_question -> 'options') < 2 then
          raise exception 'Question %, version % needs at least two options', v_slot_position, v_variant_index;
        end if;
        select count(*), count(distinct item ->> 'id') into v_option_count, v_found_option_count
        from jsonb_array_elements(v_question -> 'options') item
        where nullif(btrim(item ->> 'id'), '') is not null and nullif(btrim(item ->> 'text'), '') is not null;
        if v_option_count <> jsonb_array_length(v_question -> 'options') or v_option_count <> v_found_option_count
           or not exists (select 1 from jsonb_array_elements(v_question -> 'options') item where item ->> 'id' = v_question ->> 'correct_answer') then
          raise exception 'Question %, version % has invalid options', v_slot_position, v_variant_index;
        end if;
      elsif v_question -> 'options' is not null and v_question -> 'options' <> 'null'::jsonb then
        raise exception 'Question %, version % has options for a non-choice question', v_slot_position, v_variant_index;
      end if;

      insert into public.questions (prompt, type, options, difficulty, icfes_competency, created_by)
      values (btrim(v_question ->> 'prompt'), v_question ->> 'type', v_question -> 'options',
              (v_question ->> 'difficulty')::smallint, nullif(v_question ->> 'icfes_competency', ''), v_user)
      returning id into v_question_id;
      insert into public.question_keys (question_id, correct_answer, numeric_tolerance, explanation)
      values (v_question_id, v_question ->> 'correct_answer', coalesce((v_question ->> 'numeric_tolerance')::numeric, 0), nullif(v_question ->> 'explanation', ''));
      insert into public.question_skills (question_id, skill_id, weight, is_primary)
      select v_question_id, s.id, coalesce((item ->> 'weight')::numeric, 1), coalesce((item ->> 'is_primary')::boolean, false)
      from jsonb_array_elements(v_question -> 'skills') item join public.skills s on s.code = item ->> 'code';
      insert into public.assignment_question_variants (assignment_id, slot_position, variant_index, question_id)
      values (v_assignment_id, v_slot_position, v_variant_index, v_question_id);
    end loop;
  end loop;

  return v_assignment_id;
end;
$$;
