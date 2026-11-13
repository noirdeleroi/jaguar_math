-- Copy grades follows the official roster, including its placeholder rows.
-- Remove the two obsolete 12A placeholders that shift pasted grades.
do $$
declare
  v_class_id uuid;
  v_official_names text[] := array[
    'Cano Jaimes Tomás',
    'Cardona Zapata Emiliano',
    'Escobar Avendaño Andrés',
    'Espejo Espinal Salomé',
    'Ferrucho Díaz Luciana',
    'Galvez Duque Carlos Alberto',
    'García Suárez Sara Isabel',
    'Granados Piñeros Silvana',
    'Hernández Valencia Samuel',
    'Mahroogh Nika',
    'Pacheco Rubiano Manuel Felipe',
    'Pinzón Escobar Juan José',
    'Quintero Gómez Antonia',
    'Quintero Viveros Mariana',
    'Rodríguez Patiño Tomás',
    'Russi Salazar Juanita',
    'Sepúlveda Pérez Santiago',
    'Velásquez Serna Sara',
    'Velásquez Wartski Elena',
    'Villafañe Solano Gabriel',
    'Villegas Rojas Tomás'
  ];
begin
  select id into strict v_class_id
  from public.classes
  where name = '12A Math' and academic_year = '2026-27';

  perform 1 from public.class_gradebook_students
  where class_id = v_class_id
  for update;

  if (
    select array_agg(gradebook_name order by sort_order)
    from public.class_gradebook_students
    where class_id = v_class_id and gradebook_code not in ('13182', '29851')
  ) is distinct from v_official_names then
    raise exception '12A roster differs from the expected official students';
  end if;

  if exists (
    select 1 from public.class_gradebook_students
    where class_id = v_class_id and gradebook_code in ('13182', '29851')
      and (
        student_id is not null
        or (gradebook_code = '13182' and gradebook_name <> 'Duque Pérez Luciana')
        or (gradebook_code = '29851' and gradebook_name <> 'Kruichak Ramirez Angelina Meredith')
      )
  ) then
    raise exception 'The obsolete 12A placeholders must be unmatched';
  end if;

  delete from public.class_gradebook_students
  where class_id = v_class_id and gradebook_code in ('13182', '29851');

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
  ) is distinct from array(select generate_series(1, 21)) then
    raise exception '12A must contain exactly 21 official rows in positions 1 through 21';
  end if;
end;
$$;
