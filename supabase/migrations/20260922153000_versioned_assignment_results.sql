-- Aggregate question performance by logical slot so every assigned variant is
-- counted. Also expose lightweight live progress for Paper answer sheets.

create or replace function public.get_assignment_results_overview(
  p_assignment_id uuid,
  p_class_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can view assignment results';
  end if;
  if not exists (select 1 from public.assignments where id = p_assignment_id and created_by = v_user) then
    raise exception 'Assignment results are not available';
  end if;
  if p_class_id is not null and not exists (
    select 1 from public.assignment_classes assignment_class
    join public.classes classroom on classroom.id = assignment_class.class_id
    where assignment_class.assignment_id = p_assignment_id
      and assignment_class.class_id = p_class_id
      and classroom.teacher_id = v_user
  ) then
    raise exception 'Class results are not available';
  end if;

  return (
    with expected_students as (
      select distinct profile.id as student_id, profile.full_name, profile.email
      from public.assignment_classes assignment_class
      join public.class_members member on member.class_id = assignment_class.class_id
      join public.profiles profile on profile.id = member.student_id
      where assignment_class.assignment_id = p_assignment_id
        and profile.role = 'student'
        and (p_class_id is null or assignment_class.class_id = p_class_id)
    ), submitted_ranked as (
      select attempt.id as attempt_id, attempt.student_id, attempt.attempt_number,
             attempt.started_at, attempt.submitted_at, attempt.score,
             attempt.max_score, attempt.form_code,
             row_number() over (
               partition by attempt.student_id
               order by attempt.submitted_at desc, attempt.attempt_number desc, attempt.id desc
             ) as rank
      from public.attempts attempt
      join expected_students expected on expected.student_id = attempt.student_id
      where attempt.assignment_id = p_assignment_id and attempt.status = 'submitted'
    ), latest_submitted as (
      select * from submitted_ranked where rank = 1
    ), latest_in_progress as (
      select distinct on (attempt.student_id)
             attempt.id as attempt_id, attempt.student_id,
             attempt.attempt_number, attempt.started_at, attempt.form_code
      from public.attempts attempt
      join expected_students expected on expected.student_id = attempt.student_id
      where attempt.assignment_id = p_assignment_id and attempt.status = 'in_progress'
      order by attempt.student_id, attempt.started_at desc, attempt.attempt_number desc, attempt.id desc
    ), student_results as (
      select expected.student_id,
             coalesce(expected.full_name, expected.email, 'Student') as student_name,
             expected.email,
             coalesce(submitted.attempt_id, active.attempt_id) as attempt_id,
             coalesce(submitted.attempt_number, active.attempt_number) as attempt_number,
             submitted.score,
             submitted.max_score,
             submitted.submitted_at,
             coalesce(submitted.form_code, active.form_code) as form_code,
             case when submitted.max_score > 0 and submitted.score is not null
               then round(100 * submitted.score / submitted.max_score, 2) else null end as percentage,
             case when submitted.attempt_id is not null
               then greatest(0, extract(epoch from submitted.submitted_at - submitted.started_at))::integer else null end as completion_seconds,
             case when submitted.attempt_id is not null then 'submitted'
                  when active.attempt_id is not null then 'in_progress'
                  else 'not_started' end as status,
             coalesce(progress.answered_count, 0) as answered_count,
             coalesce(progress.total_questions, 0) as total_questions,
             progress.last_activity_at
      from expected_students expected
      left join latest_submitted submitted on submitted.student_id = expected.student_id
      left join latest_in_progress active on active.student_id = expected.student_id
      left join lateral (
        select count(attempt_question.question_id)::integer as total_questions,
               count(response.id) filter (
                 where nullif(btrim(response.student_answer), '') is not null
               )::integer as answered_count,
               max(response.updated_at) as last_activity_at
        from public.attempt_questions attempt_question
        left join public.responses response
          on response.attempt_id = attempt_question.attempt_id
          and response.question_id = attempt_question.question_id
        where attempt_question.attempt_id = coalesce(submitted.attempt_id, active.attempt_id)
      ) progress on coalesce(submitted.attempt_id, active.attempt_id) is not null
    ), scored_results as (
      select * from student_results where status = 'submitted' and percentage is not null
    ), slot_rows as (
      select assignment_question.question_id, assignment_question.position,
             assignment_question.points, question.prompt, question.type,
             question.difficulty, primary_skill.code as primary_skill_code,
             primary_skill.name as primary_skill_name,
             greatest(1, coalesce(version.version_count, 1))::integer as version_count
      from public.assignment_questions assignment_question
      join public.questions question on question.id = assignment_question.question_id
      left join lateral (
        select skill.code, skill.name
        from public.question_skills question_skill
        join public.skills skill on skill.id = question_skill.skill_id
        where question_skill.question_id = question.id and question_skill.is_primary
        order by skill.code limit 1
      ) primary_skill on true
      left join lateral (
        select max(variant.variant_index)::integer as version_count
        from public.assignment_question_variants variant
        where variant.assignment_id = assignment_question.assignment_id
          and variant.slot_position = assignment_question.position
      ) version on true
      where assignment_question.assignment_id = p_assignment_id
    ), question_rows as (
      select slot.question_id, slot.position, slot.points, slot.prompt,
             slot.type, slot.difficulty, slot.version_count,
             slot.primary_skill_code, slot.primary_skill_name,
             count(submitted.student_id)::integer as submitted_count,
             count(*) filter (where response.is_correct is true)::integer as correct_count,
             count(*) filter (where response.is_correct is false)::integer as incorrect_count,
             count(*) filter (
               where submitted.student_id is not null
                 and (response.id is null or response.student_answer is null)
             )::integer as unanswered_count,
             case when count(submitted.student_id) = 0 then null
               else round(100 * count(*) filter (where response.is_correct is true)::numeric / count(submitted.student_id), 2)
             end as correct_percentage,
             coalesce(jsonb_agg(
               jsonb_build_object(
                 'student_id', expected.student_id,
                 'student_name', coalesce(expected.full_name, expected.email, 'Student')
               ) order by coalesce(expected.full_name, expected.email, 'Student')
             ) filter (where response.is_correct is false), '[]'::jsonb) as incorrect_students
      from slot_rows slot
      left join latest_submitted submitted on true
      left join expected_students expected on expected.student_id = submitted.student_id
      left join public.attempt_questions attempt_question
        on attempt_question.attempt_id = submitted.attempt_id
        and attempt_question.slot_position = slot.position
      left join public.responses response
        on response.attempt_id = submitted.attempt_id
        and response.question_id = attempt_question.question_id
      group by slot.question_id, slot.position, slot.points, slot.prompt,
               slot.type, slot.difficulty, slot.version_count,
               slot.primary_skill_code, slot.primary_skill_name
    ), skill_rows as (
      select skill.code, skill.name,
             count(distinct response.id)::integer as evidence_count,
             count(distinct response.id) filter (where response.is_correct is true)::integer as correct_count,
             count(distinct submitted.student_id)::integer as students_with_evidence,
             case when count(distinct response.id) = 0 then null
               else round(100 * count(distinct response.id) filter (where response.is_correct is true)::numeric / count(distinct response.id), 2)
             end as accuracy
      from latest_submitted submitted
      join public.responses response on response.attempt_id = submitted.attempt_id and response.is_correct is not null
      join public.question_skills question_skill on question_skill.question_id = response.question_id
      join public.skills skill on skill.id = question_skill.skill_id
      group by skill.code, skill.name
    ), bands(label, minimum, maximum, position) as (
      values ('90–100', 90::numeric, 100::numeric, 1),
             ('80–89', 80::numeric, 90::numeric, 2),
             ('70–79', 70::numeric, 80::numeric, 3),
             ('60–69', 60::numeric, 70::numeric, 4),
             ('<60', 0::numeric, 60::numeric, 5)
    )
    select jsonb_build_object(
      'summary', jsonb_build_object(
        'assigned_students', (select count(*)::integer from expected_students),
        'submitted_students', (select count(*)::integer from latest_submitted),
        'scored_students', (select count(*)::integer from scored_results),
        'average_percentage', (select round(avg(percentage), 2) from scored_results),
        'median_percentage', (select round(percentile_cont(0.5) within group (order by percentage)::numeric, 2) from scored_results),
        'highest_percentage', (select round(max(percentage), 2) from scored_results),
        'lowest_percentage', (select round(min(percentage), 2) from scored_results),
        'average_completion_seconds', (select round(avg(completion_seconds))::integer from student_results where status = 'submitted' and completion_seconds is not null)
      ),
      'distribution', coalesce((
        select jsonb_agg(jsonb_build_object(
          'label', label,
          'count', (select count(*)::integer from scored_results where percentage >= minimum and ((position = 1 and percentage <= maximum) or (position > 1 and percentage < maximum)))
        ) order by position) from bands
      ), '[]'::jsonb),
      'students', coalesce((
        select jsonb_agg(jsonb_build_object(
          'student_id', student_id, 'student_name', student_name, 'email', email,
          'attempt_id', attempt_id, 'attempt_number', attempt_number,
          'score', score, 'max_score', max_score, 'percentage', percentage,
          'submitted_at', submitted_at, 'completion_seconds', completion_seconds,
          'status', status, 'form_code', form_code,
          'answered_count', answered_count, 'total_questions', total_questions,
          'last_activity_at', last_activity_at
        ) order by student_name) from student_results
      ), '[]'::jsonb),
      'questions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'question_id', question_id, 'position', position, 'points', points,
          'prompt', prompt, 'type', type, 'difficulty', difficulty,
          'version_count', version_count,
          'primary_skill_code', primary_skill_code,
          'primary_skill_name', primary_skill_name,
          'submitted_count', submitted_count, 'correct_count', correct_count,
          'incorrect_count', incorrect_count, 'unanswered_count', unanswered_count,
          'correct_percentage', correct_percentage,
          'incorrect_students', incorrect_students
        ) order by correct_percentage nulls last, position) from question_rows
      ), '[]'::jsonb),
      'skills', coalesce((
        select jsonb_agg(jsonb_build_object(
          'code', code, 'name', name, 'evidence_count', evidence_count,
          'correct_count', correct_count,
          'students_with_evidence', students_with_evidence, 'accuracy', accuracy
        ) order by accuracy nulls last, name) from skill_rows
      ), '[]'::jsonb)
    )
  );
end;
$$;

