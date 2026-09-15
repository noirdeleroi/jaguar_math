-- Keep every classroom skull as an append-only event so teachers can see both
-- the active count for today and the student's lifetime accumulated total.
create table public.classroom_skull_events (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (action in ('add', 'clear_today')),
  source text not null default 'classroom' check (source in ('classroom', 'offline_queue')),
  occurred_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete cascade
);

create index classroom_skull_events_class_student_time_idx
on public.classroom_skull_events (class_id, student_id, occurred_at desc);

alter table public.classroom_skull_events enable row level security;
revoke all on table public.classroom_skull_events from anon, public;
grant select on table public.classroom_skull_events to authenticated;

create policy "classroom skull events: teachers read owned classes"
on public.classroom_skull_events
for select to authenticated
using (exists (
  select 1 from public.classes
  where classes.id = classroom_skull_events.class_id
    and classes.teacher_id = auth.uid()
));

create function public.apply_classroom_skull_sync(
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
    if v_action not in ('add', 'clear_today') then raise exception 'Skull event action is invalid'; end if;
    if not exists (
      select 1 from public.class_members
      where class_id = p_class_id and student_id = v_student_id
    ) then
      raise exception 'Skull event student is not enrolled in this class';
    end if;

    insert into public.classroom_skull_events
      (id, class_id, student_id, action, source, occurred_at, created_by)
    values (
      (v_event->>'id')::uuid,
      p_class_id,
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

create function public.get_classroom_skull_totals(p_class_id uuid)
returns table (student_id uuid, skulls_today bigint, skulls_total bigint)
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
    select event.student_id, event.action, event.occurred_at,
      (event.occurred_at at time zone 'America/Bogota')::date as local_date
    from public.classroom_skull_events event
    where event.class_id = p_class_id
  ), latest_clear as (
    select event.student_id, max(event.occurred_at) as cleared_at
    from event_rows event
    where event.action = 'clear_today' and event.local_date = v_today
    group by event.student_id
  )
  select member.student_id,
    count(event.student_id) filter (
      where event.action = 'add'
        and event.local_date = v_today
        and (clear_event.cleared_at is null or event.occurred_at > clear_event.cleared_at)
    ) as skulls_today,
    count(event.student_id) filter (where event.action = 'add') as skulls_total
  from public.class_members member
  left join event_rows event on event.student_id = member.student_id
  left join latest_clear clear_event on clear_event.student_id = member.student_id
  where member.class_id = p_class_id
  group by member.student_id, clear_event.cleared_at;
end;
$$;

revoke all on function public.apply_classroom_skull_sync(uuid, jsonb) from public, anon;
revoke all on function public.get_classroom_skull_totals(uuid) from public, anon;
grant execute on function public.apply_classroom_skull_sync(uuid, jsonb) to authenticated;
grant execute on function public.get_classroom_skull_totals(uuid) to authenticated;
