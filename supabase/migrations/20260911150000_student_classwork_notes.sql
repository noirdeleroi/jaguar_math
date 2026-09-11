create table public.classroom_cw_records (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  week_id uuid not null references public.classroom_weeks(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'not_ok' check (status = 'not_ok'),
  record_date date not null default current_date,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now()
);

create index classroom_cw_records_class_week_idx on public.classroom_cw_records (class_id, week_id, student_id, record_date desc);

alter table public.classroom_cw_records enable row level security;
revoke all on table public.classroom_cw_records from anon, public;
grant select, insert, delete on table public.classroom_cw_records to authenticated;

create policy "classroom CW records: teachers read owned classes" on public.classroom_cw_records
for select to authenticated using (exists (
  select 1 from public.classes
  where classes.id = classroom_cw_records.class_id and classes.teacher_id = auth.uid()
));

create policy "classroom CW records: teachers insert owned students and weeks" on public.classroom_cw_records
for insert to authenticated with check (
  created_by = auth.uid()
  and exists (select 1 from public.classes where classes.id = classroom_cw_records.class_id and classes.teacher_id = auth.uid())
  and exists (select 1 from public.class_members where class_members.class_id = classroom_cw_records.class_id and class_members.student_id = classroom_cw_records.student_id)
  and exists (select 1 from public.classroom_weeks where classroom_weeks.id = classroom_cw_records.week_id and classroom_weeks.class_id = classroom_cw_records.class_id)
);

create policy "classroom CW records: teachers delete owned classes" on public.classroom_cw_records
for delete to authenticated using (exists (
  select 1 from public.classes
  where classes.id = classroom_cw_records.class_id and classes.teacher_id = auth.uid()
));
