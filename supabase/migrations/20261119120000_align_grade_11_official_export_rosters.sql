-- Match the official T1 gradebooks supplied on 19 November 2026.
-- Only export rows change; accounts, memberships and grades stay intact.
do $$
declare
  v_class_id uuid;
  v_class_name text;
  v_official_names text[];
  v_obsolete_codes text[];
begin
  for v_class_name, v_official_names, v_obsolete_codes in
    select * from (values
      ('11A Math', array[
        'Cardona Concha Pedro',
        'Díaz Valencia Nicolás',
        'Fernández Ramírez Samuel',
        'Fortich Márquez Fernán Camilo',
        'Franco Alzate Emilia',
        'Gaviria Rico Emiliano',
        'Gómez Sánchez Luciana',
        'Grant-Hunter Martínez Isabella',
        'Hoyos López Santiago',
        'Londoño Arregocés Gabriela',
        'Molina Echeverri Martín',
        'Ortegón Bernal Martín',
        'Quintero Hércules Santiago',
        'Ríos Aristizábal Paulina',
        'Ruiz Ramírez Camilo',
        'Sánchez Jerez Juan Alejandro',
        'Varona Bedoya Juan Felipe'
      ]::text[], array['30341', '23092']::text[]),
      ('11B Math', array[
        'Arenas David',
        'Bretón Rojas Sara Isabela',
        'Cañaveral Botero Samuel',
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
      ]::text[], array['30341']::text[])
    ) as official(class_name, names, obsolete_codes)
  loop
    select id into strict v_class_id from public.classes
    where name = v_class_name and academic_year = '2026-27';

    perform 1 from public.class_gradebook_students
    where class_id = v_class_id for update;

    if (
      select array_agg(gradebook_name order by sort_order)
      from public.class_gradebook_students
      where class_id = v_class_id and not (gradebook_code = any(v_obsolete_codes))
    ) is distinct from v_official_names then
      raise exception '% roster differs from the expected official students', v_class_name;
    end if;

    -- Former student links can remain on export rows after a transfer.
    -- Refuse to remove a row if the linked student is still enrolled here.
    if exists (
      select 1 from public.class_gradebook_students roster
      join public.class_members member
        on member.class_id = roster.class_id and member.student_id = roster.student_id
      where roster.class_id = v_class_id and roster.gradebook_code = any(v_obsolete_codes)
    ) then
      raise exception '% obsolete export row still belongs to an enrolled student', v_class_name;
    end if;

    if exists (
      select 1 from public.class_gradebook_students
      where class_id = v_class_id and gradebook_code = any(v_obsolete_codes)
        and not (
          (gradebook_code = '30341' and gradebook_name = 'Chinchilla Sánchez Francisco Manuel')
          or (gradebook_code = '23092' and gradebook_name = 'Cuello Reino Juliana' and student_id is null)
        )
    ) then
      raise exception '% obsolete export rows have unexpected identities', v_class_name;
    end if;

    delete from public.class_gradebook_students
    where class_id = v_class_id and gradebook_code = any(v_obsolete_codes);

    update public.class_gradebook_students set sort_order = sort_order + 100
    where class_id = v_class_id;

    update public.class_gradebook_students roster
    set sort_order = official.position::integer
    from unnest(v_official_names) with ordinality as official(name, position)
    where roster.class_id = v_class_id and roster.gradebook_name = official.name;

    if (
      select array_agg(gradebook_name order by sort_order)
      from public.class_gradebook_students where class_id = v_class_id
    ) is distinct from v_official_names or (
      select array_agg(sort_order order by sort_order)
      from public.class_gradebook_students where class_id = v_class_id
    ) is distinct from array(select generate_series(1, cardinality(v_official_names))) then
      raise exception '% export order does not match the official gradebook', v_class_name;
    end if;
  end loop;
end;
$$;
