alter table public.class_members
  add column nickname text,
  add column nickname_is_custom boolean not null default false;

create or replace function public.refresh_class_member_nicknames(p_class_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  with roster as (
    select
      cm.student_id,
      regexp_replace(
        coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(split_part(p.email, '@', 1)), ''), 'Student'),
        '\s+',
        ' ',
        'g'
      ) as source_name
    from public.class_members cm
    join public.profiles p on p.id = cm.student_id
    where cm.class_id = p_class_id
  ), name_parts as (
    select
      student_id,
      source_name,
      split_part(source_name, ' ', 1) as first_name,
      split_part(source_name, ' ', 2) as last_name
    from roster
  ), suggestions as (
    select
      student_id,
      case
        when count(*) over (partition by lower(first_name)) > 1 and source_name like '% %'
          then first_name || ' ' || left(last_name, 1)
        else first_name
      end as nickname
    from name_parts
  )
  update public.class_members cm
  set nickname = left(s.nickname, 80)
  from suggestions s
  where cm.class_id = p_class_id
    and cm.student_id = s.student_id
    and not cm.nickname_is_custom
    and cm.nickname is distinct from left(s.nickname, 80);
$$;

revoke all on function public.refresh_class_member_nicknames(uuid) from public;

create or replace function public.refresh_nicknames_after_membership_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_class_member_nicknames(old.class_id);
    return old;
  end if;
  perform public.refresh_class_member_nicknames(new.class_id);
  return new;
end;
$$;

create trigger class_members_refresh_nicknames_after_insert
after insert on public.class_members
for each row execute function public.refresh_nicknames_after_membership_change();

create trigger class_members_refresh_nicknames_after_delete
after delete on public.class_members
for each row execute function public.refresh_nicknames_after_membership_change();

create trigger class_members_refresh_nickname_after_reset
after update of nickname_is_custom on public.class_members
for each row
when (old.nickname_is_custom and not new.nickname_is_custom)
execute function public.refresh_nicknames_after_membership_change();

create or replace function public.refresh_nicknames_after_profile_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class_id uuid;
begin
  for v_class_id in
    select cm.class_id from public.class_members cm where cm.student_id = new.id
  loop
    perform public.refresh_class_member_nicknames(v_class_id);
  end loop;
  return new;
end;
$$;

create trigger profiles_refresh_class_nicknames
after update of full_name, email on public.profiles
for each row
when (old.full_name is distinct from new.full_name or old.email is distinct from new.email)
execute function public.refresh_nicknames_after_profile_change();

do $$
declare
  v_class_id uuid;
begin
  for v_class_id in select id from public.classes
  loop
    perform public.refresh_class_member_nicknames(v_class_id);
  end loop;
end;
$$;

alter table public.class_members
  alter column nickname set default 'Student',
  alter column nickname set not null,
  add constraint class_members_nickname_valid check (
    nickname = btrim(nickname)
    and char_length(nickname) between 1 and 80
    and nickname !~ '[[:cntrl:]]'
  );
