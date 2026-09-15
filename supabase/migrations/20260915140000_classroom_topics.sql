-- Replace weekly class-manager buckets with teacher-defined topics while keeping
-- the proven classroom_weeks foreign-key structure for offline sync compatibility.
-- Every historical record is consolidated into Topic 1 without losing events,
-- statuses, notes, grades, or assignment links.

update public.classroom_weeks
set sort_order = sort_order + 1000000;

insert into public.classroom_weeks (class_id, label, sort_order, title, focus, created_by)
select classroom.id, 'T1', 1, 'Topic 1', 'Algebra Foundations', classroom.teacher_id
from public.classes classroom
where classroom.teacher_id is not null
on conflict (class_id, label) do update set
  sort_order = excluded.sort_order,
  title = excluded.title,
  focus = excluded.focus;

create temporary table classroom_topic_one on commit drop as
select class_id, id as topic_id
from public.classroom_weeks
where label = 'T1';

-- Offline browser queues identify old work columns by week label, kind, and
-- position. Keep a small server-side map so those queued edits can still be
-- replayed safely after all records move into Topic 1.
create table public.classroom_topic_legacy_work_map (
  class_id uuid not null references public.classes(id) on delete cascade,
  legacy_week_label text not null,
  kind text not null check (kind in ('homework', 'classwork')),
  legacy_position integer not null check (legacy_position > 0),
  work_item_id uuid not null references public.classroom_work_items(id) on delete cascade,
  primary key (class_id, legacy_week_label, kind, legacy_position),
  unique (work_item_id)
);

revoke all on table public.classroom_topic_legacy_work_map from anon, authenticated, public;

insert into public.classroom_topic_legacy_work_map
  (class_id, legacy_week_label, kind, legacy_position, work_item_id)
select work_item.class_id, classroom_week.label, work_item.kind, work_item.position, work_item.id
from public.classroom_work_items work_item
join public.classroom_weeks classroom_week on classroom_week.id = work_item.week_id
where classroom_week.label <> 'T1'
on conflict (class_id, legacy_week_label, kind, legacy_position) do update
set work_item_id = excluded.work_item_id;

create temporary table classroom_topic_work_positions on commit drop as
select work_item.id,
  row_number() over (
    partition by work_item.class_id, work_item.kind
    order by work_item.activity_date nulls last, work_item.created_at, work_item.id
  )::integer as position
from public.classroom_work_items work_item;

alter table public.classroom_work_items
drop constraint if exists classroom_work_items_class_id_week_id_kind_position_key;

update public.classroom_star_events event
set week_id = topic.topic_id
from classroom_topic_one topic
where topic.class_id = event.class_id;

update public.classroom_work_items work_item
set week_id = topic.topic_id,
    position = positions.position
from classroom_topic_one topic,
     classroom_topic_work_positions positions
where topic.class_id = work_item.class_id
  and positions.id = work_item.id;

alter table public.classroom_work_items
add constraint classroom_work_items_class_id_week_id_kind_position_key
unique (class_id, week_id, kind, position);

update public.classroom_grade_columns grade_column
set week_id = topic.topic_id
from classroom_topic_one topic
where topic.class_id = grade_column.class_id;

update public.classroom_cw_records record
set week_id = topic.topic_id
from classroom_topic_one topic
where topic.class_id = record.class_id;

delete from public.classroom_weeks
where label <> 'T1';

comment on table public.classroom_weeks is
'Topic buckets used by the class manager. The legacy table name is retained for API and offline-sync compatibility.';

comment on column public.classroom_weeks.label is
'Stable topic key such as T1, T2, or T3.';

comment on table public.classroom_grade_columns is
'Topic-scoped class manager grade columns backed by an automatic assessment or teacher-entered scores.';

create or replace function public.seed_classroom_weeks()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.teacher_id is not null then
    insert into public.classroom_weeks (class_id, label, sort_order, title, focus, created_by)
    values (new.id, 'T1', 1, 'Topic 1', 'Algebra Foundations', new.teacher_id)
    on conflict (class_id, label) do update set
      sort_order = excluded.sort_order,
      title = excluded.title,
      focus = excluded.focus;
  end if;
  return new;
end;
$$;

create or replace function public.default_classroom_grade_week(p_class_id uuid, p_assessment_date date)
returns uuid
language sql
stable
set search_path = ''
as $$
  select classroom_topic.id
  from public.classroom_weeks classroom_topic
  where classroom_topic.class_id = p_class_id
  order by classroom_topic.sort_order desc
  limit 1;
$$;

create or replace function public.create_classroom_work_items(
  p_class_ids uuid[],
  p_week_label text,
  p_kind text,
  p_title text,
  p_activity_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher uuid := auth.uid();
  v_class_id uuid;
  v_week_id uuid;
  v_work_item_id uuid;
  v_position integer;
  v_result jsonb := '[]'::jsonb;
begin
  if v_teacher is null then raise exception 'A teacher session is required'; end if;
  if coalesce(cardinality(p_class_ids), 0) = 0 then raise exception 'Choose at least one class'; end if;
  if p_kind not in ('homework', 'classwork') then raise exception 'Work item kind is invalid'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120 then raise exception 'Work item title is required'; end if;
  if btrim(coalesce(p_week_label, '')) !~ '^T[1-9][0-9]*$' then raise exception 'Topic is invalid'; end if;
  if exists (
    select 1
    from unnest(p_class_ids) as requested(class_id)
    left join public.classes classroom on classroom.id = requested.class_id and classroom.teacher_id = v_teacher
    where classroom.id is null
  ) then raise exception 'One or more classes are not available to this teacher'; end if;

  for v_class_id in select distinct requested.class_id from unnest(p_class_ids) as requested(class_id)
  loop
    select id into v_week_id
    from public.classroom_weeks
    where class_id = v_class_id and label = p_week_label;
    if v_week_id is null then raise exception 'Topic is not available for this class'; end if;

    select coalesce(max(position), 0) + 1 into v_position
    from public.classroom_work_items
    where class_id = v_class_id and week_id = v_week_id and kind = p_kind;

    v_work_item_id := gen_random_uuid();
    insert into public.classroom_work_items (id, class_id, week_id, kind, position, title, activity_date, created_by)
    values (v_work_item_id, v_class_id, v_week_id, p_kind, v_position, btrim(p_title), coalesce(p_activity_date, current_date), v_teacher);

    insert into public.classroom_work_statuses (work_item_id, student_id, status, updated_by)
    select v_work_item_id, member.student_id, 'ok', v_teacher
    from public.class_members member
    where member.class_id = v_class_id;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'class_id', v_class_id,
      'work_item_id', v_work_item_id,
      'position', v_position
    ));
  end loop;

  return jsonb_build_object('status', 'created', 'items', v_result, 'class_count', jsonb_array_length(v_result));
end;
$$;

revoke all on function public.create_classroom_work_items(uuid[], text, text, text, date) from public;
grant execute on function public.create_classroom_work_items(uuid[], text, text, text, date) to authenticated;

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
  v_requested_label text;
  v_position integer;
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
    v_requested_label := upper(btrim(v_week->>'label'));
    if v_requested_label ~ '^T[1-9][0-9]*$' then
      insert into public.classroom_weeks (id, class_id, label, sort_order, title, focus, created_by)
      values (
        coalesce(nullif(v_week->>'id', '')::uuid, gen_random_uuid()), p_class_id, v_requested_label,
        (v_week->>'sort_order')::integer, nullif(btrim(v_week->>'title'), ''), nullif(btrim(v_week->>'focus'), ''), v_teacher
      )
      on conflict (class_id, label) do update set
        sort_order = excluded.sort_order, title = excluded.title, focus = excluded.focus;
    end if;
  end loop;

  for v_event in select value from jsonb_array_elements(p_star_events)
  loop
    v_student_id := (v_event->>'student_id')::uuid;
    if not exists (select 1 from public.class_members where class_id = p_class_id and student_id = v_student_id) then
      raise exception 'Star event student is not enrolled in this class';
    end if;
    v_requested_label := upper(btrim(v_event->>'week_label'));
    if v_requested_label !~ '^T[1-9][0-9]*$' then v_requested_label := 'T1'; end if;
    select id into v_week_id from public.classroom_weeks where class_id = p_class_id and label = v_requested_label;
    if v_week_id is null then raise exception 'Star event topic is not available'; end if;

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
    v_requested_label := upper(btrim(v_item->>'week_label'));

    if v_requested_label !~ '^T[1-9][0-9]*$' then
      select legacy.work_item_id into v_work_item_id
      from public.classroom_topic_legacy_work_map legacy
      where legacy.class_id = p_class_id
        and legacy.legacy_week_label = v_requested_label
        and legacy.kind = v_kind
        and legacy.legacy_position = (v_item->>'position')::integer;

      if v_work_item_id is not null then
        update public.classroom_work_items
        set title = btrim(v_item->>'title'), activity_date = nullif(v_item->>'activity_date', '')::date
        where id = v_work_item_id and class_id = p_class_id;
      else
        select id into v_week_id from public.classroom_weeks where class_id = p_class_id and label = 'T1';
        select coalesce(max(position), 0) + 1 into v_position
        from public.classroom_work_items
        where class_id = p_class_id and week_id = v_week_id and kind = v_kind;

        insert into public.classroom_work_items (id, class_id, week_id, kind, position, title, activity_date, created_by)
        values (
          (v_item->>'id')::uuid, p_class_id, v_week_id, v_kind, v_position,
          btrim(v_item->>'title'), nullif(v_item->>'activity_date', '')::date, v_teacher
        )
        on conflict (id) do update set title = excluded.title, activity_date = excluded.activity_date
        returning id into v_work_item_id;

        insert into public.classroom_topic_legacy_work_map
          (class_id, legacy_week_label, kind, legacy_position, work_item_id)
        values (p_class_id, v_requested_label, v_kind, (v_item->>'position')::integer, v_work_item_id)
        on conflict (class_id, legacy_week_label, kind, legacy_position) do update
        set work_item_id = excluded.work_item_id;
      end if;
    else
      select id into v_week_id from public.classroom_weeks where class_id = p_class_id and label = v_requested_label;
      if v_week_id is null then raise exception 'Work item topic is not available'; end if;
      insert into public.classroom_work_items (id, class_id, week_id, kind, position, title, activity_date, created_by)
      values (
        (v_item->>'id')::uuid, p_class_id, v_week_id, v_kind, (v_item->>'position')::integer,
        btrim(v_item->>'title'), nullif(v_item->>'activity_date', '')::date, v_teacher
      )
      on conflict (class_id, week_id, kind, position) do update set
        title = excluded.title, activity_date = excluded.activity_date;
    end if;
  end loop;

  for v_status in select value from jsonb_array_elements(p_work_statuses)
  loop
    v_student_id := (v_status->>'student_id')::uuid;
    if not exists (select 1 from public.class_members where class_id = p_class_id and student_id = v_student_id) then
      raise exception 'Work status student is not enrolled in this class';
    end if;
    v_kind := v_status->>'kind';
    v_requested_label := upper(btrim(v_status->>'week_label'));

    if v_requested_label !~ '^T[1-9][0-9]*$' then
      select legacy.work_item_id into v_work_item_id
      from public.classroom_topic_legacy_work_map legacy
      where legacy.class_id = p_class_id
        and legacy.legacy_week_label = v_requested_label
        and legacy.kind = v_kind
        and legacy.legacy_position = (v_status->>'position')::integer;
    else
      select classroom_work_items.id into v_work_item_id
      from public.classroom_work_items classroom_work_items
      join public.classroom_weeks classroom_topic on classroom_topic.id = classroom_work_items.week_id
      where classroom_work_items.class_id = p_class_id
        and classroom_topic.label = v_requested_label
        and classroom_work_items.kind = v_kind
        and classroom_work_items.position = (v_status->>'position')::integer;
    end if;

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

revoke all on function public.apply_classroom_star_sync(uuid, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.apply_classroom_star_sync(uuid, jsonb, jsonb, jsonb, jsonb) to authenticated;
