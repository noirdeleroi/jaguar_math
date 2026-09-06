create or replace function public.apply_google_classroom_sync(
  p_classes jsonb,
  p_courses jsonb,
  p_students jsonb,
  p_memberships jsonb,
  p_removals jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher uuid := auth.uid();
  v_class record;
  v_course record;
  v_student record;
  v_membership record;
  v_removal record;
begin
  if v_teacher is null or not exists (
    select 1 from public.profiles where id = v_teacher and role = 'teacher'
  ) then
    raise exception 'Only authenticated teachers can sync Google Classroom';
  end if;

  if coalesce(jsonb_typeof(p_classes), '') <> 'array'
    or coalesce(jsonb_typeof(p_courses), '') <> 'array'
    or coalesce(jsonb_typeof(p_students), '') <> 'array'
    or coalesce(jsonb_typeof(p_memberships), '') <> 'array'
    or coalesce(jsonb_typeof(p_removals), '') <> 'array'
  then
    raise exception 'Google Classroom sync payload is invalid';
  end if;

  if jsonb_array_length(p_classes) > 250
    or jsonb_array_length(p_courses) > 250
    or jsonb_array_length(p_students) > 5000
    or jsonb_array_length(p_memberships) > 10000
    or jsonb_array_length(p_removals) > 10000
  then
    raise exception 'Google Classroom sync payload is too large';
  end if;

  for v_class in
    select * from jsonb_to_recordset(p_classes) as item(
      id uuid,
      create_new boolean,
      name text,
      grade_level smallint,
      academic_year text
    )
  loop
    if v_class.id is null then
      raise exception 'Google Classroom class ID is required';
    end if;

    if coalesce(v_class.create_new, false) then
      if nullif(btrim(v_class.name), '') is null
        or nullif(btrim(v_class.academic_year), '') is null
        or v_class.grade_level not in (11, 12)
      then
        raise exception 'Google Classroom class details are invalid';
      end if;

      insert into public.classes (id, name, grade_level, academic_year, teacher_id)
      values (v_class.id, btrim(v_class.name), v_class.grade_level, btrim(v_class.academic_year), v_teacher);
    elsif not exists (
      select 1 from public.classes where id = v_class.id and teacher_id = v_teacher
    ) then
      raise exception 'Google Classroom class is not managed by this teacher';
    end if;
  end loop;

  for v_course in
    select * from jsonb_to_recordset(p_courses) as item(
      google_course_id text,
      class_id uuid,
      google_course_name text,
      google_course_section text,
      google_course_state text,
      last_synced_at timestamptz
    )
  loop
    if nullif(btrim(v_course.google_course_id), '') is null
      or v_course.class_id is null
      or nullif(btrim(v_course.google_course_name), '') is null
      or not exists (
        select 1 from public.classes where id = v_course.class_id and teacher_id = v_teacher
      )
    then
      raise exception 'Google Classroom course details are invalid';
    end if;

    if exists (
      select 1
      from public.google_classroom_courses
      where google_course_id = v_course.google_course_id
        and (teacher_id <> v_teacher or class_id <> v_course.class_id)
    ) then
      raise exception 'Google Classroom course mapping changed';
    end if;

    insert into public.google_classroom_courses (
      google_course_id,
      class_id,
      teacher_id,
      google_course_name,
      google_course_section,
      google_course_state,
      last_synced_at
    )
    values (
      v_course.google_course_id,
      v_course.class_id,
      v_teacher,
      v_course.google_course_name,
      v_course.google_course_section,
      v_course.google_course_state,
      coalesce(v_course.last_synced_at, now())
    )
    on conflict (google_course_id) do update set
      google_course_name = excluded.google_course_name,
      google_course_section = excluded.google_course_section,
      google_course_state = excluded.google_course_state,
      last_synced_at = excluded.last_synced_at;
  end loop;

  for v_student in
    select * from jsonb_to_recordset(p_students) as item(
      google_user_id text,
      student_id uuid,
      normalized_email text,
      google_full_name text,
      google_photo_url text,
      last_seen_at timestamptz,
      update_profile_name boolean,
      must_change_password boolean
    )
  loop
    if nullif(btrim(v_student.google_user_id), '') is null
      or v_student.student_id is null
      or not exists (
        select 1 from public.profiles where id = v_student.student_id and role = 'student'
      )
    then
      raise exception 'Google Classroom student details are invalid';
    end if;

    if exists (
      select 1
      from public.google_classroom_students
      where google_user_id = v_student.google_user_id
        and student_id <> v_student.student_id
    ) or exists (
      select 1
      from public.google_classroom_students
      where student_id = v_student.student_id
        and google_user_id <> v_student.google_user_id
    ) then
      raise exception 'Google Classroom student mapping changed';
    end if;

    update public.profiles
    set
      full_name = case
        when coalesce(v_student.update_profile_name, false)
          and nullif(btrim(v_student.google_full_name), '') is not null
        then btrim(v_student.google_full_name)
        else full_name
      end,
      must_change_password = case
        when coalesce(v_student.must_change_password, false) then true
        else must_change_password
      end
    where id = v_student.student_id and role = 'student';

    insert into public.google_classroom_students (
      google_user_id,
      student_id,
      normalized_email,
      google_full_name,
      google_photo_url,
      last_seen_at
    )
    values (
      v_student.google_user_id,
      v_student.student_id,
      nullif(btrim(v_student.normalized_email), ''),
      nullif(btrim(v_student.google_full_name), ''),
      nullif(btrim(v_student.google_photo_url), ''),
      coalesce(v_student.last_seen_at, now())
    )
    on conflict (google_user_id) do update set
      normalized_email = excluded.normalized_email,
      google_full_name = excluded.google_full_name,
      google_photo_url = excluded.google_photo_url,
      last_seen_at = excluded.last_seen_at;
  end loop;

  for v_membership in
    select * from jsonb_to_recordset(p_memberships) as item(class_id uuid, student_id uuid)
  loop
    if v_membership.class_id is null
      or v_membership.student_id is null
      or not exists (
        select 1 from public.classes where id = v_membership.class_id and teacher_id = v_teacher
      )
      or not exists (
        select 1 from public.profiles where id = v_membership.student_id and role = 'student'
      )
    then
      raise exception 'Google Classroom membership is invalid';
    end if;

    insert into public.class_members (class_id, student_id)
    values (v_membership.class_id, v_membership.student_id)
    on conflict (class_id, student_id) do nothing;
  end loop;

  for v_removal in
    select * from jsonb_to_recordset(p_removals) as item(class_id uuid, student_id uuid)
  loop
    if v_removal.class_id is null
      or v_removal.student_id is null
      or not exists (
        select 1 from public.classes where id = v_removal.class_id and teacher_id = v_teacher
      )
    then
      raise exception 'Google Classroom membership removal is invalid';
    end if;

    delete from public.class_members
    where class_id = v_removal.class_id and student_id = v_removal.student_id;
  end loop;
end;
$$;

revoke all on function public.apply_google_classroom_sync(jsonb, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.apply_google_classroom_sync(jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
