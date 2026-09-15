create function public.gradebook_name_overlap(p_first text, p_second text)
returns integer
language sql
immutable
set search_path = ''
as $$
  with first_tokens as (
    select distinct token
    from regexp_split_to_table(
      lower(translate(coalesce(p_first, ''), 'áéíóúüñ', 'aeiouun')),
      '[^a-z0-9]+'
    ) token
    where char_length(token) > 1
  ), second_tokens as (
    select distinct token
    from regexp_split_to_table(
      lower(translate(coalesce(p_second, ''), 'áéíóúüñ', 'aeiouun')),
      '[^a-z0-9]+'
    ) token
    where char_length(token) > 1
  )
  select count(*)::integer
  from first_tokens
  join second_tokens using (token);
$$;

create function public.link_new_class_member_to_gradebook()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gradebook_code text;
begin
  select roster.gradebook_code
  into v_gradebook_code
  from public.class_gradebook_students roster
  join public.profiles profile on profile.id = new.student_id
  where roster.class_id = new.class_id
    and roster.student_id is null
    and public.gradebook_name_overlap(roster.gradebook_name, profile.full_name) >= 2
  order by public.gradebook_name_overlap(roster.gradebook_name, profile.full_name) desc,
    roster.sort_order
  limit 1;

  if v_gradebook_code is not null then
    update public.class_gradebook_students
    set student_id = new.student_id
    where class_id = new.class_id
      and gradebook_code = v_gradebook_code
      and student_id is null;
  end if;
  return new;
end;
$$;

create trigger class_members_link_gradebook_student
after insert on public.class_members
for each row execute function public.link_new_class_member_to_gradebook();

revoke all on function public.gradebook_name_overlap(text, text) from public, anon, authenticated;
revoke all on function public.link_new_class_member_to_gradebook() from public, anon, authenticated;

comment on function public.link_new_class_member_to_gradebook() is
'Links a newly enrolled Jaguar student to an unmatched official gradebook row when at least two normalized name tokens agree.';
