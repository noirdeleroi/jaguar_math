-- Let students enter Exam Mode and read instructions before the teacher opens
-- the question set. Existing assessments remain immediately available.

alter table public.assignments
  add column teacher_controlled_question_release boolean not null default true,
  add column questions_released_at timestamptz;

update public.assignments
set teacher_controlled_question_release = kind = 'test' and status = 'draft',
    questions_released_at = null;

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
  end if;
  return new;
end;
$$;

-- Keep the current, variant-aware attempt builder intact behind a guarded
-- public entry point. This also prevents direct RPC calls from bypassing the
-- teacher-controlled start.
alter function public.start_attempt(uuid) rename to start_attempt_before_teacher_release;
revoke all on function public.start_attempt_before_teacher_release(uuid) from public, anon, authenticated;

create function public.start_attempt(p_assignment_id uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.assignments assignment
    where assignment.id = p_assignment_id
      and assignment.status = 'published'
      and assignment.kind = 'test'
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
    raise exception 'Test questions have not been released';
  end if;
  return public.start_attempt_before_teacher_release(p_assignment_id);
end;
$$;

create function public.release_owned_test_questions(p_assignment_id uuid)
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
    raise exception 'Only authenticated teachers can release test questions';
  end if;

  update public.assignments
  set questions_released_at = coalesce(questions_released_at, now())
  where id = p_assignment_id
    and created_by = v_user
    and kind = 'test'
    and status = 'published'
    and teacher_controlled_question_release
  returning questions_released_at into v_released_at;

  if not found then
    raise exception 'This test is not waiting for question release';
  end if;
  return v_released_at;
end;
$$;

revoke all on function public.enforce_assignment_kind_policy() from public;
revoke all on function public.start_attempt(uuid) from public, anon;
revoke all on function public.release_owned_test_questions(uuid) from public, anon;
grant execute on function public.start_attempt(uuid) to authenticated;
grant execute on function public.release_owned_test_questions(uuid) to authenticated;
