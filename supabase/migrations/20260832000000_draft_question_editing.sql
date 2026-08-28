-- Draft-only question editing. All mutations are scoped to an owned draft so
-- published assignments and their historical attempts remain immutable.

create or replace function public.update_owned_draft_question(
  p_assignment_id uuid,
  p_question_id uuid,
  p_prompt text,
  p_type text,
  p_options jsonb,
  p_correct_answer text,
  p_numeric_tolerance numeric,
  p_difficulty smallint,
  p_points numeric,
  p_explanation text,
  p_icfes_competency text,
  p_skills jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_skill_count integer;
  v_found_skill_count integer;
  v_primary_count integer;
  v_option_count integer;
  v_valid_option_count integer;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can edit draft questions';
  end if;
  if not exists (
    select 1
    from public.assignments a
    join public.assignment_questions aq on aq.assignment_id = a.id
    join public.questions q on q.id = aq.question_id
    where a.id = p_assignment_id and a.created_by = v_user and a.status = 'draft'
      and aq.question_id = p_question_id and q.created_by = v_user
  ) then
    raise exception 'Only draft questions managed by this teacher can be edited';
  end if;
  if nullif(btrim(p_prompt), '') is null or p_type not in ('multiple_choice', 'numeric', 'short_text') then
    raise exception 'Question prompt or type is invalid';
  end if;
  if p_difficulty not between 1 and 5 or p_points is null or p_points <= 0 or p_numeric_tolerance is null or p_numeric_tolerance < 0 then
    raise exception 'Question difficulty, points, or tolerance is invalid';
  end if;
  if nullif(btrim(p_correct_answer), '') is null then
    raise exception 'Question needs an answer key';
  end if;
  if p_icfes_competency is not null and p_icfes_competency not in ('INTERPRETACION_REPRESENTACION', 'FORMULACION_EJECUCION', 'ARGUMENTACION') then
    raise exception 'Question has an invalid ICFES competency';
  end if;
  if jsonb_typeof(p_skills) <> 'array' or jsonb_array_length(p_skills) = 0 then
    raise exception 'Question needs at least one skill';
  end if;

  select count(*), count(distinct nullif(btrim(item ->> 'code'), '')),
         count(*) filter (where item ->> 'is_primary' = 'true')
  into v_skill_count, v_found_skill_count, v_primary_count
  from jsonb_array_elements(p_skills) item;
  if v_skill_count <> v_found_skill_count or v_primary_count <> 1 then
    raise exception 'Question skills must be unique and have one primary skill';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_skills) item
    where public.try_parse_numeric(item ->> 'weight') is null
       or public.try_parse_numeric(item ->> 'weight') <= 0
  ) then
    raise exception 'Question skill weights must be positive';
  end if;
  select count(*) into v_found_skill_count
  from public.skills s
  join jsonb_array_elements(p_skills) item on item ->> 'code' = s.code;
  if v_found_skill_count <> v_skill_count then
    raise exception 'Question references an unknown skill';
  end if;

  if p_type = 'multiple_choice' then
    if jsonb_typeof(p_options) <> 'array' then raise exception 'Multiple-choice questions need options'; end if;
    select count(*), count(distinct nullif(btrim(item ->> 'id'), ''))
    into v_option_count, v_valid_option_count
    from jsonb_array_elements(p_options) item;
    if v_option_count < 2 or v_option_count <> v_valid_option_count or exists (
      select 1 from jsonb_array_elements(p_options) item where nullif(btrim(item ->> 'text'), '') is null
    ) then
      raise exception 'Multiple-choice options are invalid';
    end if;
    if not exists (select 1 from jsonb_array_elements(p_options) item where item ->> 'id' = btrim(p_correct_answer)) then
      raise exception 'Multiple-choice answer must match an option';
    end if;
  elsif p_options is not null then
    raise exception 'Only multiple-choice questions can have options';
  end if;

  update public.questions
  set prompt = btrim(p_prompt), type = p_type, options = p_options,
      difficulty = p_difficulty, icfes_competency = nullif(btrim(coalesce(p_icfes_competency, '')), '')
  where id = p_question_id;
  update public.question_keys
  set correct_answer = btrim(p_correct_answer), numeric_tolerance = p_numeric_tolerance,
      explanation = nullif(btrim(coalesce(p_explanation, '')), '')
  where question_id = p_question_id;
  delete from public.question_skills where question_id = p_question_id;
  insert into public.question_skills (question_id, skill_id, weight, is_primary)
  select p_question_id, s.id, public.try_parse_numeric(item ->> 'weight'), item ->> 'is_primary' = 'true'
  from jsonb_array_elements(p_skills) item
  join public.skills s on s.code = item ->> 'code';
  update public.assignment_questions set points = p_points
  where assignment_id = p_assignment_id and question_id = p_question_id;
end;
$$;

create or replace function public.remove_owned_draft_question(p_assignment_id uuid, p_question_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_offset integer;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can remove draft questions';
  end if;
  if not exists (
    select 1 from public.assignments a join public.assignment_questions aq on aq.assignment_id = a.id join public.questions q on q.id = aq.question_id
    where a.id = p_assignment_id and a.created_by = v_user and a.status = 'draft' and aq.question_id = p_question_id and q.created_by = v_user
  ) then
    raise exception 'Only draft questions managed by this teacher can be removed';
  end if;

  delete from public.assignment_questions where assignment_id = p_assignment_id and question_id = p_question_id;
  select coalesce(max(position), 0) + 1 into v_offset from public.assignment_questions where assignment_id = p_assignment_id;
  update public.assignment_questions set position = position + v_offset where assignment_id = p_assignment_id;
  with reordered as (
    select question_id, row_number() over (order by position)::integer as position
    from public.assignment_questions where assignment_id = p_assignment_id
  ) update public.assignment_questions aq set position = reordered.position
  from reordered where aq.assignment_id = p_assignment_id and aq.question_id = reordered.question_id;
  delete from public.questions q
  where q.id = p_question_id and q.created_by = v_user
    and not exists (select 1 from public.assignment_questions aq where aq.question_id = q.id);
end;
$$;

create or replace function public.move_owned_draft_question(p_assignment_id uuid, p_question_id uuid, p_direction integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_position integer;
  v_other_question_id uuid;
  v_other_position integer;
  v_offset integer;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can reorder draft questions';
  end if;
  if p_direction not in (-1, 1) then raise exception 'Question move direction is invalid'; end if;
  if not exists (select 1 from public.assignments where id = p_assignment_id and created_by = v_user and status = 'draft') then
    raise exception 'Only drafts managed by this teacher can be reordered';
  end if;
  select position into v_position from public.assignment_questions
  where assignment_id = p_assignment_id and question_id = p_question_id;
  if not found then raise exception 'Question is not part of this draft'; end if;
  select question_id, position into v_other_question_id, v_other_position
  from public.assignment_questions
  where assignment_id = p_assignment_id and position = v_position + p_direction;
  if not found then raise exception 'Question cannot be moved further'; end if;

  select coalesce(max(position), 0) + 1 into v_offset from public.assignment_questions where assignment_id = p_assignment_id;
  update public.assignment_questions set position = position + v_offset
  where assignment_id = p_assignment_id and question_id in (p_question_id, v_other_question_id);
  update public.assignment_questions set position = case
    when question_id = p_question_id then v_other_position
    when question_id = v_other_question_id then v_position
  end
  where assignment_id = p_assignment_id and question_id in (p_question_id, v_other_question_id);
end;
$$;

revoke all on function public.update_owned_draft_question(uuid, uuid, text, text, jsonb, text, numeric, smallint, numeric, text, text, jsonb) from public;
revoke all on function public.remove_owned_draft_question(uuid, uuid) from public;
revoke all on function public.move_owned_draft_question(uuid, uuid, integer) from public;
grant execute on function public.update_owned_draft_question(uuid, uuid, text, text, jsonb, text, numeric, smallint, numeric, text, text, jsonb) to authenticated;
grant execute on function public.remove_owned_draft_question(uuid, uuid) to authenticated;
grant execute on function public.move_owned_draft_question(uuid, uuid, integer) to authenticated;
