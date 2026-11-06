-- Copy grades uses this roster's sort_order, independently of the class display order.
-- Remove the obsolete placeholder and preserve every enrolled student's link and grades.
do $$
declare
  v_class_id uuid;
  v_official_names text[] := array[
    'Arenas David',
    'Bretón Rojas Sara Isabela',
    'Cañaveral Botero Samuel',
    'Chinchilla Sánchez Francisco Manuel',
    'Gallego Bettín Mariana',
    'Gómez Echeverri Valeria',
    'Lemus Arbeláez Pablo',
    'Mejía López Juan Martín',
    'Montoya Patiño Samuel',
    'Ospina Tabares Juan José',
    'Pineda Vera Samuel',
    'Quintero Puerta Susana',
    'Quintero Ramírez Gabriel',
    'Ramírez Betancur Martín',
    'Rengifo Luna Sarina',
    'Rosero Trujillo Samanta',
    'Torres Bedoya Manuela',
    'Valencia Amaya Esteban',
    'Zuluaga Sánchez Violeta'
  ];
begin
  select id into strict v_class_id
  from public.classes
  where name = '11B Math' and academic_year = '2026-27';

  perform 1 from public.class_gradebook_students
  where class_id = v_class_id
  for update;

  if (
    select array_agg(gradebook_name order by sort_order)
    from public.class_gradebook_students
    where class_id = v_class_id and gradebook_code <> '26562'
  ) is distinct from v_official_names then
    raise exception '11B roster differs from the expected official students';
  end if;

  if exists (
    select 1 from public.class_gradebook_students
    where class_id = v_class_id and gradebook_code = '26562'
      and (gradebook_name <> 'Hoyos López Santiago' or student_id is not null)
  ) then
    raise exception 'The obsolete 11B placeholder must be unmatched';
  end if;

  delete from public.class_gradebook_students
  where class_id = v_class_id and gradebook_code = '26562';

  -- Free the unique positions before assigning the contiguous official order.
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
  ) is distinct from array(select generate_series(1, 19)) then
    raise exception '11B must contain exactly 19 official rows in positions 1 through 19';
  end if;
end;
$$;
