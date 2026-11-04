-- Run against a migrated disposable PostgreSQL database with psql -v ON_ERROR_STOP=1.
-- Fixtures and all changes roll back. No real grades are used.
begin;
insert into auth.users(id) values
  ('10000000-0000-4000-8000-000000000001'), ('10000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000001'), ('20000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000003'), ('20000000-0000-4000-8000-000000000004'),
  ('20000000-0000-4000-8000-000000000005');
insert into public.profiles(id, role, full_name)
select id, case when id::text like '1000%' then 'teacher' else 'student' end, 'Project test fixture'
from auth.users where id::text like '10000000-%' or id::text like '20000000-%';
insert into public.classes(id, name, grade_level, academic_year, teacher_id) values
  ('30000000-0000-4000-8000-000000000001', 'Project test class A', 12, '2026-2027', '10000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', 'Project test class B', 12, '2026-2027', '10000000-0000-4000-8000-000000000001');
insert into public.class_members(class_id, student_id)
select '30000000-0000-4000-8000-000000000001', id from public.profiles where id::text like '20000000-%' and id::text not like '%000005';
insert into public.class_members(class_id, student_id) values ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000005');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
set local role authenticated;

do $$
declare
  v_class uuid := '30000000-0000-4000-8000-000000000001';
  v_other uuid := '30000000-0000-4000-8000-000000000002';
  v_doc jsonb; v_project public.classroom_projects; v_saved public.classroom_projects; v_bad jsonb; v_week text;
  v_count integer; v_work_count integer; v_status_count integer; v_manual uuid; v_week_id uuid;
begin
  select label, id into v_week, v_week_id from public.classroom_weeks where class_id = v_class order by sort_order limit 1;
  perform public.create_classroom_work_items(array[v_class], v_week, 'homework', 'Existing homework', current_date);
  perform public.create_classroom_work_items(array[v_class], v_week, 'classwork', 'Existing classwork', current_date);
  select count(*) into v_work_count from public.classroom_work_items where class_id = v_class;
  select count(*) into v_status_count from public.classroom_work_statuses s join public.classroom_work_items w on w.id = s.work_item_id where w.class_id = v_class;
  insert into public.classroom_grade_columns(class_id, week_id, title, assessment_date, source, max_score)
    values(v_class, v_week_id, 'Existing manual grade', current_date, 'manual', 20) returning id into v_manual;
  insert into public.classroom_manual_grades(column_id, student_id, score) values(v_manual, '20000000-0000-4000-8000-000000000001', 17);
  v_doc := jsonb_build_object('rubricVersion', 1, 'teams', jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid(), 'name', 'Group 1', 'scores', jsonb_build_array(18,17,19),
    'members', (select jsonb_agg(jsonb_build_object('studentId', student_id, 'label', 'Existing student')) from public.class_members where class_id = v_class)
  )), 'individualScores', jsonb_build_object('20000000-0000-4000-8000-000000000001', jsonb_build_array(20,20)));
  v_project := public.create_business_poster_project(v_class, v_week, current_date, v_doc);
  if v_project.document <> v_doc or v_project.revision <> 0 then raise exception 'Creation did not preserve rubric'; end if;
  if not exists (select 1 from public.classroom_grade_columns where id = v_project.column_id and class_id = v_class and source = 'project' and max_score = 100 and title = 'Business Poster Project') then raise exception 'Missing gradebook column'; end if;
  if (select count(*) from public.classroom_work_items where class_id = v_class) <> v_work_count + 1 then raise exception 'Work items changed unexpectedly'; end if;
  if (select count(*) from public.classroom_work_statuses s join public.classroom_work_items w on w.id = s.work_item_id where w.class_id = v_class) <> v_status_count then raise exception 'Project marked missing scores as completed'; end if;
  if not exists (select 1 from public.classroom_manual_grades where column_id = v_manual and score = 17) then raise exception 'Existing grade changed'; end if;
  raise notice 'PASS: atomic class-scoped creation, gradebook link, existing HW/CW and grades preserved';

  v_doc := jsonb_set(v_doc, '{teams,0,scores}', '[0,null,20]');
  v_saved := public.save_business_poster_project(v_class, v_project.work_item_id, 0, v_doc);
  if v_saved.revision <> 1 or (select document from public.classroom_projects where work_item_id = v_project.work_item_id) <> v_doc then raise exception 'Saved scores did not restore'; end if;
  if v_saved.document #> '{teams,0,scores,0}' <> '0'::jsonb or v_saved.document #> '{teams,0,scores,1}' <> 'null'::jsonb then raise exception 'Zero and blank were conflated'; end if;
  begin
    perform public.save_business_poster_project(v_class, v_project.work_item_id, 0, v_project.document);
    raise exception 'Stale write unexpectedly succeeded';
  exception when sqlstate 'PT409' then null;
  end;
  if (select document from public.classroom_projects where work_item_id = v_project.work_item_id) <> v_doc then raise exception 'Stale save overwrote scores'; end if;
  raise notice 'PASS: persistence, null vs zero, and stale revision protection';

  foreach v_bad in array array[
    jsonb_set(v_doc, '{teams,0,scores,0}', '21'), jsonb_set(v_doc, '{teams,0,scores,0}', '-1'),
    jsonb_set(v_doc, '{teams,0,scores,0}', '"12"'), jsonb_set(v_doc, '{teams,0,scores}', '[1,2]'),
    jsonb_set(v_doc, '{teams,0,members,0,studentId}', '"20000000-0000-4000-8000-000000000005"'),
    jsonb_set(v_doc, '{teams,0,members,1,studentId}', v_doc #> '{teams,0,members,0,studentId}')
  ] loop
    begin
      perform public.save_business_poster_project(v_class, v_project.work_item_id, 1, v_bad);
      raise exception 'Invalid document unexpectedly saved' using errcode = 'XX000';
    exception when raise_exception then null;
    end;
  end loop;
  begin
    perform public.save_business_poster_project(v_other, v_project.work_item_id, 1, v_doc);
    raise exception 'Cross-class save unexpectedly succeeded';
  exception when no_data_found then null;
  end;
  begin
    update public.classroom_projects set document = '{}' where work_item_id = v_project.work_item_id;
    raise exception 'Direct rubric overwrite unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.classroom_manual_grades(column_id, student_id, score) values(v_project.column_id, '20000000-0000-4000-8000-000000000001', 99);
    raise exception 'Conflicting manual project grade unexpectedly saved' using errcode = 'XX000';
  exception when raise_exception then null;
  end;
  raise notice 'PASS: range checks, duplicate prevention, roster isolation, protected single source of truth';

  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
  select count(*) into v_count from public.classroom_projects;
  if v_count <> 0 then raise exception 'Another teacher can read this project'; end if;
  begin
    perform public.save_business_poster_project(v_class, v_project.work_item_id, 1, v_doc);
    raise exception 'Another teacher changed the project';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', true);
  if (select count(*) from public.classroom_projects) <> 0 then raise exception 'Student can read private rubric'; end if;
  begin
    perform public.create_business_poster_project(v_class, v_week, current_date, v_doc);
    raise exception 'Student created a project';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: RLS and teacher/student authorization';
end;
$$;
rollback;
