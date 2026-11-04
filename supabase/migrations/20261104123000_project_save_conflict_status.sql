-- Use an explicit HTTP conflict. Serialization failures can trigger transaction retries
-- in PostgREST instead of promptly returning the stale-revision message.
create or replace function public.save_business_poster_project(p_class_id uuid, p_work_item_id uuid, p_revision integer, p_document jsonb)
returns public.classroom_projects language plpgsql security definer set search_path = '' as $$
declare v_project public.classroom_projects;
begin
  if not public.is_teacher() or not exists (select 1 from public.classes c where c.id = p_class_id and c.teacher_id = auth.uid()) then
    raise exception 'Class is not available' using errcode = '42501';
  end if;
  select * into v_project from public.classroom_projects where work_item_id = p_work_item_id and class_id = p_class_id for update;
  if not found then raise exception 'Project is not available' using errcode = 'P0002'; end if;
  if p_revision is null or p_revision <> v_project.revision then
    raise exception 'This project has changed in another session. Reload the saved project before saving again.' using errcode = 'PT409';
  end if;
  perform public.validate_classroom_project_document(p_class_id, p_document);
  update public.classroom_projects set document = p_document, revision = revision + 1, updated_at = now()
    where work_item_id = p_work_item_id returning * into v_project;
  return v_project;
end;
$$;
