-- Paper assessments keep printed questions off the active student page while
-- reusing Jaguar's versioning, autosave, grading, and result-release workflow.

alter table public.assignments drop constraint if exists assignments_kind_check;
alter table public.assignments
  add constraint assignments_kind_check check (kind in ('homework', 'quiz', 'test', 'paper'));

create or replace function public.enforce_assignment_kind_policy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.show_answers_after_submit then
    new.show_score_after_submit := true;
  end if;

  if new.kind = 'homework' then
    new.exam_mode := false;
    new.exam_require_fullscreen := false;
    new.exam_track_focus_exits := false;
    new.teacher_controlled_question_release := false;
    new.questions_released_at := null;
  elsif new.kind = 'quiz' then
    new.max_attempts := 1;
    new.show_feedback_after_each_question := false;
    new.teacher_controlled_question_release := false;
    new.questions_released_at := null;
  elsif new.kind = 'test' then
    new.duration_minutes := coalesce(new.duration_minutes, 60);
    new.max_attempts := 1;
    new.show_feedback_after_each_question := false;
    new.question_display_mode := 'one_at_a_time';
    new.shuffle_questions := true;
    new.shuffle_options := true;
    new.exam_mode := true;
    new.exam_require_fullscreen := true;
    new.exam_track_focus_exits := true;
    if not new.teacher_controlled_question_release then
      new.questions_released_at := null;
    end if;
  elsif new.kind = 'paper' then
    new.duration_minutes := null;
    new.max_attempts := 1;
    new.show_feedback_after_each_question := false;
    new.question_display_mode := 'all_at_once';
    new.shuffle_questions := false;
    new.shuffle_options := false;
    new.exam_mode := false;
    new.exam_require_fullscreen := false;
    new.exam_track_focus_exits := false;
    new.teacher_controlled_question_release := true;
  end if;
  return new;
end;
$$;

create or replace function public.protect_versioned_test_structure()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'assignments' then
    if old.kind in ('test', 'paper') and new.kind not in ('test', 'paper') and exists (
      select 1 from public.assignment_question_variants variant
      where variant.assignment_id = old.id
    ) then
      raise exception 'A versioned assessment cannot be changed to homework or quiz';
    end if;
  elsif exists (
    select 1 from public.assignment_question_variants variant
    where variant.assignment_id = new.assignment_id
  ) then
    raise exception 'Add questions to a versioned assessment by replacing all versions together';
  end if;
  return new;
end;
$$;

-- The established version importer validates and creates the complete test
-- structure. These transactional wrappers reuse it, then apply Paper policy.
create function public.create_paper_assignment_draft_ready(
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
declare v_assignment_id uuid;
begin
  if p_kind <> 'paper' then raise exception 'Invalid paper assessment kind'; end if;
  select public.create_assignment_draft_ready(
    p_title, p_description, 'test', p_due_at, p_duration_minutes,
    p_max_attempts, p_show_score_after_submit, p_show_answers_after_submit,
    p_shuffle_questions, p_shuffle_options, p_class_ids, p_questions,
    p_exam_mode, p_exam_require_fullscreen, p_exam_track_focus_exits,
    p_exam_allowed_focus_exits, p_exam_violation_action,
    p_question_display_mode, p_show_feedback_after_each_question
  ) into v_assignment_id;
  update public.assignments set kind = 'paper'
  where id = v_assignment_id and created_by = auth.uid();
  if not found then raise exception 'Paper assessment could not be created'; end if;
  return v_assignment_id;
end;
$$;

create function public.update_owned_paper_assignment_ready(
  p_assignment_id uuid, p_title text, p_description text, p_kind text,
  p_due_at timestamptz, p_duration_minutes integer, p_max_attempts integer,
  p_show_score_after_submit boolean, p_show_answers_after_submit boolean,
  p_shuffle_questions boolean, p_shuffle_options boolean,
  p_class_ids uuid[], p_exam_mode boolean,
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
  if p_kind <> 'paper' then raise exception 'Invalid paper assessment kind'; end if;
  perform public.update_owned_assignment_ready(
    p_assignment_id, p_title, p_description, 'test', p_due_at,
    p_duration_minutes, p_max_attempts, p_show_score_after_submit,
    p_show_answers_after_submit, p_shuffle_questions, p_shuffle_options,
    p_class_ids, p_exam_mode, p_exam_require_fullscreen,
    p_exam_track_focus_exits, p_exam_allowed_focus_exits,
    p_exam_violation_action, p_question_display_mode,
    p_show_feedback_after_each_question
  );
  update public.assignments set kind = 'paper'
  where id = p_assignment_id and created_by = auth.uid();
  if not found then raise exception 'Paper assessment is not managed by this teacher'; end if;
end;
$$;

revoke all on function public.create_paper_assignment_draft_ready(text, text, text, timestamptz, integer, integer, boolean, boolean, boolean, boolean, uuid[], jsonb, boolean, boolean, boolean, integer, text, text, boolean) from public, anon;
grant execute on function public.create_paper_assignment_draft_ready(text, text, text, timestamptz, integer, integer, boolean, boolean, boolean, boolean, uuid[], jsonb, boolean, boolean, boolean, integer, text, text, boolean) to authenticated;
revoke all on function public.update_owned_paper_assignment_ready(uuid, text, text, text, timestamptz, integer, integer, boolean, boolean, boolean, boolean, uuid[], boolean, boolean, boolean, integer, text, text, boolean) from public, anon;
grant execute on function public.update_owned_paper_assignment_ready(uuid, text, text, text, timestamptz, integer, integer, boolean, boolean, boolean, boolean, uuid[], boolean, boolean, boolean, integer, text, text, boolean) to authenticated;

-- Keep the public start gate for both online and paper assessments. The hidden
-- builder still makes the attempt atomically. Paper then replaces the random
-- per-slot form with one complete version and its original printed order.
create or replace function public.start_attempt(p_assignment_id uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.attempts;
  v_assignment_kind text;
  v_version_count integer;
  v_paper_version integer;
  v_extra_minutes integer;
  v_delta integer;
begin
  if exists (
    select 1
    from public.assignments assignment
    where assignment.id = p_assignment_id
      and assignment.status = 'published'
      and assignment.kind in ('test', 'paper')
      and assignment.teacher_controlled_question_release
      and assignment.questions_released_at is null
      and exists (
        select 1
        from public.assignment_classes assignment_class
        join public.class_members member on member.class_id = assignment_class.class_id
        where assignment_class.assignment_id = assignment.id
          and member.student_id = auth.uid()
      )
  ) then
    raise exception 'Assessment has not been released';
  end if;

  select kind into v_assignment_kind from public.assignments where id = p_assignment_id;
  select * into v_attempt from public.start_attempt_before_teacher_release(p_assignment_id);

  if v_assignment_kind = 'paper' and v_attempt.form_code not like 'Version %' then
    select greatest(1, coalesce(max(variant.variant_index), 1))
    into v_version_count
    from public.assignment_question_variants variant
    where variant.assignment_id = p_assignment_id;
    v_paper_version := 1 + mod(get_byte(decode(md5(v_attempt.id::text), 'hex'), 0), v_version_count);

    update public.attempts set form_code = 'Version ' || v_paper_version::text
    where id = v_attempt.id returning * into v_attempt;

    delete from public.attempt_questions where attempt_id = v_attempt.id;
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
  end if;

  if v_assignment_kind = 'test' then
    select coalesce(adjustment.extra_minutes, 0) into v_extra_minutes
    from public.assignment_student_test_time adjustment
    where adjustment.assignment_id = p_assignment_id
      and adjustment.student_id = auth.uid();
    v_extra_minutes := coalesce(v_extra_minutes, 0);
    v_delta := greatest(0, v_extra_minutes - coalesce(v_attempt.teacher_extra_minutes, 0));
    if v_delta > 0 then
      update public.attempts
      set expires_at = case when expires_at is null then null else expires_at + make_interval(mins => v_delta) end,
          teacher_extra_minutes = v_extra_minutes
      where id = v_attempt.id returning * into v_attempt;
    end if;
  end if;
  return v_attempt;
end;
$$;

create or replace function public.release_owned_test_questions(p_assignment_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_released_at timestamptz;
begin
  if v_user is null or not exists (
    select 1 from public.profiles where id = v_user and role = 'teacher'
  ) then
    raise exception 'Only authenticated teachers can release assessments';
  end if;

  update public.assignments
  set questions_released_at = coalesce(questions_released_at, now())
  where id = p_assignment_id
    and created_by = v_user
    and kind in ('test', 'paper')
    and status = 'published'
    and teacher_controlled_question_release
  returning questions_released_at into v_released_at;

  if not found then raise exception 'This assessment is not waiting for release'; end if;
  return v_released_at;
end;
$$;

-- Active Paper attempts cannot select prompt or option text through RLS. Full
-- question data becomes available only after submission and full-review release.
drop policy if exists "questions: students read eligible assessment questions" on public.questions;
create policy "questions: students read eligible assessment questions" on public.questions
for select to authenticated
using (
  exists (
    select 1
    from public.assignment_questions assignment_question
    join public.assignments assignment on assignment.id = assignment_question.assignment_id
    join public.assignment_classes assignment_class on assignment_class.assignment_id = assignment.id
    join public.class_members member on member.class_id = assignment_class.class_id
    where assignment_question.question_id = questions.id
      and assignment.kind = 'homework'
      and assignment.status in ('published', 'closed')
      and member.student_id = auth.uid()
  )
  or exists (
    select 1
    from public.attempt_questions attempt_question
    join public.attempts attempt on attempt.id = attempt_question.attempt_id
    join public.assignments assignment on assignment.id = attempt.assignment_id
    where attempt_question.question_id = questions.id
      and attempt.student_id = auth.uid()
      and assignment.status in ('published', 'closed')
      and (
        assignment.kind <> 'paper'
        or (attempt.status = 'submitted' and assignment.show_answers_after_submit)
      )
  )
);

drop policy if exists "question skills: students read eligible assessment mappings" on public.question_skills;
create policy "question skills: students read eligible assessment mappings" on public.question_skills
for select to authenticated
using (
  exists (
    select 1
    from public.assignment_questions assignment_question
    join public.assignments assignment on assignment.id = assignment_question.assignment_id
    join public.assignment_classes assignment_class on assignment_class.assignment_id = assignment.id
    join public.class_members member on member.class_id = assignment_class.class_id
    where assignment_question.question_id = question_skills.question_id
      and assignment.kind = 'homework'
      and assignment.status in ('published', 'closed')
      and member.student_id = auth.uid()
  )
  or exists (
    select 1
    from public.attempt_questions attempt_question
    join public.attempts attempt on attempt.id = attempt_question.attempt_id
    join public.assignments assignment on assignment.id = attempt.assignment_id
    where attempt_question.question_id = question_skills.question_id
      and attempt.student_id = auth.uid()
      and assignment.status in ('published', 'closed')
      and (
        assignment.kind <> 'paper'
        or (attempt.status = 'submitted' and assignment.show_answers_after_submit)
      )
  )
);

create function public.get_my_paper_answer_sheet(p_attempt_id uuid)
returns table (
  question_id uuid,
  answer_position integer,
  points numeric,
  question_type text,
  option_ids text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not exists (
    select 1
    from public.attempts attempt
    join public.assignments assignment on assignment.id = attempt.assignment_id
    where attempt.id = p_attempt_id
      and attempt.student_id = v_user
      and attempt.status = 'in_progress'
      and assignment.kind = 'paper'
      and assignment.status = 'published'
  ) then
    raise exception 'Paper answer sheet is not available';
  end if;

  return query
  select attempt_question.question_id,
         attempt_question.position,
         attempt_question.points,
         question.type,
         case when question.type = 'multiple_choice'
           then attempt_question.option_order else '{}'::text[] end
  from public.attempt_questions attempt_question
  join public.questions question on question.id = attempt_question.question_id
  where attempt_question.attempt_id = p_attempt_id
  order by attempt_question.position;
end;
$$;

revoke all on function public.get_my_paper_answer_sheet(uuid) from public, anon;
grant execute on function public.get_my_paper_answer_sheet(uuid) to authenticated;
