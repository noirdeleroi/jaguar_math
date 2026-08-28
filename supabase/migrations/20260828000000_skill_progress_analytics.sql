create or replace function public.get_student_skill_progress(p_student_id uuid)
returns table(domain text, skill_code text, skill_name text, attempted_evidence bigint, correct_evidence bigint, accuracy numeric, earned_points numeric, possible_points numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_teacher boolean;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select exists (select 1 from public.profiles where id = v_user and role = 'teacher') into v_teacher;
  if v_user <> p_student_id then
    if not v_teacher or not exists (select 1 from public.class_members cm join public.classes c on c.id = cm.class_id where cm.student_id = p_student_id and c.teacher_id = v_user) then
      raise exception 'Student progress is not available';
    end if;
  end if;
  return query
  select s.domain, s.code, s.name, count(*)::bigint, count(*) filter (where r.is_correct)::bigint,
    round(100 * count(*) filter (where r.is_correct)::numeric / count(*), 2),
    coalesce(sum(coalesce(r.points_awarded, 0) * qs.weight), 0), coalesce(sum(aq.points * qs.weight), 0)
  from public.attempts a
  join public.assignments assignment on assignment.id = a.assignment_id
  join public.responses r on r.attempt_id = a.id and r.is_correct is not null
  join public.assignment_questions aq on aq.assignment_id = a.assignment_id and aq.question_id = r.question_id
  join public.question_skills qs on qs.question_id = r.question_id
  join public.skills s on s.id = qs.skill_id
  where a.student_id = p_student_id and a.status = 'submitted' and (v_user = p_student_id or assignment.created_by = v_user)
  group by s.domain, s.code, s.name
  order by s.domain, s.name;
end;
$$;

create or replace function public.get_student_skill_evidence(p_student_id uuid)
returns table(skill_code text, assignment_title text, question_position integer, submitted_at timestamptz, is_correct boolean, earned_points numeric, possible_points numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_teacher boolean;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select exists (select 1 from public.profiles where id = v_user and role = 'teacher') into v_teacher;
  if v_user <> p_student_id then
    if not v_teacher or not exists (select 1 from public.class_members cm join public.classes c on c.id = cm.class_id where cm.student_id = p_student_id and c.teacher_id = v_user) then
      raise exception 'Student progress is not available';
    end if;
  end if;
  return query
  select s.code, assignment.title, aq.position, a.submitted_at, r.is_correct,
    coalesce(r.points_awarded, 0) * qs.weight, aq.points * qs.weight
  from public.attempts a
  join public.assignments assignment on assignment.id = a.assignment_id
  join public.responses r on r.attempt_id = a.id and r.is_correct is not null
  join public.assignment_questions aq on aq.assignment_id = a.assignment_id and aq.question_id = r.question_id
  join public.question_skills qs on qs.question_id = r.question_id
  join public.skills s on s.id = qs.skill_id
  where a.student_id = p_student_id and a.status = 'submitted' and (v_user = p_student_id or assignment.created_by = v_user)
  order by a.submitted_at desc, assignment.title, aq.position;
end;
$$;

create or replace function public.get_class_skill_progress(p_class_id uuid)
returns table(student_id uuid, student_name text, student_email text, domain text, skill_code text, skill_name text, attempted_evidence bigint, correct_evidence bigint, accuracy numeric, earned_points numeric, possible_points numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then raise exception 'Only authenticated teachers can view class progress'; end if;
  if not exists (select 1 from public.classes where id = p_class_id and teacher_id = v_user) then raise exception 'Class progress is not available'; end if;
  return query
  select p.id, p.full_name, p.email, s.domain, s.code, s.name, count(*)::bigint, count(*) filter (where r.is_correct)::bigint,
    round(100 * count(*) filter (where r.is_correct)::numeric / count(*), 2),
    coalesce(sum(coalesce(r.points_awarded, 0) * qs.weight), 0), coalesce(sum(aq.points * qs.weight), 0)
  from public.class_members cm
  join public.profiles p on p.id = cm.student_id
  join public.attempts a on a.student_id = cm.student_id and a.status = 'submitted'
  join public.assignments assignment on assignment.id = a.assignment_id and assignment.created_by = v_user
  join public.assignment_classes ac on ac.assignment_id = assignment.id and ac.class_id = p_class_id
  join public.responses r on r.attempt_id = a.id and r.is_correct is not null
  join public.assignment_questions aq on aq.assignment_id = a.assignment_id and aq.question_id = r.question_id
  join public.question_skills qs on qs.question_id = r.question_id
  join public.skills s on s.id = qs.skill_id
  where cm.class_id = p_class_id
  group by p.id, p.full_name, p.email, s.domain, s.code, s.name
  order by p.full_name nulls last, s.domain, s.name;
end;
$$;

revoke all on function public.get_student_skill_progress(uuid) from public;
revoke all on function public.get_student_skill_evidence(uuid) from public;
revoke all on function public.get_class_skill_progress(uuid) from public;
grant execute on function public.get_student_skill_progress(uuid) to authenticated;
grant execute on function public.get_student_skill_evidence(uuid) to authenticated;
grant execute on function public.get_class_skill_progress(uuid) to authenticated;
