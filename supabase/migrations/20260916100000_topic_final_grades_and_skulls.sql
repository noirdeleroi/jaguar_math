-- Make rewards and final grades true topic-level records. Existing skull
-- history belongs to Topic 1 because skulls predated teacher-created topics.

alter table public.classroom_weeks
add column final_grade_formula text not null default 'N + stars - skulls',
add column summative_grade_column_id uuid references public.classroom_grade_columns(id) on delete set null,
add constraint classroom_weeks_final_grade_formula_length
  check (char_length(btrim(final_grade_formula)) between 1 and 120);

update public.classroom_weeks topic
set summative_grade_column_id = (
  select grade_column.id
  from public.classroom_grade_columns grade_column
  where grade_column.week_id = topic.id
  order by
    case when lower(grade_column.title) like '%paper%' then 0 else 1 end,
    grade_column.assessment_date desc,
    grade_column.created_at desc
  limit 1
);

update public.classroom_weeks topic
set title = 'Arithmetic Foundations', focus = null
from public.classes classroom
where classroom.id = topic.class_id
  and classroom.grade_level = 12
  and topic.label = 'T1';

create or replace function public.seed_classroom_weeks()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.teacher_id is not null then
    insert into public.classroom_weeks (class_id, label, sort_order, title, focus, created_by)
    values (
      new.id,
      'T1',
      1,
      case when new.grade_level = 12 then 'Arithmetic Foundations' else 'Algebra Foundations' end,
      null,
      new.teacher_id
    )
    on conflict (class_id, label) do update set
      sort_order = excluded.sort_order,
      title = excluded.title,
      focus = excluded.focus;
  end if;
  return new;
end;
$$;

create function public.maintain_topic_summative_grade_column()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.week_id is distinct from new.week_id then
    update public.classroom_weeks
    set summative_grade_column_id = null
    where id = old.week_id and summative_grade_column_id = old.id;
  end if;

  update public.classroom_weeks
  set summative_grade_column_id = new.id
  where id = new.week_id and summative_grade_column_id is null;
  return new;
end;
$$;

create trigger classroom_grade_columns_maintain_topic_summative
after insert or update of week_id on public.classroom_grade_columns
for each row execute function public.maintain_topic_summative_grade_column();

alter table public.classroom_skull_events
add column week_id uuid references public.classroom_weeks(id) on delete cascade;

update public.classroom_skull_events event
set week_id = topic.id
from public.classroom_weeks topic
where topic.class_id = event.class_id and topic.label = 'T1';

alter table public.classroom_skull_events
alter column week_id set not null;

drop index if exists public.classroom_skull_events_class_student_time_idx;
create index classroom_skull_events_class_week_student_time_idx
on public.classroom_skull_events (class_id, week_id, student_id, occurred_at desc);

create or replace function public.apply_classroom_skull_sync(
  p_class_id uuid,
  p_skull_events jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher uuid := auth.uid();
  v_event jsonb;
  v_student_id uuid;
  v_week_id uuid;
  v_week_label text;
  v_action text;
  v_count integer := 0;
begin
  if v_teacher is null or not exists (
    select 1 from public.classes where id = p_class_id and teacher_id = v_teacher
  ) then
    raise exception 'Class is not available to this teacher';
  end if;
  if jsonb_typeof(p_skull_events) <> 'array' or jsonb_array_length(p_skull_events) > 2500 then
    raise exception 'Skull sync payload must be an array with at most 2500 events';
  end if;

  for v_event in select value from jsonb_array_elements(p_skull_events)
  loop
    v_student_id := (v_event->>'student_id')::uuid;
    v_action := v_event->>'action';
    v_week_label := upper(btrim(coalesce(nullif(v_event->>'week_label', ''), 'T1')));
    if v_action not in ('add', 'clear_today') then raise exception 'Skull event action is invalid'; end if;
    if not exists (
      select 1 from public.class_members
      where class_id = p_class_id and student_id = v_student_id
    ) then
      raise exception 'Skull event student is not enrolled in this class';
    end if;
    select id into v_week_id
    from public.classroom_weeks
    where class_id = p_class_id and label = v_week_label;
    if v_week_id is null then raise exception 'Skull event topic is not available'; end if;

    insert into public.classroom_skull_events
      (id, class_id, week_id, student_id, action, source, occurred_at, created_by)
    values (
      (v_event->>'id')::uuid,
      p_class_id,
      v_week_id,
      v_student_id,
      v_action,
      case when v_event->>'source' in ('classroom', 'offline_queue') then v_event->>'source' else 'classroom' end,
      coalesce(nullif(v_event->>'occurred_at', '')::timestamptz, now()),
      v_teacher
    )
    on conflict (id) do nothing;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('status', 'saved', 'events', v_count);
end;
$$;

drop function public.get_classroom_skull_totals(uuid);

create function public.get_classroom_skull_totals(p_class_id uuid)
returns table (student_id uuid, week_label text, skulls_today bigint, skulls_total bigint)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_teacher uuid := auth.uid();
  v_today date := (now() at time zone 'America/Bogota')::date;
begin
  if v_teacher is null or not exists (
    select 1 from public.classes where id = p_class_id and teacher_id = v_teacher
  ) then
    raise exception 'Class is not available to this teacher';
  end if;

  return query
  with event_rows as (
    select event.student_id, event.week_id, event.action, event.occurred_at,
      (event.occurred_at at time zone 'America/Bogota')::date as local_date
    from public.classroom_skull_events event
    where event.class_id = p_class_id
  ), latest_clear as (
    select event.student_id, event.week_id, max(event.occurred_at) as cleared_at
    from event_rows event
    where event.action = 'clear_today' and event.local_date = v_today
    group by event.student_id, event.week_id
  )
  select member.student_id,
    topic.label,
    count(event.student_id) filter (
      where event.action = 'add'
        and event.local_date = v_today
        and (clear_event.cleared_at is null or event.occurred_at > clear_event.cleared_at)
    ) as skulls_today,
    count(event.student_id) filter (where event.action = 'add') as skulls_total
  from public.class_members member
  cross join public.classroom_weeks topic
  left join event_rows event on event.student_id = member.student_id and event.week_id = topic.id
  left join latest_clear clear_event on clear_event.student_id = member.student_id and clear_event.week_id = topic.id
  where member.class_id = p_class_id and topic.class_id = p_class_id
  group by member.student_id, topic.label, topic.sort_order, clear_event.cleared_at
  order by member.student_id, topic.sort_order;
end;
$$;

revoke all on function public.get_classroom_skull_totals(uuid) from public, anon;
grant execute on function public.get_classroom_skull_totals(uuid) to authenticated;

comment on column public.classroom_weeks.final_grade_formula is
'Teacher-editable topic final-grade expression using N, stars, and skulls.';
comment on column public.classroom_weeks.summative_grade_column_id is
'Grade column whose raw points are exposed as N in the topic final-grade formula.';
comment on column public.classroom_skull_events.week_id is
'Topic in which this skull was awarded or today''s topic skull count was cleared.';
