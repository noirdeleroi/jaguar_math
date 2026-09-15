create table public.class_gradebook_students (
  class_id uuid not null references public.classes(id) on delete cascade,
  gradebook_code text not null check (gradebook_code ~ '^[0-9]+$'),
  gradebook_name text not null check (char_length(btrim(gradebook_name)) between 1 and 180),
  sort_order integer not null check (sort_order > 0),
  student_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (class_id, gradebook_code),
  unique (class_id, sort_order)
);

create index class_gradebook_students_student_idx
on public.class_gradebook_students (student_id)
where student_id is not null;

create trigger class_gradebook_students_set_updated_at
before update on public.class_gradebook_students
for each row execute function public.set_updated_at();

with official_roster(class_name, sort_order, gradebook_code, gradebook_name) as (
  values
    ('12B Math', 1, '27141', 'Cabra Nava Andrés Felipe'),
    ('12B Math', 2, '12842', 'Castaño Romero Tomás'),
    ('12B Math', 3, '25041', 'Díaz Álzate Simón'),
    ('12B Math', 4, '13182', 'Duque Pérez Luciana'),
    ('12B Math', 5, '12791', 'Escobar Avendaño Santiago'),
    ('12B Math', 6, '24231', 'Ferrucho Díaz Luciana'),
    ('12B Math', 7, '24961', 'Giraldo Vargas Santiago'),
    ('12B Math', 8, '22261', 'González García Lorenzo'),
    ('12B Math', 9, '28021', 'Jiménez Cano Juliana'),
    ('12B Math', 10, '29851', 'Kruichak Ramirez Angelina Meredith'),
    ('12B Math', 11, '13531', 'Londoño López Salomón'),
    ('12B Math', 12, '20101', 'López Cortés Samuel Andrés'),
    ('12B Math', 13, '13271', 'Lozada Florez Mariana'),
    ('12B Math', 14, '29071', 'Mcfarlane Tyrique Trevaughn'),
    ('12B Math', 15, '20272', 'Montoya Burgos Samuel Andrés'),
    ('12B Math', 16, '27901', 'Moreno Duque Gabriela'),
    ('12B Math', 17, '26211', 'Pérez Marín Martín'),
    ('12B Math', 18, '27081', 'Pérez Quiceno Paulina'),
    ('12B Math', 19, '20171', 'Rada Cano Josue'),
    ('12B Math', 20, '8243', 'Ruíz Palma Antonia'),
    ('12B Math', 21, '27731', 'Tirado Rincón Samantha'),

    ('12A Math', 1, '21332', 'Cano Jaimes Tomás'),
    ('12A Math', 2, '20431', 'Cardona Zapata Emiliano'),
    ('12A Math', 3, '13182', 'Duque Pérez Luciana'),
    ('12A Math', 4, '12792', 'Escobar Avendaño Andrés'),
    ('12A Math', 5, '21261', 'Espejo Espinal Salomé'),
    ('12A Math', 6, '24231', 'Ferrucho Díaz Luciana'),
    ('12A Math', 7, '27751', 'Galvez Duque Carlos Alberto'),
    ('12A Math', 8, '20601', 'García Suárez Sara Isabel'),
    ('12A Math', 9, '22342', 'Granados Piñeros Silvana'),
    ('12A Math', 10, '27911', 'Hernández Valencia Samuel'),
    ('12A Math', 11, '29851', 'Kruichak Ramirez Angelina Meredith'),
    ('12A Math', 12, '29021', 'Mahroogh Nika'),
    ('12A Math', 13, '13301', 'Pacheco Rubiano Manuel Felipe'),
    ('12A Math', 14, '13201', 'Pinzón Escobar Juan José'),
    ('12A Math', 15, '20041', 'Quintero Gómez Antonia'),
    ('12A Math', 16, '10762', 'Quintero Viveros Mariana'),
    ('12A Math', 17, '13251', 'Rodríguez Patiño Tomás'),
    ('12A Math', 18, '20031', 'Russi Salazar Juanita'),
    ('12A Math', 19, '28711', 'Sepúlveda Pérez Santiago'),
    ('12A Math', 20, '25891', 'Velásquez Serna Sara'),
    ('12A Math', 21, '23301', 'Velásquez Wartski Elena'),
    ('12A Math', 22, '20591', 'Villafañe Solano Gabriel'),
    ('12A Math', 23, '20061', 'Villegas Rojas Tomás'),

    ('11C Math', 1, '27721', 'Alzate Osorio Jacob Thomas'),
    ('11C Math', 2, '21031', 'Cárdenas Bonilla Samuel'),
    ('11C Math', 3, '23092', 'Cuello Reino Juliana'),
    ('11C Math', 4, '20151', 'Galvis Sánchez María Camila'),
    ('11C Math', 5, '12732', 'Gómez Abdallah Paloma'),
    ('11C Math', 6, '12802', 'Hernández Gómez Matías'),
    ('11C Math', 7, '24872', 'Jaramillo Upegui Felipe'),
    ('11C Math', 8, '28991', 'Kassetas Salazar Luna'),
    ('11C Math', 9, '20541', 'Marín Delgado Nicolás'),
    ('11C Math', 10, '12702', 'Mejía Quintero Violeta'),
    ('11C Math', 11, '20731', 'Montoya Gutiérrez Miguel Angel'),
    ('11C Math', 12, '28881', 'Motato Hurtado Simón'),
    ('11C Math', 13, '20191', 'Ochoa Espinosa Maríajosé'),
    ('11C Math', 14, '13003', 'Recio Camargo David'),
    ('11C Math', 15, '12952', 'Rivera Areiza Juan'),
    ('11C Math', 16, '20901', 'Salazar Jaramillo Mattías'),
    ('11C Math', 17, '28691', 'Sánchez Rodas Camila'),
    ('11C Math', 18, '12452', 'Taborda Cruz Santiago'),
    ('11C Math', 19, '20241', 'Valencia Mejía María José'),
    ('11C Math', 20, '25022', 'Vélez Gómez Emiliano'),

    ('11B Math', 1, '28801', 'Arenas David'),
    ('11B Math', 2, '20211', 'Bretón Rojas Sara Isabela'),
    ('11B Math', 3, '20111', 'Cañaveral Botero Samuel'),
    ('11B Math', 4, '11512', 'Gallego Bettín Mariana'),
    ('11B Math', 5, '5662', 'Gómez Echeverri Valeria'),
    ('11B Math', 6, '26562', 'Hoyos López Santiago'),
    ('11B Math', 7, '10192', 'Lemus Arbeláez Pablo'),
    ('11B Math', 8, '20381', 'Mejía López Juan Martín'),
    ('11B Math', 9, '13511', 'Montoya Patiño Samuel'),
    ('11B Math', 10, '21971', 'Ospina Tabares Juan José'),
    ('11B Math', 11, '20291', 'Pineda Vera Samuel'),
    ('11B Math', 12, '13102', 'Quintero Puerta Susana'),
    ('11B Math', 13, '20951', 'Quintero Ramírez Gabriel'),
    ('11B Math', 14, '21061', 'Ramírez Betancur Martín'),
    ('11B Math', 15, '29771', 'Rengifo Luna Sarina'),
    ('11B Math', 16, '20691', 'Rosero Trujillo Samanta'),
    ('11B Math', 17, '27811', 'Torres Bedoya Manuela'),
    ('11B Math', 18, '20481', 'Valencia Amaya Esteban'),
    ('11B Math', 19, '20131', 'Zuluaga Sánchez Violeta'),

    ('11A Math', 1, '24891', 'Cardona Concha Pedro'),
    ('11A Math', 2, '30341', 'Chinchilla Sánchez Francisco Manuel'),
    ('11A Math', 3, '23092', 'Cuello Reino Juliana'),
    ('11A Math', 4, '12322', 'Díaz Valencia Nicolás'),
    ('11A Math', 5, '20621', 'Fernández Ramírez Samuel'),
    ('11A Math', 6, '21341', 'Fortich Márquez Fernán Camilo'),
    ('11A Math', 7, '23231', 'Franco Alzate Emilia'),
    ('11A Math', 8, '20721', 'Gaviria Rico Emiliano'),
    ('11A Math', 9, '20612', 'Gómez Sánchez Luciana'),
    ('11A Math', 10, '21232', 'Grant-Hunter Martínez Isabella'),
    ('11A Math', 11, '26562', 'Hoyos López Santiago'),
    ('11A Math', 12, '20161', 'Londoño Arregocés Gabriela'),
    ('11A Math', 13, '21071', 'Molina Echeverri Martín'),
    ('11A Math', 14, '20421', 'Ortegón Bernal Martín'),
    ('11A Math', 15, '29722', 'Quintero Hércules Santiago'),
    ('11A Math', 16, '20551', 'Ríos Aristizábal Paulina'),
    ('11A Math', 17, '21221', 'Ruiz Ramírez Camilo'),
    ('11A Math', 18, '26481', 'Sánchez Jerez Juan Alejandro'),
    ('11A Math', 19, '26261', 'Varona Bedoya Juan Felipe')
)
insert into public.class_gradebook_students (
  class_id, gradebook_code, gradebook_name, sort_order
)
select classroom.id, official_roster.gradebook_code, official_roster.gradebook_name, official_roster.sort_order
from official_roster
join public.classes classroom on classroom.name = official_roster.class_name
on conflict (class_id, gradebook_code) do update set
  gradebook_name = excluded.gradebook_name,
  sort_order = excluded.sort_order;

create function public.gradebook_name_tokens(p_value text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct token order by token), '{}'::text[])
  from regexp_split_to_table(
    lower(translate(coalesce(p_value, ''), 'áéíóúüñ', 'aeiouun')),
    '[^a-z0-9]+'
  ) token
  where char_length(token) > 1;
$$;

with scored as (
  select
    roster.class_id,
    roster.gradebook_code,
    member.student_id,
    (
      select count(*)
      from unnest(public.gradebook_name_tokens(roster.gradebook_name)) official_token
      where official_token = any(public.gradebook_name_tokens(profile.full_name))
    ) as overlap
  from public.class_gradebook_students roster
  join public.class_members member on member.class_id = roster.class_id
  join public.profiles profile on profile.id = member.student_id
), ranked as (
  select
    scored.*,
    row_number() over (
      partition by scored.class_id, scored.gradebook_code
      order by scored.overlap desc, scored.student_id
    ) as match_rank
  from scored
)
update public.class_gradebook_students roster
set student_id = ranked.student_id
from ranked
where roster.class_id = ranked.class_id
  and roster.gradebook_code = ranked.gradebook_code
  and ranked.match_rank = 1
  and ranked.overlap >= 2;

drop function public.gradebook_name_tokens(text);

create unique index class_gradebook_students_class_student_unique
on public.class_gradebook_students (class_id, student_id)
where student_id is not null;

alter table public.class_gradebook_students enable row level security;

revoke all on table public.class_gradebook_students from anon, public;
grant select, insert, update, delete on table public.class_gradebook_students to authenticated;

create policy "class gradebook students: teachers read owned classes"
on public.class_gradebook_students
for select to authenticated
using (
  exists (
    select 1 from public.classes
    where classes.id = class_gradebook_students.class_id
      and classes.teacher_id = auth.uid()
  )
);

create policy "class gradebook students: teachers insert owned classes"
on public.class_gradebook_students
for insert to authenticated
with check (
  exists (
    select 1 from public.classes
    where classes.id = class_gradebook_students.class_id
      and classes.teacher_id = auth.uid()
  )
);

create policy "class gradebook students: teachers update owned classes"
on public.class_gradebook_students
for update to authenticated
using (
  exists (
    select 1 from public.classes
    where classes.id = class_gradebook_students.class_id
      and classes.teacher_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.classes
    where classes.id = class_gradebook_students.class_id
      and classes.teacher_id = auth.uid()
  )
);

create policy "class gradebook students: teachers delete owned classes"
on public.class_gradebook_students
for delete to authenticated
using (
  exists (
    select 1 from public.classes
    where classes.id = class_gradebook_students.class_id
      and classes.teacher_id = auth.uid()
  )
);

comment on table public.class_gradebook_students is
'Official SIS gradebook roster, student codes, names, and paste order for each class. Rows may remain unmatched when a student is not enrolled in Jaguar.';
