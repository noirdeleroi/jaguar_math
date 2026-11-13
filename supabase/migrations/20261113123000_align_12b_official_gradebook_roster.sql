-- Remove the obsolete 12B copy row that shifts grades after Escobar.
do $$
declare
  v_class_id uuid;
  v_official_names text[] := array[
    'Cabra Nava Andrés Felipe',
    'Castaño Romero Tomás',
    'Díaz Álzate Simón',
    'Duque Pérez Luciana',
    'Escobar Avendaño Santiago',
    'Giraldo Vargas Santiago',
    'González García Lorenzo',
    'Jiménez Cano Juliana',
    'Kruichak Ramirez Angelina Meredith',
    'Londoño López Salomón',
    'López Cortés Samuel Andrés',
    'Lozada Florez Mariana',
    'Mcfarlane Tyrique Trevaughn',
    'Montoya Burgos Samuel Andrés',
    'Moreno Duque Gabriela',
    'Pérez Marín Martín',
    'Pérez Quiceno Paulina',
    'Rada Cano Josue',
    'Ruíz Palma Antonia',
    'Tirado Rincón Samantha'
  ];
begin
  select id into strict v_class_id
  from public.classes
  where name = '12B Math' and academic_year = '2026-27';

  perform 1 from public.class_gradebook_students
  where class_id = v_class_id
  for update;

  if (
    select array_agg(gradebook_name order by sort_order)
    from public.class_gradebook_students
    where class_id = v_class_id and gradebook_code <> '24231'
  ) is distinct from v_official_names then
    raise exception '12B roster differs from the expected official students';
  end if;

  if exists (
    select 1 from public.class_gradebook_students
    where class_id = v_class_id and gradebook_code = '24231'
      and (gradebook_name <> 'Ferrucho Díaz Luciana' or student_id is not null)
  ) then
    raise exception 'The obsolete 12B placeholder must be unmatched';
  end if;

  delete from public.class_gradebook_students
  where class_id = v_class_id and gradebook_code = '24231';

  -- Free unique positions before assigning the contiguous official order.
  -- Student links, memberships, and all grade records are preserved.
  update public.class_gradebook_students
  set sort_order = sort_order + 100
  where class_id = v_class_id;

  update public.class_gradebook_students roster
  set sort_order = official.position::integer
  from unnest(v_official_names) with ordinality as official(name, position)
  where roster.class_id = v_class_id and roster.gradebook_name = official.name;

  if (
    select array_agg(gradebook_name order by sort_order)
    from public.class_gradebook_students
    where class_id = v_class_id
  ) is distinct from v_official_names or (
    select array_agg(sort_order order by sort_order)
    from public.class_gradebook_students
    where class_id = v_class_id
  ) is distinct from array(select generate_series(1, 20)) then
    raise exception '12B must contain exactly 20 official rows in positions 1 through 20';
  end if;
end;
$$;
