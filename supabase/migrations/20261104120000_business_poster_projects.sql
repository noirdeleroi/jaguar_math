-- Rubric scores are the single source of truth; gradebook totals are derived on read.
alter table public.classroom_grade_columns drop constraint classroom_grade_columns_source_check;
alter table public.classroom_grade_columns drop constraint classroom_grade_columns_check;
alter table public.classroom_grade_columns add constraint classroom_grade_columns_source_check check (source in ('assessment', 'manual', 'project'));
alter table public.classroom_grade_columns add constraint classroom_grade_columns_check check (
  (source = 'assessment' and assignment_id is not null and max_score is null)
  or (source = 'manual' and assignment_id is null and max_score is not null)
  or (source = 'project' and assignment_id is null and max_score = 100)
);

create table public.classroom_projects (
  work_item_id uuid primary key references public.classroom_work_items(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  column_id uuid not null unique references public.classroom_grade_columns(id) on delete cascade,
  revision integer not null default 0 check (revision >= 0),
  document jsonb not null,
  updated_at timestamptz not null default now()
);
create index classroom_projects_class_idx on public.classroom_projects(class_id);
alter table public.classroom_projects enable row level security;
revoke all on public.classroom_projects from public, anon, authenticated;
grant select on public.classroom_projects to authenticated;
create policy "projects: teachers read owned classes" on public.classroom_projects for select to authenticated
using (exists (select 1 from public.classes c where c.id = classroom_projects.class_id and c.teacher_id = auth.uid()));

create function public.validate_classroom_project_document(p_class_id uuid, p_document jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  v_team jsonb; v_member jsonb; v_scores jsonb; v_score jsonb; v_pair record;
  v_student uuid; v_students uuid[] := '{}'; v_team_ids uuid[] := '{}'; v_team_id uuid;
begin
  if p_document is null or jsonb_typeof(p_document) is distinct from 'object'
    or p_document->'rubricVersion' is distinct from '1'::jsonb
    or jsonb_typeof(p_document->'teams') is distinct from 'array'
    or jsonb_typeof(p_document->'individualScores') is distinct from 'object' then
    raise exception 'Invalid project rubric';
  end if;
  if jsonb_array_length(p_document->'teams') > 50 then raise exception 'Too many teams'; end if;
  for v_team in select value from jsonb_array_elements(p_document->'teams') loop
    if jsonb_typeof(v_team) is distinct from 'object' or jsonb_typeof(v_team->'id') is distinct from 'string'
      or jsonb_typeof(v_team->'name') is distinct from 'string' or char_length(btrim(v_team->>'name')) not between 1 and 80
      or jsonb_typeof(v_team->'scores') is distinct from 'array'
      or jsonb_typeof(v_team->'members') is distinct from 'array' then raise exception 'Invalid team'; end if;
    v_team_id := (v_team->>'id')::uuid;
    if v_team_id = any(v_team_ids) then raise exception 'Duplicate team'; end if;
    v_team_ids := array_append(v_team_ids, v_team_id);
    if jsonb_array_length(v_team->'scores') <> 3 or jsonb_array_length(v_team->'members') > 100 then raise exception 'Invalid team'; end if;
    for v_member in select value from jsonb_array_elements(v_team->'members') loop
      if jsonb_typeof(v_member) is distinct from 'object' or jsonb_typeof(v_member->'label') is distinct from 'string'
        or char_length(v_member->>'label') > 160 or not (v_member ? 'studentId')
        or jsonb_typeof(v_member->'studentId') not in ('string', 'null') then raise exception 'Invalid team member'; end if;
      if v_member->'studentId' <> 'null'::jsonb then
        v_student := (v_member->>'studentId')::uuid;
        if v_student = any(v_students) then raise exception 'Student belongs to more than one team'; end if;
        if not exists (select 1 from public.class_members m where m.class_id = p_class_id and m.student_id = v_student) then
          raise exception 'Student is not enrolled in this class';
        end if;
        v_students := array_append(v_students, v_student);
      end if;
    end loop;
    for v_score in select value from jsonb_array_elements(v_team->'scores') loop
      if v_score <> 'null'::jsonb then
        if jsonb_typeof(v_score) <> 'number' then raise exception 'Scores must be numbers or blank'; end if;
        if (v_score::text)::numeric not between 0 and 20 then raise exception 'Score must be between 0 and 20'; end if;
      end if;
    end loop;
  end loop;
  for v_pair in select * from jsonb_each(p_document->'individualScores') loop
    if not (v_pair.key::uuid = any(v_students)) then raise exception 'Individual score student is not assigned to a team'; end if;
    v_scores := v_pair.value;
    if jsonb_typeof(v_scores) is distinct from 'array' then raise exception 'Invalid individual scores'; end if;
    if jsonb_array_length(v_scores) <> 2 then raise exception 'Invalid individual scores'; end if;
    for v_score in select value from jsonb_array_elements(v_scores) loop
      if v_score <> 'null'::jsonb then
        if jsonb_typeof(v_score) <> 'number' then raise exception 'Scores must be numbers or blank'; end if;
        if (v_score::text)::numeric not between 0 and 20 then raise exception 'Score must be between 0 and 20'; end if;
      end if;
    end loop;
  end loop;
end;
$$;
revoke all on function public.validate_classroom_project_document(uuid, jsonb) from public, anon, authenticated;

create function public.create_business_poster_project(p_class_id uuid, p_week_label text, p_activity_date date, p_document jsonb)
returns public.classroom_projects language plpgsql security definer set search_path = '' as $$
declare
  v_teacher uuid := auth.uid(); v_week uuid; v_work uuid := gen_random_uuid(); v_column uuid := gen_random_uuid();
  v_position integer; v_result public.classroom_projects;
begin
  if not public.is_teacher() or not exists (select 1 from public.classes c where c.id = p_class_id and c.teacher_id = v_teacher) then
    raise exception 'Class is not available' using errcode = '42501';
  end if;
  -- Serialize with other creators targeting this topic.
  select id into v_week from public.classroom_weeks where class_id = p_class_id and label = p_week_label for update;
  if v_week is null then raise exception 'Topic does not belong to this class'; end if;
  perform public.validate_classroom_project_document(p_class_id, p_document);
  select coalesce(max(position), 0) + 1 into v_position from public.classroom_work_items where week_id = v_week and class_id = p_class_id and kind = 'classwork';
  insert into public.classroom_work_items(id, class_id, week_id, kind, position, title, activity_date, created_by)
    values(v_work, p_class_id, v_week, 'classwork', v_position, 'Business Poster Project', coalesce(p_activity_date, current_date), v_teacher);
  insert into public.classroom_grade_columns(id, class_id, week_id, title, assessment_date, source, max_score, created_by)
    values(v_column, p_class_id, v_week, 'Business Poster Project', coalesce(p_activity_date, current_date), 'project', 100, v_teacher);
  insert into public.classroom_projects(work_item_id, class_id, column_id, document)
    values(v_work, p_class_id, v_column, p_document) returning * into v_result;
  return v_result;
end;
$$;

create function public.save_business_poster_project(p_class_id uuid, p_work_item_id uuid, p_revision integer, p_document jsonb)
returns public.classroom_projects language plpgsql security definer set search_path = '' as $$
declare v_project public.classroom_projects;
begin
  if not public.is_teacher() or not exists (select 1 from public.classes c where c.id = p_class_id and c.teacher_id = auth.uid()) then
    raise exception 'Class is not available' using errcode = '42501';
  end if;
  select * into v_project from public.classroom_projects where work_item_id = p_work_item_id and class_id = p_class_id for update;
  if not found then raise exception 'Project is not available' using errcode = 'P0002'; end if;
  if p_revision is null or p_revision <> v_project.revision then
    raise exception 'This project has changed in another session. Reload the saved project before saving again.' using errcode = '40001';
  end if;
  perform public.validate_classroom_project_document(p_class_id, p_document);
  update public.classroom_projects set document = p_document, revision = revision + 1, updated_at = now()
    where work_item_id = p_work_item_id returning * into v_project;
  return v_project;
end;
$$;
revoke all on function public.create_business_poster_project(uuid, text, date, jsonb), public.save_business_poster_project(uuid, uuid, integer, jsonb) from public, anon;
grant execute on function public.create_business_poster_project(uuid, text, date, jsonb), public.save_business_poster_project(uuid, uuid, integer, jsonb) to authenticated;
