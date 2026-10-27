-- Let teachers control whether online assignments include the built-in grapher.

alter table public.assignments
  add column if not exists allow_graphing_calculator boolean not null default true;

update public.assignments
set allow_graphing_calculator = false
where kind = 'paper';

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
  update public.assignments
  set shuffle_options = v_source.shuffle_options,
      allow_graphing_calculator = v_source.allow_graphing_calculator
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
