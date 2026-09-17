create table public.class_notes (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint class_notes_body_valid check (
    body = btrim(body)
    and char_length(body) between 1 and 280
  )
);

create index class_notes_class_created_at_idx
on public.class_notes (class_id, created_at desc);

alter table public.class_notes enable row level security;

revoke all on table public.class_notes from anon, public;
grant select, insert, delete on table public.class_notes to authenticated;

create policy "class notes: teachers read own classes"
on public.class_notes
for select
to authenticated
using (
  exists (
    select 1
    from public.classes
    where classes.id = class_notes.class_id
      and classes.teacher_id = auth.uid()
  )
);

create policy "class notes: teachers add to own classes"
on public.class_notes
for insert
to authenticated
with check (
  exists (
    select 1
    from public.classes
    where classes.id = class_notes.class_id
      and classes.teacher_id = auth.uid()
  )
);

create policy "class notes: teachers delete from own classes"
on public.class_notes
for delete
to authenticated
using (
  exists (
    select 1
    from public.classes
    where classes.id = class_notes.class_id
      and classes.teacher_id = auth.uid()
  )
);
