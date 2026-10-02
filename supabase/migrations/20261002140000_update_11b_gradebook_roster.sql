create temporary table new_11b_gradebook_roster (
  sort_order integer primary key,
  gradebook_code text not null unique,
  gradebook_name text not null
) on commit drop;

insert into new_11b_gradebook_roster (sort_order, gradebook_code, gradebook_name)
values
  (1, '28801', 'Arenas David'),
  (2, '20211', 'Bretón Rojas Sara Isabela'),
  (3, '20111', 'Cañaveral Botero Samuel'),
  (4, '30341', 'Chinchilla Sánchez Francisco Manuel'),
  (5, '11512', 'Gallego Bettín Mariana'),
  (6, '5662', 'Gómez Echeverri Valeria'),
  (7, '26562', 'Hoyos López Santiago'),
  (8, '10192', 'Lemus Arbeláez Pablo'),
  (9, '20381', 'Mejía López Juan Martín'),
  (10, '13511', 'Montoya Patiño Samuel'),
  (11, '21971', 'Ospina Tabares Juan José'),
  (12, '20291', 'Pineda Vera Samuel'),
  (13, '13102', 'Quintero Puerta Susana'),
  (14, '20951', 'Quintero Ramírez Gabriel'),
  (15, '21061', 'Ramírez Betancur Martín'),
  (16, '29771', 'Rengifo Luna Sarina'),
  (17, '20691', 'Rosero Trujillo Samanta'),
  (18, '27811', 'Torres Bedoya Manuela'),
  (19, '20481', 'Valencia Amaya Esteban'),
  (20, '20131', 'Zuluaga Sánchez Violeta');

do $$
begin
  if (
    select count(*)
    from public.classes
    where name = '11B Math'
      and academic_year = '2026-27'
  ) <> 1 then
    raise exception 'Expected exactly one 11B Math class for 2026-27';
  end if;
end;
$$;

-- Move existing positions out of the way before assigning the new unique order.
update public.class_gradebook_students roster
set sort_order = roster.sort_order + 100
from public.classes classroom
where classroom.id = roster.class_id
  and classroom.name = '11B Math'
  and classroom.academic_year = '2026-27';

with target_class as (
  select id
  from public.classes
  where name = '11B Math'
    and academic_year = '2026-27'
), matched_roster as (
  select
    target_class.id as class_id,
    official.gradebook_code,
    official.gradebook_name,
    official.sort_order,
    coalesce(matched_member.student_id, existing_member.student_id) as student_id
  from target_class
  cross join new_11b_gradebook_roster official
  left join public.class_gradebook_students existing_roster
    on existing_roster.class_id = target_class.id
    and existing_roster.gradebook_code = official.gradebook_code
  left join public.class_members existing_member
    on existing_member.class_id = target_class.id
    and existing_member.student_id = existing_roster.student_id
  left join lateral (
    select member.student_id
    from public.class_members member
    join public.profiles profile on profile.id = member.student_id
    where member.class_id = target_class.id
      and public.gradebook_name_overlap(official.gradebook_name, profile.full_name) >= 2
    order by
      public.gradebook_name_overlap(official.gradebook_name, profile.full_name) desc,
      member.student_id
    limit 1
  ) matched_member on true
)
insert into public.class_gradebook_students (
  class_id,
  gradebook_code,
  gradebook_name,
  sort_order,
  student_id
)
select
  class_id,
  gradebook_code,
  gradebook_name,
  sort_order,
  student_id
from matched_roster
on conflict (class_id, gradebook_code) do update set
  gradebook_name = excluded.gradebook_name,
  sort_order = excluded.sort_order,
  student_id = excluded.student_id;

delete from public.class_gradebook_students roster
using public.classes classroom
where classroom.id = roster.class_id
  and classroom.name = '11B Math'
  and classroom.academic_year = '2026-27'
  and not exists (
    select 1
    from new_11b_gradebook_roster official
    where official.gradebook_code = roster.gradebook_code
  );

do $$
declare
  v_class_id uuid;
begin
  select id
  into strict v_class_id
  from public.classes
  where name = '11B Math'
    and academic_year = '2026-27';

  if (
    select count(*)
    from public.class_gradebook_students
    where class_id = v_class_id
  ) <> 20 then
    raise exception 'The 11B gradebook roster must contain exactly 20 rows';
  end if;

  if exists (
    select 1
    from public.class_gradebook_students
    where class_id = v_class_id
      and gradebook_code = '26562'
      and student_id is not null
  ) then
    raise exception 'Santiago must remain an unmatched gradebook row';
  end if;
end;
$$;
