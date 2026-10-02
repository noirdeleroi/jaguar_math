update public.class_gradebook_students roster
set student_id = profile.id
from public.classes classroom
join public.profiles profile
  on profile.email = 'violeta.zuluaga@liceoingles.edu.co'
join public.class_members member
  on member.class_id = classroom.id
  and member.student_id = profile.id
where roster.class_id = classroom.id
  and classroom.name = '11B Math'
  and classroom.academic_year = '2026-27'
  and roster.gradebook_code = '20131';

do $$
begin
  if not exists (
    select 1
    from public.class_gradebook_students roster
    join public.classes classroom on classroom.id = roster.class_id
    where classroom.name = '11B Math'
      and classroom.academic_year = '2026-27'
      and roster.gradebook_code = '20131'
      and roster.student_id is not null
  ) then
    raise exception 'Violeta must be linked to the 11B gradebook roster';
  end if;
end;
$$;
