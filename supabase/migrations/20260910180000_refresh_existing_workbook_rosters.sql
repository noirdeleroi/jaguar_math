create or replace function public.import_classroom_star_workbook(
  p_class_id uuid,
  p_file_name text,
  p_file_sha256 text,
  p_weeks jsonb,
  p_star_totals jsonb,
  p_work_items jsonb,
  p_work_statuses jsonb,
  p_report jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher uuid := auth.uid();
  v_import_id uuid;
  v_is_refresh boolean := false;
  v_week jsonb;
  v_star jsonb;
  v_item jsonb;
  v_status jsonb;
  v_week_id uuid;
  v_work_item_id uuid;
  v_student_id uuid;
  v_existing_total integer;
  v_target_total integer;
  v_delta integer;
  v_kind text;
  v_rows integer;
  v_new_statuses integer := 0;
begin
  if v_teacher is null or not exists (select 1 from public.classes where id = p_class_id and teacher_id = v_teacher) then
    raise exception 'Class is not available to this teacher';
  end if;
  if p_file_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Workbook fingerprint is invalid'; end if;

  insert into public.classroom_star_imports (class_id, file_name, file_sha256, report, imported_by)
  values (p_class_id, left(p_file_name, 240), p_file_sha256, coalesce(p_report, '{}'::jsonb), v_teacher)
  on conflict (class_id, file_sha256) do nothing
  returning id into v_import_id;

  if v_import_id is null then
    v_is_refresh := true;
    select id into v_import_id
    from public.classroom_star_imports
    where class_id = p_class_id and file_sha256 = p_file_sha256;

    update public.classroom_star_imports
    set report = report || jsonb_build_object(
      'refresh_count', case when report->>'refresh_count' ~ '^[0-9]+$' then (report->>'refresh_count')::integer + 1 else 1 end,
      'last_refreshed_at', now(),
      'last_refresh_report', coalesce(p_report, '{}'::jsonb)
    )
    where id = v_import_id;
  end if;

  for v_week in select value from jsonb_array_elements(coalesce(p_weeks, '[]'::jsonb))
  loop
    if v_is_refresh then
      insert into public.classroom_weeks (class_id, label, sort_order, title, focus, created_by)
      values (p_class_id, btrim(v_week->>'label'), (v_week->>'sort_order')::integer, nullif(btrim(v_week->>'title'), ''), nullif(btrim(v_week->>'focus'), ''), v_teacher)
      on conflict (class_id, label) do nothing;
    else
      insert into public.classroom_weeks (class_id, label, sort_order, title, focus, created_by)
      values (p_class_id, btrim(v_week->>'label'), (v_week->>'sort_order')::integer, nullif(btrim(v_week->>'title'), ''), nullif(btrim(v_week->>'focus'), ''), v_teacher)
      on conflict (class_id, label) do update set title = coalesce(excluded.title, classroom_weeks.title), focus = coalesce(excluded.focus, classroom_weeks.focus);
    end if;
  end loop;

  if not v_is_refresh then
    for v_star in select value from jsonb_array_elements(coalesce(p_star_totals, '[]'::jsonb))
    loop
      v_student_id := (v_star->>'student_id')::uuid;
      if not exists (select 1 from public.class_members where class_id = p_class_id and student_id = v_student_id) then raise exception 'Import student is not enrolled in this class'; end if;
      select id into v_week_id from public.classroom_weeks where class_id = p_class_id and label = v_star->>'week_label';
      if v_week_id is null then raise exception 'Import week is not available'; end if;
      select coalesce(sum(delta), 0)::integer into v_existing_total from public.classroom_star_events where class_id = p_class_id and week_id = v_week_id and student_id = v_student_id;
      v_target_total := greatest(0, (v_star->>'total')::integer);
      v_delta := v_target_total - v_existing_total;
      if v_delta <> 0 then
        insert into public.classroom_star_events (id, class_id, week_id, student_id, delta, note, source, import_id, created_by)
        values (gen_random_uuid(), p_class_id, v_week_id, v_student_id, v_delta, 'Excel snapshot import: ' || left(p_file_name, 180), 'excel_import', v_import_id, v_teacher);
      end if;
    end loop;
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_work_items, '[]'::jsonb))
  loop
    v_kind := v_item->>'kind';
    if v_kind not in ('homework', 'classwork') then raise exception 'Import work item kind is invalid'; end if;
    select id into v_week_id from public.classroom_weeks where class_id = p_class_id and label = v_item->>'week_label';
    if v_week_id is null then raise exception 'Import week is not available'; end if;
    if v_is_refresh then
      insert into public.classroom_work_items (id, class_id, week_id, kind, position, title, activity_date, created_by)
      values (gen_random_uuid(), p_class_id, v_week_id, v_kind, (v_item->>'position')::integer, btrim(v_item->>'title'), nullif(v_item->>'activity_date', '')::date, v_teacher)
      on conflict (class_id, week_id, kind, position) do nothing;
    else
      insert into public.classroom_work_items (id, class_id, week_id, kind, position, title, activity_date, created_by)
      values (gen_random_uuid(), p_class_id, v_week_id, v_kind, (v_item->>'position')::integer, btrim(v_item->>'title'), nullif(v_item->>'activity_date', '')::date, v_teacher)
      on conflict (class_id, week_id, kind, position) do update set title = excluded.title, activity_date = excluded.activity_date;
    end if;
  end loop;

  for v_status in select value from jsonb_array_elements(coalesce(p_work_statuses, '[]'::jsonb))
  loop
    v_student_id := (v_status->>'student_id')::uuid;
    if not exists (select 1 from public.class_members where class_id = p_class_id and student_id = v_student_id) then raise exception 'Import status student is not enrolled in this class'; end if;
    v_kind := v_status->>'kind';
    select classroom_work_items.id into v_work_item_id
    from public.classroom_work_items classroom_work_items
    join public.classroom_weeks classroom_weeks on classroom_weeks.id = classroom_work_items.week_id
    where classroom_work_items.class_id = p_class_id and classroom_weeks.label = v_status->>'week_label'
      and classroom_work_items.kind = v_kind and classroom_work_items.position = (v_status->>'position')::integer;
    if v_work_item_id is null then raise exception 'Import work status item is not available'; end if;
    if nullif(v_status->>'status', '') is not null then
      if v_is_refresh then
        insert into public.classroom_work_statuses (work_item_id, student_id, status, updated_by)
        values (v_work_item_id, v_student_id, v_status->>'status', v_teacher)
        on conflict (work_item_id, student_id) do nothing;
        get diagnostics v_rows = row_count;
        v_new_statuses := v_new_statuses + v_rows;
      else
        insert into public.classroom_work_statuses (work_item_id, student_id, status, updated_by)
        values (v_work_item_id, v_student_id, v_status->>'status', v_teacher)
        on conflict (work_item_id, student_id) do update set status = excluded.status, updated_by = excluded.updated_by, updated_at = now();
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'status', case when v_is_refresh then 'refreshed' else 'imported' end,
    'import_id', v_import_id,
    'new_statuses', v_new_statuses,
    'stars_preserved', v_is_refresh
  );
end;
$$;

revoke all on function public.import_classroom_star_workbook(uuid, text, text, jsonb, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.import_classroom_star_workbook(uuid, text, text, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
