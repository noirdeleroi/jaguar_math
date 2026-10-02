create table public.classroom_topic_classwork_notes (
  week_id uuid not null references public.classroom_weeks(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  note text not null check (char_length(note) between 1 and 2000),
  updated_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (week_id, student_id)
);

comment on table public.classroom_topic_classwork_notes is
'Private teacher notes attached to a student classwork grade for one topic.';

create trigger classroom_topic_classwork_notes_set_updated_at
before update on public.classroom_topic_classwork_notes
for each row execute function public.set_updated_at();

alter table public.classroom_topic_classwork_notes enable row level security;
revoke all on table public.classroom_topic_classwork_notes from anon, public;
grant select, insert, update, delete on table public.classroom_topic_classwork_notes to authenticated;

create policy "topic classwork notes: teachers read owned classes"
on public.classroom_topic_classwork_notes
for select to authenticated using (exists (
  select 1
  from public.classroom_weeks topic
  join public.classes classroom on classroom.id = topic.class_id
  where topic.id = classroom_topic_classwork_notes.week_id
    and classroom.teacher_id = auth.uid()
));

create policy "topic classwork notes: teachers insert owned students"
on public.classroom_topic_classwork_notes
for insert to authenticated with check (
  updated_by = auth.uid()
  and exists (
    select 1
    from public.classroom_weeks topic
    join public.classes classroom on classroom.id = topic.class_id
    join public.class_members member on member.class_id = classroom.id
    where topic.id = classroom_topic_classwork_notes.week_id
      and classroom.teacher_id = auth.uid()
      and member.student_id = classroom_topic_classwork_notes.student_id
  )
);

create policy "topic classwork notes: teachers update owned students"
on public.classroom_topic_classwork_notes
for update to authenticated using (exists (
  select 1
  from public.classroom_weeks topic
  join public.classes classroom on classroom.id = topic.class_id
  where topic.id = classroom_topic_classwork_notes.week_id
    and classroom.teacher_id = auth.uid()
)) with check (
  updated_by = auth.uid()
  and exists (
    select 1
    from public.classroom_weeks topic
    join public.classes classroom on classroom.id = topic.class_id
    join public.class_members member on member.class_id = classroom.id
    where topic.id = classroom_topic_classwork_notes.week_id
      and classroom.teacher_id = auth.uid()
      and member.student_id = classroom_topic_classwork_notes.student_id
  )
);

create policy "topic classwork notes: teachers delete owned classes"
on public.classroom_topic_classwork_notes
for delete to authenticated using (exists (
  select 1
  from public.classroom_weeks topic
  join public.classes classroom on classroom.id = topic.class_id
  where topic.id = classroom_topic_classwork_notes.week_id
    and classroom.teacher_id = auth.uid()
));
