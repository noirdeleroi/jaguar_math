create table public.classroom_weeks (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 30),
  sort_order integer not null check (sort_order > 0),
  title text,
  focus text,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_id, label),
  unique (class_id, sort_order)
);

create table public.classroom_star_imports (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  file_name text not null,
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  report jsonb not null default '{}'::jsonb,
  imported_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  imported_at timestamptz not null default now(),
  unique (class_id, file_sha256)
);

create table public.classroom_star_events (
  id uuid primary key,
  class_id uuid not null references public.classes(id) on delete cascade,
  week_id uuid not null references public.classroom_weeks(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete restrict,
  delta integer not null check (delta <> 0 and delta between -100000 and 100000),
  note text check (note is null or char_length(note) <= 240),
  source text not null default 'classroom' check (source in ('classroom', 'offline_queue', 'excel_import')),
  import_id uuid references public.classroom_star_imports(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index classroom_star_events_class_week_idx on public.classroom_star_events (class_id, week_id);
create index classroom_star_events_student_idx on public.classroom_star_events (student_id, occurred_at desc);

create table public.classroom_work_items (
  id uuid primary key,
  class_id uuid not null references public.classes(id) on delete cascade,
  week_id uuid not null references public.classroom_weeks(id) on delete cascade,
  kind text not null check (kind in ('homework', 'classwork')),
  position integer not null check (position > 0),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  activity_date date,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_id, week_id, kind, position)
);
create index classroom_work_items_class_week_idx on public.classroom_work_items (class_id, week_id, kind, position);

create table public.classroom_work_statuses (
  work_item_id uuid not null references public.classroom_work_items(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete restrict,
  status text not null check (status in ('done', 'late', 'missing', 'ok', 'not_ok')),
  updated_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (work_item_id, student_id)
);
create index classroom_work_statuses_student_idx on public.classroom_work_statuses (student_id, updated_at desc);

create or replace function public.seed_classroom_weeks()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.teacher_id is not null then
    insert into public.classroom_weeks (class_id, label, sort_order, created_by)
    select new.id, 'A' || week_number::text, week_number, new.teacher_id
    from generate_series(1, 10) as week_number
    on conflict (class_id, label) do nothing;
  end if;
  return new;
end;
$$;
create trigger classes_seed_classroom_weeks after insert on public.classes for each row execute function public.seed_classroom_weeks();

insert into public.classroom_weeks (class_id, label, sort_order, created_by)
select classes.id, 'A' || week_number::text, week_number, classes.teacher_id
from public.classes
cross join generate_series(1, 10) as week_number
where classes.teacher_id is not null
on conflict (class_id, label) do nothing;

create trigger classroom_weeks_set_updated_at before update on public.classroom_weeks for each row execute function public.set_updated_at();
create trigger classroom_work_items_set_updated_at before update on public.classroom_work_items for each row execute function public.set_updated_at();

create or replace function public.validate_classroom_work_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind text;
begin
  select kind into v_kind from public.classroom_work_items where id = new.work_item_id;
  if v_kind = 'homework' and new.status not in ('done', 'late', 'missing') then
    raise exception 'Homework status must be done, late, or missing';
  end if;
  if v_kind = 'classwork' and new.status not in ('ok', 'not_ok') then
    raise exception 'Classwork status must be ok or not_ok';
  end if;
  return new;
end;
$$;
create trigger classroom_work_statuses_validate before insert or update on public.classroom_work_statuses for each row execute function public.validate_classroom_work_status();

alter table public.classroom_weeks enable row level security;
alter table public.classroom_star_imports enable row level security;
alter table public.classroom_star_events enable row level security;
alter table public.classroom_work_items enable row level security;
alter table public.classroom_work_statuses enable row level security;

revoke all on table public.classroom_weeks, public.classroom_star_imports, public.classroom_star_events, public.classroom_work_items, public.classroom_work_statuses from anon, public;
grant select, insert, update, delete on table public.classroom_weeks, public.classroom_work_items, public.classroom_work_statuses to authenticated;
grant select, insert on table public.classroom_star_events to authenticated;
grant select on table public.classroom_star_imports to authenticated;

create policy "classroom weeks: teachers read owned classes" on public.classroom_weeks
for select to authenticated using (exists (select 1 from public.classes where classes.id = classroom_weeks.class_id and classes.teacher_id = auth.uid()));
create policy "classroom weeks: teachers insert owned classes" on public.classroom_weeks
for insert to authenticated with check (created_by = auth.uid() and exists (select 1 from public.classes where classes.id = classroom_weeks.class_id and classes.teacher_id = auth.uid()));
create policy "classroom weeks: teachers update owned classes" on public.classroom_weeks
for update to authenticated using (exists (select 1 from public.classes where classes.id = classroom_weeks.class_id and classes.teacher_id = auth.uid()))
with check (created_by = auth.uid() and exists (select 1 from public.classes where classes.id = classroom_weeks.class_id and classes.teacher_id = auth.uid()));
create policy "classroom weeks: teachers delete owned classes" on public.classroom_weeks
for delete to authenticated using (exists (select 1 from public.classes where classes.id = classroom_weeks.class_id and classes.teacher_id = auth.uid()));

create policy "classroom imports: teachers read owned classes" on public.classroom_star_imports
for select to authenticated using (exists (select 1 from public.classes where classes.id = classroom_star_imports.class_id and classes.teacher_id = auth.uid()));

create policy "classroom star events: teachers read owned classes" on public.classroom_star_events
for select to authenticated using (exists (select 1 from public.classes where classes.id = classroom_star_events.class_id and classes.teacher_id = auth.uid()));
create policy "classroom star events: teachers append owned classes" on public.classroom_star_events
for insert to authenticated with check (
  created_by = auth.uid()
  and exists (select 1 from public.classes where classes.id = classroom_star_events.class_id and classes.teacher_id = auth.uid())
  and exists (select 1 from public.class_members where class_members.class_id = classroom_star_events.class_id and class_members.student_id = classroom_star_events.student_id)
  and exists (select 1 from public.classroom_weeks where classroom_weeks.id = classroom_star_events.week_id and classroom_weeks.class_id = classroom_star_events.class_id)
);

create policy "classroom work items: teachers read owned classes" on public.classroom_work_items
for select to authenticated using (exists (select 1 from public.classes where classes.id = classroom_work_items.class_id and classes.teacher_id = auth.uid()));
create policy "classroom work items: teachers insert owned classes" on public.classroom_work_items
for insert to authenticated with check (
  created_by = auth.uid()
  and exists (select 1 from public.classes where classes.id = classroom_work_items.class_id and classes.teacher_id = auth.uid())
  and exists (select 1 from public.classroom_weeks where classroom_weeks.id = classroom_work_items.week_id and classroom_weeks.class_id = classroom_work_items.class_id)
);
create policy "classroom work items: teachers update owned classes" on public.classroom_work_items
for update to authenticated using (exists (select 1 from public.classes where classes.id = classroom_work_items.class_id and classes.teacher_id = auth.uid()))
with check (
  created_by = auth.uid()
  and exists (select 1 from public.classes where classes.id = classroom_work_items.class_id and classes.teacher_id = auth.uid())
  and exists (select 1 from public.classroom_weeks where classroom_weeks.id = classroom_work_items.week_id and classroom_weeks.class_id = classroom_work_items.class_id)
);
create policy "classroom work items: teachers delete owned classes" on public.classroom_work_items
for delete to authenticated using (exists (select 1 from public.classes where classes.id = classroom_work_items.class_id and classes.teacher_id = auth.uid()));

create policy "classroom work statuses: teachers read owned classes" on public.classroom_work_statuses
for select to authenticated using (exists (
  select 1 from public.classroom_work_items
  join public.classes on classes.id = classroom_work_items.class_id
  where classroom_work_items.id = classroom_work_statuses.work_item_id and classes.teacher_id = auth.uid()
));
create policy "classroom work statuses: teachers insert owned classes" on public.classroom_work_statuses
for insert to authenticated with check (
  updated_by = auth.uid()
  and exists (
    select 1 from public.classroom_work_items
    join public.classes on classes.id = classroom_work_items.class_id
    join public.class_members on class_members.class_id = classes.id and class_members.student_id = classroom_work_statuses.student_id
    where classroom_work_items.id = classroom_work_statuses.work_item_id and classes.teacher_id = auth.uid()
  )
);
create policy "classroom work statuses: teachers update owned classes" on public.classroom_work_statuses
for update to authenticated using (exists (
  select 1 from public.classroom_work_items
  join public.classes on classes.id = classroom_work_items.class_id
  where classroom_work_items.id = classroom_work_statuses.work_item_id and classes.teacher_id = auth.uid()
)) with check (
  updated_by = auth.uid()
  and exists (
    select 1 from public.classroom_work_items
    join public.classes on classes.id = classroom_work_items.class_id
    join public.class_members on class_members.class_id = classes.id and class_members.student_id = classroom_work_statuses.student_id
    where classroom_work_items.id = classroom_work_statuses.work_item_id and classes.teacher_id = auth.uid()
  )
);
create policy "classroom work statuses: teachers delete owned classes" on public.classroom_work_statuses
for delete to authenticated using (exists (
  select 1 from public.classroom_work_items
  join public.classes on classes.id = classroom_work_items.class_id
  where classroom_work_items.id = classroom_work_statuses.work_item_id and classes.teacher_id = auth.uid()
));

create or replace function public.apply_classroom_star_sync(
  p_class_id uuid,
  p_weeks jsonb default '[]'::jsonb,
  p_star_events jsonb default '[]'::jsonb,
  p_work_items jsonb default '[]'::jsonb,
  p_work_statuses jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher uuid := auth.uid();
  v_week jsonb;
  v_event jsonb;
  v_item jsonb;
  v_status jsonb;
  v_week_id uuid;
  v_work_item_id uuid;
  v_student_id uuid;
  v_kind text;
  v_status_value text;
  v_count integer := 0;
begin
  if v_teacher is null or not exists (select 1 from public.classes where id = p_class_id and teacher_id = v_teacher) then
    raise exception 'Class is not available to this teacher';
  end if;
  if jsonb_typeof(p_weeks) <> 'array' or jsonb_typeof(p_star_events) <> 'array' or jsonb_typeof(p_work_items) <> 'array' or jsonb_typeof(p_work_statuses) <> 'array' then
    raise exception 'Classroom sync payload must contain arrays';
  end if;

  for v_week in select value from jsonb_array_elements(p_weeks)
  loop
    insert into public.classroom_weeks (id, class_id, label, sort_order, title, focus, created_by)
    values (
      coalesce(nullif(v_week->>'id', '')::uuid, gen_random_uuid()), p_class_id, btrim(v_week->>'label'),
      (v_week->>'sort_order')::integer, nullif(btrim(v_week->>'title'), ''), nullif(btrim(v_week->>'focus'), ''), v_teacher
    )
    on conflict (class_id, label) do update set
      sort_order = excluded.sort_order, title = excluded.title, focus = excluded.focus;
  end loop;

  for v_event in select value from jsonb_array_elements(p_star_events)
  loop
    v_student_id := (v_event->>'student_id')::uuid;
    if not exists (select 1 from public.class_members where class_id = p_class_id and student_id = v_student_id) then
      raise exception 'Star event student is not enrolled in this class';
    end if;
    select id into v_week_id from public.classroom_weeks where class_id = p_class_id and label = v_event->>'week_label';
    if v_week_id is null then raise exception 'Star event week is not available'; end if;

    insert into public.classroom_star_events (id, class_id, week_id, student_id, delta, note, source, created_by, occurred_at)
    values (
      (v_event->>'id')::uuid, p_class_id, v_week_id, v_student_id, (v_event->>'delta')::integer,
      nullif(btrim(v_event->>'note'), ''),
      case when v_event->>'source' in ('classroom', 'offline_queue') then v_event->>'source' else 'classroom' end,
      v_teacher, coalesce(nullif(v_event->>'occurred_at', '')::timestamptz, now())
    )
    on conflict (id) do nothing;
    v_count := v_count + 1;
  end loop;

  if exists (
    select 1 from public.classroom_star_events
    where class_id = p_class_id
    group by week_id, student_id
    having sum(delta) < 0
  ) then
    raise exception 'A student star total cannot be negative';
  end if;

  for v_item in select value from jsonb_array_elements(p_work_items)
  loop
    v_kind := v_item->>'kind';
    if v_kind not in ('homework', 'classwork') then raise exception 'Work item kind is invalid'; end if;
    select id into v_week_id from public.classroom_weeks where class_id = p_class_id and label = v_item->>'week_label';
    if v_week_id is null then raise exception 'Work item week is not available'; end if;
    insert into public.classroom_work_items (id, class_id, week_id, kind, position, title, activity_date, created_by)
    values (
      (v_item->>'id')::uuid, p_class_id, v_week_id, v_kind, (v_item->>'position')::integer,
      btrim(v_item->>'title'), nullif(v_item->>'activity_date', '')::date, v_teacher
    )
    on conflict (class_id, week_id, kind, position) do update set
      title = excluded.title, activity_date = excluded.activity_date;
  end loop;

  for v_status in select value from jsonb_array_elements(p_work_statuses)
  loop
    v_student_id := (v_status->>'student_id')::uuid;
    if not exists (select 1 from public.class_members where class_id = p_class_id and student_id = v_student_id) then
      raise exception 'Work status student is not enrolled in this class';
    end if;
    v_kind := v_status->>'kind';
    select classroom_work_items.id into v_work_item_id
    from public.classroom_work_items classroom_work_items
    join public.classroom_weeks classroom_weeks on classroom_weeks.id = classroom_work_items.week_id
    where classroom_work_items.class_id = p_class_id
      and classroom_weeks.label = v_status->>'week_label'
      and classroom_work_items.kind = v_kind
      and classroom_work_items.position = (v_status->>'position')::integer;
    if v_work_item_id is null then raise exception 'Work status item is not available'; end if;
    v_status_value := nullif(v_status->>'status', '');
    if v_status_value is null then
      delete from public.classroom_work_statuses where work_item_id = v_work_item_id and student_id = v_student_id;
    else
      insert into public.classroom_work_statuses (work_item_id, student_id, status, updated_by)
      values (v_work_item_id, v_student_id, v_status_value, v_teacher)
      on conflict (work_item_id, student_id) do update set status = excluded.status, updated_by = excluded.updated_by, updated_at = now();
    end if;
  end loop;

  return jsonb_build_object('status', 'saved', 'accepted_star_events', v_count);
end;
$$;

create or replace function public.import_classroom_star_workbook(
  p_class_id uuid,
  p_file_name text,
  p_file_sha256 text,
  p_weeks jsonb,
  p_star_totals jsonb,
  p_work_items jsonb,
  p_work_statuses jsonb,
  p_report jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher uuid := auth.uid();
  v_import_id uuid;
  v_week jsonb;
  v_star jsonb;
  v_item jsonb;
  v_status jsonb;
  v_week_id uuid;
  v_work_item_id uuid;
  v_student_id uuid;
  v_existing_total integer;
  v_target_total integer;
  v_delta integer;
  v_kind text;
begin
  if v_teacher is null or not exists (select 1 from public.classes where id = p_class_id and teacher_id = v_teacher) then
    raise exception 'Class is not available to this teacher';
  end if;
  if p_file_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Workbook fingerprint is invalid'; end if;

  insert into public.classroom_star_imports (class_id, file_name, file_sha256, report, imported_by)
  values (p_class_id, left(p_file_name, 240), p_file_sha256, coalesce(p_report, '{}'::jsonb), v_teacher)
  on conflict (class_id, file_sha256) do nothing
  returning id into v_import_id;
  if v_import_id is null then return jsonb_build_object('status', 'already_imported'); end if;

  for v_week in select value from jsonb_array_elements(p_weeks)
  loop
    insert into public.classroom_weeks (class_id, label, sort_order, title, focus, created_by)
    values (p_class_id, btrim(v_week->>'label'), (v_week->>'sort_order')::integer, nullif(btrim(v_week->>'title'), ''), nullif(btrim(v_week->>'focus'), ''), v_teacher)
    on conflict (class_id, label) do update set title = coalesce(excluded.title, classroom_weeks.title), focus = coalesce(excluded.focus, classroom_weeks.focus);
  end loop;

  for v_star in select value from jsonb_array_elements(p_star_totals)
  loop
    v_student_id := (v_star->>'student_id')::uuid;
    if not exists (select 1 from public.class_members where class_id = p_class_id and student_id = v_student_id) then raise exception 'Import student is not enrolled in this class'; end if;
    select id into v_week_id from public.classroom_weeks where class_id = p_class_id and label = v_star->>'week_label';
    if v_week_id is null then raise exception 'Import week is not available'; end if;
    select coalesce(sum(delta), 0)::integer into v_existing_total from public.classroom_star_events where class_id = p_class_id and week_id = v_week_id and student_id = v_student_id;
    v_target_total := greatest(0, (v_star->>'total')::integer);
    v_delta := v_target_total - v_existing_total;
    if v_delta <> 0 then
      insert into public.classroom_star_events (id, class_id, week_id, student_id, delta, note, source, import_id, created_by)
      values (gen_random_uuid(), p_class_id, v_week_id, v_student_id, v_delta, 'Excel snapshot import: ' || left(p_file_name, 180), 'excel_import', v_import_id, v_teacher);
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_work_items)
  loop
    v_kind := v_item->>'kind';
    if v_kind not in ('homework', 'classwork') then raise exception 'Import work item kind is invalid'; end if;
    select id into v_week_id from public.classroom_weeks where class_id = p_class_id and label = v_item->>'week_label';
    insert into public.classroom_work_items (id, class_id, week_id, kind, position, title, activity_date, created_by)
    values (gen_random_uuid(), p_class_id, v_week_id, v_kind, (v_item->>'position')::integer, btrim(v_item->>'title'), nullif(v_item->>'activity_date', '')::date, v_teacher)
    on conflict (class_id, week_id, kind, position) do update set title = excluded.title, activity_date = excluded.activity_date;
  end loop;

  for v_status in select value from jsonb_array_elements(p_work_statuses)
  loop
    v_student_id := (v_status->>'student_id')::uuid;
    if not exists (select 1 from public.class_members where class_id = p_class_id and student_id = v_student_id) then raise exception 'Import status student is not enrolled in this class'; end if;
    v_kind := v_status->>'kind';
    select classroom_work_items.id into v_work_item_id
    from public.classroom_work_items classroom_work_items
    join public.classroom_weeks classroom_weeks on classroom_weeks.id = classroom_work_items.week_id
    where classroom_work_items.class_id = p_class_id and classroom_weeks.label = v_status->>'week_label'
      and classroom_work_items.kind = v_kind and classroom_work_items.position = (v_status->>'position')::integer;
    if v_work_item_id is null then raise exception 'Import work status item is not available'; end if;
    if nullif(v_status->>'status', '') is not null then
      insert into public.classroom_work_statuses (work_item_id, student_id, status, updated_by)
      values (v_work_item_id, v_student_id, v_status->>'status', v_teacher)
      on conflict (work_item_id, student_id) do update set status = excluded.status, updated_by = excluded.updated_by, updated_at = now();
    end if;
  end loop;

  return jsonb_build_object('status', 'imported', 'import_id', v_import_id);
end;
$$;

revoke all on function public.validate_classroom_work_status() from public;
revoke all on function public.seed_classroom_weeks() from public;
revoke all on function public.apply_classroom_star_sync(uuid, jsonb, jsonb, jsonb, jsonb) from public;
revoke all on function public.import_classroom_star_workbook(uuid, text, text, jsonb, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.apply_classroom_star_sync(uuid, jsonb, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.import_classroom_star_workbook(uuid, text, text, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
