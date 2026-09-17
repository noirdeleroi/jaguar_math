create table public.classroom_final_grade_overrides (
  week_id uuid not null references public.classroom_weeks(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  score numeric not null check (score >= 0),
  comment text not null default '' check (char_length(comment) <= 500),
  updated_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (week_id, student_id)
);

create index classroom_final_grade_overrides_student_idx
on public.classroom_final_grade_overrides (student_id, updated_at desc);

create trigger classroom_final_grade_overrides_set_updated_at
before update on public.classroom_final_grade_overrides
for each row execute function public.set_updated_at();

create function public.validate_classroom_final_grade_override()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_class_id uuid;
  v_final_grade_max numeric;
begin
  select topic.class_id, topic.final_grade_max
  into v_class_id, v_final_grade_max
  from public.classroom_weeks topic
  where topic.id = new.week_id;

  if new.score > v_final_grade_max then
    raise exception 'Final grade cannot exceed the topic maximum';
  end if;
  if not exists (
    select 1 from public.class_members member
    where member.class_id = v_class_id and member.student_id = new.student_id
  ) then
    raise exception 'Student is not enrolled in this class';
  end if;
  return new;
end;
$$;

create trigger classroom_final_grade_overrides_validate
before insert or update on public.classroom_final_grade_overrides
for each row execute function public.validate_classroom_final_grade_override();

alter table public.classroom_final_grade_overrides enable row level security;

revoke all on table public.classroom_final_grade_overrides from anon, public;
grant select, insert, update, delete on table public.classroom_final_grade_overrides to authenticated;

create policy "final grade overrides: teachers read owned classes"
on public.classroom_final_grade_overrides for select to authenticated
using (
  exists (
    select 1
    from public.classroom_weeks topic
    join public.classes classroom on classroom.id = topic.class_id
    where topic.id = classroom_final_grade_overrides.week_id
      and classroom.teacher_id = auth.uid()
  )
);

create policy "final grade overrides: teachers add to owned classes"
on public.classroom_final_grade_overrides for insert to authenticated
with check (
  updated_by = auth.uid()
  and exists (
    select 1
    from public.classroom_weeks topic
    join public.classes classroom on classroom.id = topic.class_id
    where topic.id = classroom_final_grade_overrides.week_id
      and classroom.teacher_id = auth.uid()
  )
);

create policy "final grade overrides: teachers update owned classes"
on public.classroom_final_grade_overrides for update to authenticated
using (
  exists (
    select 1
    from public.classroom_weeks topic
    join public.classes classroom on classroom.id = topic.class_id
    where topic.id = classroom_final_grade_overrides.week_id
      and classroom.teacher_id = auth.uid()
  )
)
with check (
  updated_by = auth.uid()
  and exists (
    select 1
    from public.classroom_weeks topic
    join public.classes classroom on classroom.id = topic.class_id
    where topic.id = classroom_final_grade_overrides.week_id
      and classroom.teacher_id = auth.uid()
  )
);

create policy "final grade overrides: teachers delete from owned classes"
on public.classroom_final_grade_overrides for delete to authenticated
using (
  exists (
    select 1
    from public.classroom_weeks topic
    join public.classes classroom on classroom.id = topic.class_id
    where topic.id = classroom_final_grade_overrides.week_id
      and classroom.teacher_id = auth.uid()
  )
);

comment on table public.classroom_final_grade_overrides is
'Teacher-entered replacements for calculated topic final grades, with an optional audit comment.';
