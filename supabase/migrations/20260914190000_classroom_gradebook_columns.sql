create table public.classroom_grade_columns (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  week_id uuid not null references public.classroom_weeks(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  assessment_date date not null,
  source text not null check (source in ('assessment', 'manual')),
  assignment_id uuid references public.assignments(id) on delete cascade,
  max_score numeric check (max_score is null or max_score > 0),
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (source = 'assessment' and assignment_id is not null and max_score is null)
    or (source = 'manual' and assignment_id is null and max_score is not null)
  )
);

create unique index classroom_grade_columns_assignment_class_unique
on public.classroom_grade_columns (class_id, assignment_id)
where assignment_id is not null;

create index classroom_grade_columns_class_week_date_idx
on public.classroom_grade_columns (class_id, week_id, assessment_date, created_at);

create table public.classroom_manual_grades (
  column_id uuid not null references public.classroom_grade_columns(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  score numeric not null check (score >= 0),
  updated_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (column_id, student_id)
);

create index classroom_manual_grades_student_idx
on public.classroom_manual_grades (student_id, updated_at desc);

create trigger classroom_manual_grades_set_updated_at
before update on public.classroom_manual_grades
for each row execute function public.set_updated_at();

create or replace function public.default_classroom_grade_week(p_class_id uuid, p_assessment_date date)
returns uuid
language sql
stable
set search_path = ''
as $$
  select classroom_week.id
  from public.classroom_weeks classroom_week
  where classroom_week.class_id = p_class_id
  order by
    (
      select min(abs(work_item.activity_date - p_assessment_date))
      from public.classroom_work_items work_item
      where work_item.week_id = classroom_week.id
        and work_item.activity_date is not null
    ) nulls last,
    case when exists (
      select 1 from public.classroom_work_items work_item where work_item.week_id = classroom_week.id
    ) or exists (
      select 1 from public.classroom_star_events star_event where star_event.week_id = classroom_week.id
    ) then 0 else 1 end,
    classroom_week.sort_order desc
  limit 1;
$$;

create or replace function public.validate_classroom_grade_column()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.classroom_weeks classroom_week
    where classroom_week.id = new.week_id and classroom_week.class_id = new.class_id
  ) then
    raise exception 'Grade column week must belong to its class';
  end if;

  if new.source = 'assessment' and not exists (
    select 1
    from public.assignment_classes assignment_class
    join public.assignments assignment on assignment.id = assignment_class.assignment_id
    where assignment_class.class_id = new.class_id
      and assignment_class.assignment_id = new.assignment_id
      and assignment.created_by = new.created_by
  ) then
    raise exception 'Assessment must be assigned to this class';
  end if;
  return new;
end;
$$;

create trigger classroom_grade_columns_validate
before insert or update on public.classroom_grade_columns
for each row execute function public.validate_classroom_grade_column();

create trigger classroom_grade_columns_set_updated_at
before update on public.classroom_grade_columns
for each row execute function public.set_updated_at();

create or replace function public.validate_classroom_manual_grade()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_class_id uuid;
  v_max_score numeric;
  v_source text;
begin
  select grade_column.class_id, grade_column.max_score, grade_column.source
  into v_class_id, v_max_score, v_source
  from public.classroom_grade_columns grade_column
  where grade_column.id = new.column_id;

  if v_source is distinct from 'manual' then
    raise exception 'Only manual grade columns accept manual scores';
  end if;
  if new.score > v_max_score then
    raise exception 'Grade cannot exceed the column maximum';
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

create trigger classroom_manual_grades_validate
before insert or update on public.classroom_manual_grades
for each row execute function public.validate_classroom_manual_grade();

create or replace function public.sync_assignment_grade_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.assignments%rowtype;
  v_class_id uuid;
  v_date date;
  v_week_id uuid;
begin
  if tg_table_name = 'assignment_classes' then
    if tg_op = 'DELETE' then
      delete from public.classroom_grade_columns
      where class_id = old.class_id and assignment_id = old.assignment_id;
      return old;
    end if;
    select * into v_assignment from public.assignments where id = new.assignment_id;
    v_class_id := new.class_id;
  else
    v_assignment := new;
    if not new.include_in_class_manager then
      delete from public.classroom_grade_columns where assignment_id = new.id;
      return new;
    end if;
  end if;

  if not v_assignment.include_in_class_manager then
    return new;
  end if;

  v_date := coalesce((v_assignment.due_at at time zone 'America/Bogota')::date, current_date);
  for v_class_id in
    select assignment_class.class_id
    from public.assignment_classes assignment_class
    where assignment_class.assignment_id = v_assignment.id
      and (tg_table_name <> 'assignment_classes' or assignment_class.class_id = v_class_id)
  loop
    v_week_id := public.default_classroom_grade_week(v_class_id, v_date);
    if v_week_id is not null then
      insert into public.classroom_grade_columns (
        class_id, week_id, title, assessment_date, source, assignment_id, created_by
      ) values (
        v_class_id, v_week_id, v_assignment.title, v_date, 'assessment', v_assignment.id, v_assignment.created_by
      )
      on conflict (class_id, assignment_id) where assignment_id is not null
      do update set
        week_id = excluded.week_id,
        title = excluded.title,
        assessment_date = excluded.assessment_date;
    end if;
  end loop;
  return new;
end;
$$;

create trigger assignments_sync_grade_columns
after insert or update of include_in_class_manager, title, due_at on public.assignments
for each row execute function public.sync_assignment_grade_columns();

create trigger assignment_classes_sync_grade_columns_after_insert
after insert on public.assignment_classes
for each row execute function public.sync_assignment_grade_columns();

create trigger assignment_classes_sync_grade_columns_after_delete
after delete on public.assignment_classes
for each row execute function public.sync_assignment_grade_columns();

insert into public.classroom_grade_columns (
  class_id, week_id, title, assessment_date, source, assignment_id, created_by
)
select
  assignment_class.class_id,
  public.default_classroom_grade_week(
    assignment_class.class_id,
    coalesce((assignment.due_at at time zone 'America/Bogota')::date, current_date)
  ),
  assignment.title,
  coalesce((assignment.due_at at time zone 'America/Bogota')::date, current_date),
  'assessment',
  assignment.id,
  assignment.created_by
from public.assignments assignment
join public.assignment_classes assignment_class on assignment_class.assignment_id = assignment.id
where assignment.include_in_class_manager
  and assignment.created_by is not null
  and public.default_classroom_grade_week(
    assignment_class.class_id,
    coalesce((assignment.due_at at time zone 'America/Bogota')::date, current_date)
  ) is not null
on conflict (class_id, assignment_id) where assignment_id is not null do nothing;

alter table public.classroom_grade_columns enable row level security;
alter table public.classroom_manual_grades enable row level security;

revoke all on table public.classroom_grade_columns, public.classroom_manual_grades from anon, public;
grant select, insert, update, delete on table public.classroom_grade_columns, public.classroom_manual_grades to authenticated;

create policy "classroom grade columns: teachers read owned classes" on public.classroom_grade_columns
for select to authenticated using (
  exists (select 1 from public.classes where classes.id = classroom_grade_columns.class_id and classes.teacher_id = auth.uid())
);
create policy "classroom grade columns: teachers insert owned classes" on public.classroom_grade_columns
for insert to authenticated with check (
  created_by = auth.uid()
  and exists (select 1 from public.classes where classes.id = classroom_grade_columns.class_id and classes.teacher_id = auth.uid())
);
create policy "classroom grade columns: teachers update owned classes" on public.classroom_grade_columns
for update to authenticated using (
  exists (select 1 from public.classes where classes.id = classroom_grade_columns.class_id and classes.teacher_id = auth.uid())
) with check (
  created_by = auth.uid()
  and exists (select 1 from public.classes where classes.id = classroom_grade_columns.class_id and classes.teacher_id = auth.uid())
);
create policy "classroom grade columns: teachers delete owned classes" on public.classroom_grade_columns
for delete to authenticated using (
  exists (select 1 from public.classes where classes.id = classroom_grade_columns.class_id and classes.teacher_id = auth.uid())
);

create policy "classroom manual grades: teachers read owned classes" on public.classroom_manual_grades
for select to authenticated using (
  exists (
    select 1 from public.classroom_grade_columns grade_column
    join public.classes classroom on classroom.id = grade_column.class_id
    where grade_column.id = classroom_manual_grades.column_id and classroom.teacher_id = auth.uid()
  )
);
create policy "classroom manual grades: teachers insert owned classes" on public.classroom_manual_grades
for insert to authenticated with check (
  updated_by = auth.uid()
  and exists (
    select 1 from public.classroom_grade_columns grade_column
    join public.classes classroom on classroom.id = grade_column.class_id
    where grade_column.id = classroom_manual_grades.column_id and classroom.teacher_id = auth.uid()
  )
);
create policy "classroom manual grades: teachers update owned classes" on public.classroom_manual_grades
for update to authenticated using (
  exists (
    select 1 from public.classroom_grade_columns grade_column
    join public.classes classroom on classroom.id = grade_column.class_id
    where grade_column.id = classroom_manual_grades.column_id and classroom.teacher_id = auth.uid()
  )
) with check (
  updated_by = auth.uid()
  and exists (
    select 1 from public.classroom_grade_columns grade_column
    join public.classes classroom on classroom.id = grade_column.class_id
    where grade_column.id = classroom_manual_grades.column_id and classroom.teacher_id = auth.uid()
  )
);
create policy "classroom manual grades: teachers delete owned classes" on public.classroom_manual_grades
for delete to authenticated using (
  exists (
    select 1 from public.classroom_grade_columns grade_column
    join public.classes classroom on classroom.id = grade_column.class_id
    where grade_column.id = classroom_manual_grades.column_id and classroom.teacher_id = auth.uid()
  )
);

comment on table public.classroom_grade_columns is
'Week-scoped class manager grade columns backed by an automatic assessment or teacher-entered scores.';
