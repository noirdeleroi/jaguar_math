alter table public.assignments
add column archived_at timestamptz,
add column archived_from_status text check (archived_from_status in ('draft', 'published', 'closed'));

create index assignments_created_by_archived_at_idx
on public.assignments (created_by, archived_at, created_at desc);

create or replace function public.archive_owned_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_status text;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can archive assignments';
  end if;

  select status into v_status
  from public.assignments
  where id = p_assignment_id and created_by = v_user and archived_at is null
  for update;
  if not found then raise exception 'Assignment is not available to archive'; end if;

  if v_status = 'published' then perform public.close_owned_assignment(p_assignment_id); end if;

  update public.assignments
  set status = 'closed', archived_at = now(), archived_from_status = v_status
  where id = p_assignment_id and created_by = v_user and archived_at is null;
end;
$$;

create or replace function public.unarchive_owned_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can restore assignments';
  end if;
  update public.assignments
  set status = case when archived_from_status = 'draft' then 'draft' else 'closed' end,
      archived_at = null,
      archived_from_status = null
  where id = p_assignment_id and created_by = v_user and archived_at is not null;
  if not found then raise exception 'Assignment is not available to restore'; end if;
end;
$$;

create or replace function public.reopen_owned_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can reopen assignments';
  end if;
  if not exists (select 1 from public.assignments where id = p_assignment_id and created_by = v_user) then
    raise exception 'Assignment is not managed by this teacher';
  end if;
  update public.assignments set status = 'published'
  where id = p_assignment_id and status = 'closed' and archived_at is null;
  if not found then raise exception 'Only unarchived closed assignments can be reopened'; end if;
end;
$$;

revoke all on function public.archive_owned_assignment(uuid) from public;
revoke all on function public.unarchive_owned_assignment(uuid) from public;
grant execute on function public.archive_owned_assignment(uuid) to authenticated;
grant execute on function public.unarchive_owned_assignment(uuid) to authenticated;

