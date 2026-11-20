-- User requested removal of the unused 11B Business Poster duplicate.
-- The populated project, its rubric and all student scores remain unchanged.
do $$
declare
  v_class_id uuid := 'eff45768-ba8d-4efc-baaf-954d1f05557d';
  v_work_id uuid := 'ff2bb60b-207c-4fbe-b243-c4ff7579ff09';
  v_column_id uuid := '7f1a907e-49b7-401f-a629-82d7aed54457';
  v_saved_column_id uuid := '72f88549-0719-4c6f-af53-0bbcbe87cdf3';
begin
  perform 1 from public.classes
  where id = v_class_id and name = '11B Math' and academic_year = '2026-27'
  for update;
  if not found then raise exception 'Expected 11B class was not found'; end if;

  perform 1 from public.classroom_projects
  where class_id = v_class_id and column_id in (v_column_id, v_saved_column_id)
  for update;

  if not exists (
    select 1 from public.classroom_projects
    where class_id = v_class_id and column_id = v_saved_column_id
      and jsonb_array_length(document->'teams') > 0
  ) then
    raise exception 'The populated Business Poster project must remain available';
  end if;

  if not exists (
    select 1 from public.classroom_projects project
    join public.classroom_grade_columns col on col.id = project.column_id
    join public.classroom_work_items work on work.id = project.work_item_id
    where project.class_id = v_class_id and project.work_item_id = v_work_id
      and project.column_id = v_column_id and project.revision = 0
      and project.document = '{"rubricVersion":1,"teams":[],"individualScores":{}}'::jsonb
      and col.class_id = v_class_id and col.source = 'project'
      and col.title = 'Business Poster Project' and col.max_score = 100
      and work.class_id = v_class_id and work.title = 'Business Poster Project'
  ) then
    raise exception 'The duplicate has changed or is no longer empty; refusing deletion';
  end if;

  if exists (select 1 from public.classroom_manual_grades where column_id = v_column_id)
    or exists (select 1 from public.classroom_work_statuses where work_item_id = v_work_id)
    or exists (select 1 from public.classroom_weeks where summative_grade_column_id = v_column_id) then
    raise exception 'The duplicate has grades, statuses or a topic dependency; refusing deletion';
  end if;

  -- Deleting the work item also removes its empty project through the FK.
  delete from public.classroom_work_items where id = v_work_id and class_id = v_class_id;
  delete from public.classroom_grade_columns where id = v_column_id and class_id = v_class_id;
end;
$$;
