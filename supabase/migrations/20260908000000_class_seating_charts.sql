create table public.class_seating_charts (
  class_id uuid primary key references public.classes(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  layout jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_seating_charts_layout_object check (jsonb_typeof(layout) = 'object')
);

create trigger class_seating_charts_set_updated_at
before update on public.class_seating_charts
for each row execute function public.set_updated_at();

alter table public.class_seating_charts enable row level security;

revoke all on table public.class_seating_charts from anon, public;
grant select, insert, update, delete on table public.class_seating_charts to authenticated;

create policy "class seating charts: teachers read own"
on public.class_seating_charts for select to authenticated
using (
  teacher_id = auth.uid()
  and exists (
    select 1 from public.classes
    where classes.id = class_seating_charts.class_id
      and classes.teacher_id = auth.uid()
  )
);

create policy "class seating charts: teachers insert own"
on public.class_seating_charts for insert to authenticated
with check (
  teacher_id = auth.uid()
  and exists (
    select 1 from public.classes
    where classes.id = class_seating_charts.class_id
      and classes.teacher_id = auth.uid()
  )
);

create policy "class seating charts: teachers update own"
on public.class_seating_charts for update to authenticated
using (
  teacher_id = auth.uid()
  and exists (
    select 1 from public.classes
    where classes.id = class_seating_charts.class_id
      and classes.teacher_id = auth.uid()
  )
)
with check (
  teacher_id = auth.uid()
  and exists (
    select 1 from public.classes
    where classes.id = class_seating_charts.class_id
      and classes.teacher_id = auth.uid()
  )
);

create policy "class seating charts: teachers delete own"
on public.class_seating_charts for delete to authenticated
using (
  teacher_id = auth.uid()
  and exists (
    select 1 from public.classes
    where classes.id = class_seating_charts.class_id
      and classes.teacher_id = auth.uid()
  )
);
