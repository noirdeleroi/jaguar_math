-- A teacher reopening a grade is an explicit hold even before answers change.
-- Retry recognition in place, preserving original evidence and every prior
-- detector result. Never replace teacher decisions or a finalized page/grade.
create or replace function public.reprocess_scan_page(
  p_page_id uuid, p_teacher_id uuid, p_revision integer,
  p_sheet uuid, p_sheet_page integer, p_normalized_path text,
  p_readings jsonb, p_problem text, p_algorithm text
)
returns public.paper_scan_pages language plpgsql security definer set search_path = '' as $$
declare p public.paper_scan_pages; s public.paper_scan_sheets; v_old_sheet uuid; v_status text;
begin
  select page.* into p from public.paper_scan_pages page join public.assignments a on a.id = page.assignment_id
  where page.id = p_page_id and a.created_by = p_teacher_id and a.paper_scan_enabled and a.archived_at is null
  for update of page;
  if not found then raise exception 'Scan not found'; end if;
  if p_revision is null or p.revision <> p_revision then raise exception 'This scan changed. Refresh before retrying'; end if;
  if p.status not in ('unidentified','review') or p.decisions is not null or exists(select 1 from public.paper_scan_audit where page_id = p.id and event like 'manual_%') then raise exception 'Recognition cannot replace a reviewed or finalized page'; end if;
  v_old_sheet := p.sheet_id;
  if p_sheet is not null then
    select * into s from public.paper_scan_sheets where id = p_sheet and assignment_id = p.assignment_id for update;
    if not found then raise exception 'Sheet belongs to another assessment'; end if;
    perform public.validate_scan_readings(s.id,p_sheet_page,p_readings,false);
    v_status := case when p_problem is null and not exists(select 1 from jsonb_array_elements(p_readings) r where r->>'status' <> 'clear' or r->>'choice' is null) then 'accepted' else 'review' end;
    if exists(select 1 from public.paper_scan_pages where sheet_id = s.id and sheet_page = p_sheet_page and status in ('review','accepted') and id <> p.id) then v_status := 'duplicate'; end if;
  else v_status := 'unidentified'; end if;
  insert into public.paper_scan_audit(assignment_id,page_id,sheet_id,actor_id,event,detail)
  values(p.assignment_id,p.id,s.id,p_teacher_id,'recognition_retried',jsonb_build_object(
    'previousStatus',p.status,'previousSheetId',p.sheet_id,'previousReadings',p.readings,'previousProblem',p.problem,
    'previousAlgorithm',p.algorithm,'status',v_status,'readings',p_readings,'problem',p_problem,'algorithm',p_algorithm));
  update public.paper_scan_pages set sheet_id = s.id,sheet_page = case when s.id is null then null else p_sheet_page end,
    normalized_path = p_normalized_path,readings = p_readings,problem = p_problem,algorithm = p_algorithm,
    status = v_status, revision = revision + 1 where id = p.id returning * into p;
  if v_old_sheet is not null and v_old_sheet is distinct from p.sheet_id then perform public.scan_refresh_grade(v_old_sheet,p_teacher_id); end if;
  if p.sheet_id is not null and v_status <> 'duplicate' then perform public.scan_refresh_grade(p.sheet_id,p_teacher_id); end if;
  return p;
end; $$;
revoke all on function public.reprocess_scan_page(uuid,uuid,integer,uuid,integer,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.reprocess_scan_page(uuid,uuid,integer,uuid,integer,text,jsonb,text,text) to service_role;
