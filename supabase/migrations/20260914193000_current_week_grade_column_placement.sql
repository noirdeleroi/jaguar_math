create or replace function public.default_classroom_grade_week(p_class_id uuid, p_assessment_date date)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_current_week_id uuid;
  v_week_id uuid;
  v_today date := (now() at time zone 'America/Bogota')::date;
begin
  select classroom_week.id
  into v_current_week_id
  from public.classes classroom
  join public.teacher_star_settings setting on setting.teacher_id = classroom.teacher_id
  join public.classroom_weeks classroom_week
    on classroom_week.class_id = classroom.id
    and classroom_week.label = setting.current_week_label
  where classroom.id = p_class_id;

  if v_current_week_id is not null and p_assessment_date between v_today - 3 and v_today + 14 then
    return v_current_week_id;
  end if;

  select classroom_week.id
  into v_week_id
  from public.classroom_weeks classroom_week
  where classroom_week.class_id = p_class_id
  order by
    (
      select min(abs(work_item.activity_date - p_assessment_date))
      from public.classroom_work_items work_item
      where work_item.week_id = classroom_week.id
        and work_item.activity_date is not null
    ) nulls last,
    case when exists (
      select 1 from public.classroom_work_items work_item where work_item.week_id = classroom_week.id
    ) or exists (
      select 1 from public.classroom_star_events star_event where star_event.week_id = classroom_week.id
    ) then 0 else 1 end,
    case when exists (
      select 1 from public.classroom_work_items work_item where work_item.week_id = classroom_week.id
    ) or exists (
      select 1 from public.classroom_star_events star_event where star_event.week_id = classroom_week.id
    ) then -classroom_week.sort_order else classroom_week.sort_order end
  limit 1;

  return coalesce(v_week_id, v_current_week_id);
end;
$$;

update public.classroom_grade_columns grade_column
set week_id = public.default_classroom_grade_week(grade_column.class_id, grade_column.assessment_date)
where grade_column.source = 'assessment'
  and public.default_classroom_grade_week(grade_column.class_id, grade_column.assessment_date) is not null;
