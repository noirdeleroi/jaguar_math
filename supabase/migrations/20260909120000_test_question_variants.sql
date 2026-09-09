-- Per-question test variants. Variant 1 remains the canonical
-- assignment_questions row; variants 2 and 3 are protected until selected for
-- a student's durable attempt form.

create table public.assignment_question_variants (
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  slot_position integer not null check (slot_position > 0),
  variant_index integer not null check (variant_index between 2 and 3),
  question_id uuid not null references public.questions(id) on delete restrict,
  primary key (assignment_id, slot_position, variant_index),
  unique (assignment_id, question_id),
  foreign key (assignment_id, slot_position)
    references public.assignment_questions(assignment_id, position)
    on update cascade on delete cascade
);

create index assignment_question_variants_question_idx
  on public.assignment_question_variants (question_id);

alter table public.assignment_question_variants enable row level security;
revoke all on table public.assignment_question_variants from anon, public;
grant select on table public.assignment_question_variants to authenticated;

create policy "question variants: teachers read owned" on public.assignment_question_variants
for select to authenticated using (public.owns_assignment(assignment_id));

alter table public.attempt_questions add column slot_position integer;
update public.attempt_questions set slot_position = position where slot_position is null;
alter table public.attempt_questions alter column slot_position set not null;
alter table public.attempt_questions
  add constraint attempt_questions_attempt_slot_key unique (attempt_id, slot_position);

create function public.protect_versioned_test_structure()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'assignments' then
    if old.kind = 'test' and new.kind <> 'test' and exists (
      select 1 from public.assignment_question_variants variant
      where variant.assignment_id = old.id
    ) then
      raise exception 'A versioned test cannot be changed to homework or quiz';
    end if;
  elsif exists (
    select 1 from public.assignment_question_variants variant
    where variant.assignment_id = new.assignment_id
  ) then
    raise exception 'Add questions to a versioned test by replacing all versions together';
  end if;
  return new;
end;
$$;

create trigger assignments_protect_versioned_kind
before update of kind on public.assignments
for each row execute function public.protect_versioned_test_structure();

create trigger assignment_questions_protect_versioned_insert
before insert on public.assignment_questions
for each row execute function public.protect_versioned_test_structure();

-- Homework questions remain available before starting. For quizzes and tests,
-- expose only the exact questions frozen into the student's attempt form.
drop policy "questions: students read eligible assessment questions" on public.questions;
create policy "questions: students read eligible assessment questions" on public.questions
for select to authenticated
using (
  exists (
    select 1
    from public.assignment_questions aq
    join public.assignments a on a.id = aq.assignment_id
    join public.assignment_classes ac on ac.assignment_id = a.id
    join public.class_members cm on cm.class_id = ac.class_id
    where aq.question_id = questions.id
      and a.kind = 'homework'
      and a.status in ('published', 'closed')
      and cm.student_id = auth.uid()
  )
  or exists (
    select 1
    from public.attempt_questions attempt_question
    join public.attempts attempt on attempt.id = attempt_question.attempt_id
    join public.assignments a on a.id = attempt.assignment_id
    where attempt_question.question_id = questions.id
      and attempt.student_id = auth.uid()
      and a.status in ('published', 'closed')
  )
);

drop policy "question skills: students read eligible assessment mappings" on public.question_skills;
create policy "question skills: students read eligible assessment mappings" on public.question_skills
for select to authenticated
using (
  exists (
    select 1
    from public.assignment_questions aq
    join public.assignments a on a.id = aq.assignment_id
    join public.assignment_classes ac on ac.assignment_id = a.id
    join public.class_members cm on cm.class_id = ac.class_id
    where aq.question_id = question_skills.question_id
      and a.kind = 'homework'
      and a.status in ('published', 'closed')
      and cm.student_id = auth.uid()
  )
  or exists (
    select 1
    from public.attempt_questions attempt_question
    join public.attempts attempt on attempt.id = attempt_question.attempt_id
    join public.assignments a on a.id = attempt.assignment_id
    where attempt_question.question_id = question_skills.question_id
      and attempt.student_id = auth.uid()
      and a.status in ('published', 'closed')
  )
);

create or replace function public.start_attempt(p_assignment_id uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_assignment public.assignments;
  v_attempt public.attempts;
  v_next integer;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'student') then
    raise exception 'Only authenticated students can start attempts';
  end if;
  select * into v_assignment from public.assignments where id = p_assignment_id and status = 'published';
  if not found or (v_assignment.due_at is not null and now() > v_assignment.due_at) then
    raise exception 'Assignment is not available';
  end if;
  if not exists (
    select 1 from public.assignment_classes ac
    join public.class_members cm on cm.class_id = ac.class_id
    where ac.assignment_id = p_assignment_id and cm.student_id = v_user
  ) then raise exception 'Assignment is not assigned to this student'; end if;

  perform pg_advisory_xact_lock(hashtext(p_assignment_id::text), hashtext(v_user::text));
  select * into v_attempt from public.attempts
  where assignment_id = p_assignment_id and student_id = v_user and status = 'in_progress'
  order by attempt_number desc limit 1;
  if found then return v_attempt; end if;
  select count(*) + 1 into v_next from public.attempts where assignment_id = p_assignment_id and student_id = v_user;
  if v_next > v_assignment.max_attempts then raise exception 'Maximum attempts reached'; end if;

  insert into public.attempts (assignment_id, student_id, attempt_number, expires_at)
  values (
    p_assignment_id, v_user, v_next,
    case when v_assignment.duration_minutes is null then null else now() + make_interval(mins => v_assignment.duration_minutes) end
  ) returning * into v_attempt;

  update public.attempts
  set form_code = upper(substr(replace(v_attempt.id::text, '-', ''), 1, 6))
  where id = v_attempt.id returning * into v_attempt;

  insert into public.attempt_questions (attempt_id, question_id, position, slot_position, points, option_order)
  select v_attempt.id, ordered.question_id,
         row_number() over (order by ordered.sort_key, ordered.slot_position)::integer,
         ordered.slot_position, ordered.points, ordered.option_order
  from (
    select chosen.question_id, aq.position as slot_position, aq.points,
           case when v_assignment.shuffle_questions
             then md5(v_attempt.id::text || ':slot:' || aq.position::text)
             else lpad(aq.position::text, 12, '0')
           end as sort_key,
           case when v_assignment.shuffle_options then
             coalesce((
               select array_agg(option_item.value ->> 'id' order by md5(v_attempt.id::text || ':' || chosen.question_id::text || ':' || (option_item.value ->> 'id')))
               from jsonb_array_elements(coalesce(q.options, '[]'::jsonb)) as option_item(value)
             ), '{}'::text[])
           else
             coalesce((
               select array_agg(option_item.value ->> 'id' order by option_item.ordinality)
               from jsonb_array_elements(coalesce(q.options, '[]'::jsonb)) with ordinality as option_item(value, ordinality)
             ), '{}'::text[])
           end as option_order
    from public.assignment_questions aq
    cross join lateral (
      select candidate.question_id
      from (
        select aq.question_id, 1 as variant_index
        union all
        select variant.question_id, variant.variant_index
        from public.assignment_question_variants variant
        where variant.assignment_id = aq.assignment_id and variant.slot_position = aq.position
      ) candidate
      order by md5(v_attempt.id::text || ':' || aq.position::text || ':' || candidate.question_id::text), candidate.variant_index
      limit 1
    ) chosen
    join public.questions q on q.id = chosen.question_id
    where aq.assignment_id = p_assignment_id
  ) ordered;

  return v_attempt;
end;
$$;

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
  if v_version_count not between 1 and 3 then raise exception 'Each question slot must contain one to three versions'; end if;
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

create or replace function public.duplicate_owned_assignment_ready(p_assignment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_source public.assignments;
  v_copy_id uuid;
  v_item record;
  v_new_question_id uuid;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can duplicate assignments';
  end if;
  select * into v_source from public.assignments where id = p_assignment_id and created_by = v_user;
  if not found then raise exception 'Assignment is not managed by this teacher'; end if;
  select public.duplicate_owned_assignment_with_presentation(p_assignment_id) into v_copy_id;
  update public.assignments set shuffle_options = v_source.shuffle_options
  where id = v_copy_id and created_by = v_user;

  for v_item in
    select variant.slot_position, variant.variant_index, variant.question_id,
           q.prompt, q.type, q.options, q.difficulty, q.icfes_competency,
           key.correct_answer, key.numeric_tolerance, key.explanation
    from public.assignment_question_variants variant
    join public.questions q on q.id = variant.question_id
    join public.question_keys key on key.question_id = q.id
    where variant.assignment_id = p_assignment_id
    order by variant.slot_position, variant.variant_index
  loop
    insert into public.questions (prompt, type, options, difficulty, icfes_competency, created_by)
    values (v_item.prompt, v_item.type, v_item.options, v_item.difficulty, v_item.icfes_competency, v_user)
    returning id into v_new_question_id;
    insert into public.question_keys (question_id, correct_answer, numeric_tolerance, explanation)
    values (v_new_question_id, v_item.correct_answer, v_item.numeric_tolerance, v_item.explanation);
    insert into public.question_skills (question_id, skill_id, weight, is_primary)
    select v_new_question_id, skill_id, weight, is_primary from public.question_skills
    where question_id = v_item.question_id;
    insert into public.assignment_question_variants (assignment_id, slot_position, variant_index, question_id)
    values (v_copy_id, v_item.slot_position, v_item.variant_index, v_new_question_id);
  end loop;

  return v_copy_id;
end;
$$;

create or replace function public.get_attempt_answer_review(p_attempt_id uuid)
returns table(question_id uuid, prompt text, question_type text, options jsonb, student_answer text, is_correct boolean, points_awarded numeric, points numeric, correct_answer text, explanation text)
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.attempts attempt
    join public.assignments assignment on assignment.id = attempt.assignment_id
    where attempt.id = p_attempt_id and attempt.student_id = v_user
      and attempt.status = 'submitted' and assignment.show_answers_after_submit
  ) then raise exception 'Answer review is not available'; end if;
  return query
  select q.id, q.prompt, q.type, q.options, response.student_answer,
         response.is_correct, response.points_awarded, attempt_question.points,
         key.correct_answer, key.explanation
  from public.attempt_questions attempt_question
  join public.questions q on q.id = attempt_question.question_id
  join public.responses response on response.attempt_id = attempt_question.attempt_id and response.question_id = q.id
  join public.question_keys key on key.question_id = q.id
  where attempt_question.attempt_id = p_attempt_id
  order by attempt_question.position;
end;
$$;

revoke all on function public.create_assignment_draft_ready(text, text, text, timestamptz, integer, integer, boolean, boolean, boolean, boolean, uuid[], jsonb, boolean, boolean, boolean, integer, text, text, boolean) from public;
revoke all on function public.duplicate_owned_assignment_ready(uuid) from public;
revoke all on function public.start_attempt(uuid) from public;
revoke all on function public.get_attempt_answer_review(uuid) from public;
revoke all on function public.protect_versioned_test_structure() from public;
grant execute on function public.create_assignment_draft_ready(text, text, text, timestamptz, integer, integer, boolean, boolean, boolean, boolean, uuid[], jsonb, boolean, boolean, boolean, integer, text, text, boolean) to authenticated;
grant execute on function public.duplicate_owned_assignment_ready(uuid) to authenticated;
grant execute on function public.start_attempt(uuid) to authenticated;
grant execute on function public.get_attempt_answer_review(uuid) to authenticated;

-- Keep the existing summary/student/skill calculations and replace only the
-- question analysis with slot-aware aggregation across all assigned variants.
alter function public.get_assignment_results_overview(uuid, uuid)
  rename to get_assignment_results_overview_without_variants;
revoke all on function public.get_assignment_results_overview_without_variants(uuid, uuid)
  from public, anon, authenticated;

create function public.get_assignment_results_overview(
  p_assignment_id uuid,
  p_class_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_questions jsonb;
begin
  v_result := public.get_assignment_results_overview_without_variants(p_assignment_id, p_class_id);

  with expected_students as (
    select distinct profile.id as student_id, profile.full_name, profile.email
    from public.assignment_classes assignment_class
    join public.class_members member on member.class_id = assignment_class.class_id
    join public.profiles profile on profile.id = member.student_id
    where assignment_class.assignment_id = p_assignment_id
      and profile.role = 'student'
      and (p_class_id is null or assignment_class.class_id = p_class_id)
  ), submitted_ranked as (
    select attempt.id as attempt_id, attempt.student_id,
           row_number() over (
             partition by attempt.student_id
             order by attempt.submitted_at desc, attempt.attempt_number desc, attempt.id desc
           ) as rank
    from public.attempts attempt
    join expected_students expected on expected.student_id = attempt.student_id
    where attempt.assignment_id = p_assignment_id and attempt.status = 'submitted'
  ), latest_submitted as (
    select * from submitted_ranked where rank = 1
  ), question_rows as (
    select assignment_question.question_id, assignment_question.position,
           assignment_question.points, canonical.prompt, canonical.type,
           canonical.difficulty,
           1 + (select count(*)::integer
                from public.assignment_question_variants variant_count
                where variant_count.assignment_id = assignment_question.assignment_id
                  and variant_count.slot_position = assignment_question.position) as version_count,
           primary_skill.code as primary_skill_code,
           primary_skill.name as primary_skill_name,
           count(latest.student_id)::integer as submitted_count,
           count(*) filter (where response.is_correct is true)::integer as correct_count,
           count(*) filter (where response.is_correct is false)::integer as incorrect_count,
           count(*) filter (
             where latest.student_id is not null
               and (response.id is null or response.student_answer is null)
           )::integer as unanswered_count,
           case when count(latest.student_id) = 0 then null
                else round(100 * count(*) filter (where response.is_correct is true)::numeric / count(latest.student_id), 2)
           end as correct_percentage,
           coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'student_id', expected.student_id,
                 'student_name', coalesce(expected.full_name, expected.email, 'Student')
               ) order by coalesce(expected.full_name, expected.email, 'Student')
             ) filter (where response.is_correct is false),
             '[]'::jsonb
           ) as incorrect_students
    from public.assignment_questions assignment_question
    join public.questions canonical on canonical.id = assignment_question.question_id
    left join lateral (
      select skill.code, skill.name
      from public.question_skills link
      join public.skills skill on skill.id = link.skill_id
      where link.question_id = canonical.id and link.is_primary
      order by skill.code limit 1
    ) primary_skill on true
    left join latest_submitted latest on true
    left join expected_students expected on expected.student_id = latest.student_id
    left join public.attempt_questions attempt_question
      on attempt_question.attempt_id = latest.attempt_id
     and (
       attempt_question.question_id = assignment_question.question_id
       or (
         exists (
           select 1 from public.assignment_question_variants variant_exists
           where variant_exists.assignment_id = assignment_question.assignment_id
             and variant_exists.slot_position = assignment_question.position
         )
         and attempt_question.slot_position = assignment_question.position
       )
     )
    left join public.responses response
      on response.attempt_id = latest.attempt_id
     and response.question_id = attempt_question.question_id
    where assignment_question.assignment_id = p_assignment_id
    group by assignment_question.question_id, assignment_question.assignment_id,
             assignment_question.position, assignment_question.points,
             canonical.prompt, canonical.type, canonical.difficulty,
             primary_skill.code, primary_skill.name
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'question_id', question_id,
        'position', position,
        'points', points,
        'prompt', prompt,
        'type', type,
        'difficulty', difficulty,
        'version_count', version_count,
        'primary_skill_code', primary_skill_code,
        'primary_skill_name', primary_skill_name,
        'submitted_count', submitted_count,
        'correct_count', correct_count,
        'incorrect_count', incorrect_count,
        'unanswered_count', unanswered_count,
        'correct_percentage', correct_percentage,
        'incorrect_students', incorrect_students
      ) order by correct_percentage nulls last, position
    ),
    '[]'::jsonb
  ) into v_questions
  from question_rows;

  return jsonb_set(v_result, '{questions}', v_questions, true);
end;
$$;

revoke all on function public.get_assignment_results_overview(uuid, uuid) from public;
grant execute on function public.get_assignment_results_overview(uuid, uuid) to authenticated;
