-- Teacher-only, assignment-scoped results overview. Latest submitted attempt
-- per currently assigned student is used consistently for all scored metrics.

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
    select 1 from public.assignment_classes ac join public.classes c on c.id = ac.class_id
    where ac.assignment_id = p_assignment_id and ac.class_id = p_class_id and c.teacher_id = v_user
  ) then
    raise exception 'Class results are not available';
  end if;

  return (
    with expected_students as (
      select distinct p.id as student_id, p.full_name, p.email
      from public.assignment_classes ac
      join public.class_members cm on cm.class_id = ac.class_id
      join public.profiles p on p.id = cm.student_id
      where ac.assignment_id = p_assignment_id and p.role = 'student' and (p_class_id is null or ac.class_id = p_class_id)
    ), submitted_ranked as (
      select at.id as attempt_id, at.student_id, at.attempt_number, at.started_at, at.submitted_at,
             at.score, at.max_score,
             row_number() over (partition by at.student_id order by at.submitted_at desc, at.attempt_number desc, at.id desc) as rank
      from public.attempts at
      join expected_students es on es.student_id = at.student_id
      where at.assignment_id = p_assignment_id and at.status = 'submitted'
    ), latest_submitted as (
      select * from submitted_ranked where rank = 1
    ), latest_in_progress as (
      select distinct on (at.student_id) at.id as attempt_id, at.student_id, at.started_at
      from public.attempts at
      join expected_students es on es.student_id = at.student_id
      where at.assignment_id = p_assignment_id and at.status = 'in_progress'
      order by at.student_id, at.started_at desc, at.attempt_number desc, at.id desc
    ), student_results as (
      select es.student_id, coalesce(es.full_name, es.email, 'Student') as student_name, es.email,
             ls.attempt_id, ls.attempt_number, ls.score, ls.max_score, ls.submitted_at,
             case when ls.max_score > 0 and ls.score is not null then round(100 * ls.score / ls.max_score, 2) else null end as percentage,
             case when ls.attempt_id is not null then greatest(0, extract(epoch from ls.submitted_at - ls.started_at))::integer else null end as completion_seconds,
             case when ls.attempt_id is not null then 'submitted' when lip.attempt_id is not null then 'in_progress' else 'not_started' end as status
      from expected_students es
      left join latest_submitted ls on ls.student_id = es.student_id
      left join latest_in_progress lip on lip.student_id = es.student_id
    ), scored_results as (
      select * from student_results where status = 'submitted' and percentage is not null
    ), question_rows as (
      select aq.question_id, aq.position, aq.points, q.prompt, q.type, q.difficulty,
             primary_skill.code as primary_skill_code, primary_skill.name as primary_skill_name,
             count(ls.student_id)::integer as submitted_count,
             count(*) filter (where r.is_correct is true)::integer as correct_count,
             count(*) filter (where r.is_correct is false)::integer as incorrect_count,
             count(*) filter (where ls.student_id is not null and (r.id is null or r.student_answer is null))::integer as unanswered_count,
             case when count(ls.student_id) = 0 then null else round(100 * count(*) filter (where r.is_correct is true)::numeric / count(ls.student_id), 2) end as correct_percentage,
             coalesce(jsonb_agg(jsonb_build_object('student_id', es.student_id, 'student_name', coalesce(es.full_name, es.email, 'Student')) order by coalesce(es.full_name, es.email, 'Student')) filter (where r.is_correct is false), '[]'::jsonb) as incorrect_students
      from public.assignment_questions aq
      join public.questions q on q.id = aq.question_id
      left join lateral (
        select s.code, s.name from public.question_skills qs join public.skills s on s.id = qs.skill_id
        where qs.question_id = q.id and qs.is_primary order by s.code limit 1
      ) primary_skill on true
      left join latest_submitted ls on true
      left join expected_students es on es.student_id = ls.student_id
      left join public.responses r on r.attempt_id = ls.attempt_id and r.question_id = aq.question_id
      where aq.assignment_id = p_assignment_id
      group by aq.question_id, aq.position, aq.points, q.prompt, q.type, q.difficulty, primary_skill.code, primary_skill.name
    ), skill_rows as (
      select s.code, s.name, count(distinct r.id)::integer as evidence_count,
             count(distinct r.id) filter (where r.is_correct is true)::integer as correct_count,
             count(distinct ls.student_id)::integer as students_with_evidence,
             case when count(distinct r.id) = 0 then null else round(100 * count(distinct r.id) filter (where r.is_correct is true)::numeric / count(distinct r.id), 2) end as accuracy
      from latest_submitted ls
      join public.responses r on r.attempt_id = ls.attempt_id and r.is_correct is not null
      join public.question_skills qs on qs.question_id = r.question_id
      join public.skills s on s.id = qs.skill_id
      group by s.code, s.name
    ), bands(label, minimum, maximum, position) as (
      values ('90–100', 90::numeric, 100::numeric, 1), ('80–89', 80::numeric, 90::numeric, 2), ('70–79', 70::numeric, 80::numeric, 3), ('60–69', 60::numeric, 70::numeric, 4), ('<60', 0::numeric, 60::numeric, 5)
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
      'distribution', coalesce((select jsonb_agg(jsonb_build_object('label', label, 'count', (select count(*)::integer from scored_results where percentage >= minimum and ((position = 1 and percentage <= maximum) or (position > 1 and percentage < maximum)))) order by position) from bands), '[]'::jsonb),
      'students', coalesce((select jsonb_agg(jsonb_build_object('student_id', student_id, 'student_name', student_name, 'email', email, 'attempt_id', attempt_id, 'attempt_number', attempt_number, 'score', score, 'max_score', max_score, 'percentage', percentage, 'submitted_at', submitted_at, 'completion_seconds', completion_seconds, 'status', status) order by student_name) from student_results), '[]'::jsonb),
      'questions', coalesce((select jsonb_agg(jsonb_build_object('question_id', question_id, 'position', position, 'points', points, 'prompt', prompt, 'type', type, 'difficulty', difficulty, 'primary_skill_code', primary_skill_code, 'primary_skill_name', primary_skill_name, 'submitted_count', submitted_count, 'correct_count', correct_count, 'incorrect_count', incorrect_count, 'unanswered_count', unanswered_count, 'correct_percentage', correct_percentage, 'incorrect_students', incorrect_students) order by correct_percentage nulls last, position) from question_rows), '[]'::jsonb),
      'skills', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'evidence_count', evidence_count, 'correct_count', correct_count, 'students_with_evidence', students_with_evidence, 'accuracy', accuracy) order by accuracy nulls last, name) from skill_rows), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.get_assignment_results_overview(uuid, uuid) from public;
grant execute on function public.get_assignment_results_overview(uuid, uuid) to authenticated;
