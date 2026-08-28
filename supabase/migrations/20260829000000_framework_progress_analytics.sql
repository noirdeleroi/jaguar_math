create or replace function public.get_student_framework_progress(p_student_id uuid, p_framework text)
returns table(target text, target_group text, attempted_evidence bigint, correct_evidence bigint, accuracy numeric, earned_points numeric, possible_points numeric, contributing_skills text[])
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_teacher boolean;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select exists (select 1 from public.profiles where id = v_user and role = 'teacher') into v_teacher;
  if v_user <> p_student_id and (not v_teacher or not exists (select 1 from public.class_members cm join public.classes c on c.id=cm.class_id where cm.student_id=p_student_id and c.teacher_id=v_user)) then raise exception 'Student progress is not available'; end if;
  return query
  with base as (
    select r.id response_id, r.is_correct, coalesce(r.points_awarded,0) earned, aq.points possible, qs.weight, s.code skill_code, q.icfes_competency, a.created_by
    from public.attempts at join public.assignments a on a.id=at.assignment_id join public.responses r on r.attempt_id=at.id and r.is_correct is not null join public.assignment_questions aq on aq.assignment_id=at.assignment_id and aq.question_id=r.question_id join public.question_skills qs on qs.question_id=r.question_id join public.skills s on s.id=qs.skill_id join public.questions q on q.id=r.question_id
    where at.student_id=p_student_id and at.status='submitted' and (v_user=p_student_id or a.created_by=v_user)
  ), mapped as (
    select distinct on (b.response_id, m.target) b.response_id, m.target, m.target_group, b.is_correct, b.earned*b.weight earned, b.possible*b.weight possible, b.skill_code
    from base b cross join lateral (
      select sm.sat_domain target, 'SAT'::text target_group from public.skill_sat_mappings sm join public.skills s on s.id=sm.skill_id where s.code=b.skill_code and sm.sat_domain is not null and sm.mapping_status <> 'not_assessed'
      union all select im.category, 'ICFES content' from public.skill_icfes_mappings im join public.skills s on s.id=im.skill_id where s.code=b.skill_code and im.category is not null and im.mapping_status <> 'not_explicit'
      union all select am.aero_code, split_part(am.aero_code,'.',2) from public.skill_aero_mappings am join public.skills s on s.id=am.skill_id where s.code=b.skill_code and am.aero_code is not null and am.mapping_status <> 'not_assessed'
      union all select b.icfes_competency, 'ICFES competencies' where p_framework='ICFES_COMPETENCY' and b.icfes_competency is not null
    ) m where (p_framework='SAT' and m.target_group='SAT') or (p_framework='ICFES_CONTENT' and m.target_group='ICFES content') or (p_framework='AERO' and m.target_group not in ('SAT','ICFES content','ICFES competencies')) or (p_framework='ICFES_COMPETENCY' and m.target_group='ICFES competencies')
    order by b.response_id, m.target, b.weight desc, b.skill_code
  ) select target, target_group, count(*)::bigint, count(*) filter(where is_correct)::bigint, round(100*count(*) filter(where is_correct)::numeric/count(*),2), sum(earned), sum(possible), array_agg(distinct skill_code order by skill_code)
  from mapped group by target,target_group order by target_group,target;
end; $$;
revoke all on function public.get_student_framework_progress(uuid,text) from public;
grant execute on function public.get_student_framework_progress(uuid,text) to authenticated;
