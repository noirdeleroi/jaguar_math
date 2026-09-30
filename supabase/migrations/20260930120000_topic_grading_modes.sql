alter table public.classroom_weeks
add column grading_mode text not null default 'stars'
  check (grading_mode in ('stars', 'classwork')),
add column classwork_default_grade numeric(5,2) not null default 80
  check (classwork_default_grade between 0 and 100);

comment on column public.classroom_weeks.grading_mode is
'Controls whether the topic uses stars and skulls or a percentage classwork grade.';

comment on column public.classroom_weeks.classwork_default_grade is
'Default percentage shown for enrolled students when a classwork topic has no individual override.';

create table public.classroom_topic_classwork_grades (
  week_id uuid not null references public.classroom_weeks(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  grade numeric(5,2) not null check (grade between 0 and 100),
  updated_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (week_id, student_id)
);

create trigger classroom_topic_classwork_grades_set_updated_at
before update on public.classroom_topic_classwork_grades
for each row execute function public.set_updated_at();

alter table public.classroom_topic_classwork_grades enable row level security;
revoke all on table public.classroom_topic_classwork_grades from anon, public;
grant select, insert, update, delete on table public.classroom_topic_classwork_grades to authenticated;

create policy "topic classwork grades: teachers read owned classes"
on public.classroom_topic_classwork_grades
for select to authenticated using (exists (
  select 1
  from public.classroom_weeks topic
  join public.classes classroom on classroom.id = topic.class_id
  where topic.id = classroom_topic_classwork_grades.week_id
    and classroom.teacher_id = auth.uid()
));

create policy "topic classwork grades: teachers insert owned students"
on public.classroom_topic_classwork_grades
for insert to authenticated with check (
  updated_by = auth.uid()
  and exists (
    select 1
    from public.classroom_weeks topic
    join public.classes classroom on classroom.id = topic.class_id
    join public.class_members member on member.class_id = classroom.id
    where topic.id = classroom_topic_classwork_grades.week_id
      and classroom.teacher_id = auth.uid()
      and member.student_id = classroom_topic_classwork_grades.student_id
  )
);

create policy "topic classwork grades: teachers update owned students"
on public.classroom_topic_classwork_grades
for update to authenticated using (exists (
  select 1
  from public.classroom_weeks topic
  join public.classes classroom on classroom.id = topic.class_id
  where topic.id = classroom_topic_classwork_grades.week_id
    and classroom.teacher_id = auth.uid()
)) with check (
  updated_by = auth.uid()
  and exists (
    select 1
    from public.classroom_weeks topic
    join public.classes classroom on classroom.id = topic.class_id
    join public.class_members member on member.class_id = classroom.id
    where topic.id = classroom_topic_classwork_grades.week_id
      and classroom.teacher_id = auth.uid()
      and member.student_id = classroom_topic_classwork_grades.student_id
  )
);

create policy "topic classwork grades: teachers delete owned classes"
on public.classroom_topic_classwork_grades
for delete to authenticated using (exists (
  select 1
  from public.classroom_weeks topic
  join public.classes classroom on classroom.id = topic.class_id
  where topic.id = classroom_topic_classwork_grades.week_id
    and classroom.teacher_id = auth.uid()
));

create function public.create_classroom_topics(
  p_class_ids uuid[],
  p_title text,
  p_grading_mode text default 'stars',
  p_classwork_default_grade numeric default 80,
  p_make_current boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher uuid := auth.uid();
  v_class_id uuid;
  v_previous_current_id uuid;
  v_topic_id uuid;
  v_sort_order integer;
  v_label text;
  v_topics jsonb := '[]'::jsonb;
begin
  if v_teacher is null then raise exception 'A teacher session is required'; end if;
  if coalesce(cardinality(p_class_ids), 0) = 0 then raise exception 'Choose at least one class'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120 then raise exception 'Enter a topic name under 120 characters'; end if;
  if p_grading_mode not in ('stars', 'classwork') then raise exception 'Choose stars or classwork grading'; end if;
  if p_classwork_default_grade is null or p_classwork_default_grade < 0 or p_classwork_default_grade > 100 then
    raise exception 'The default classwork grade must be between 0 and 100';
  end if;
  if exists (
    select 1
    from unnest(p_class_ids) requested(class_id)
    left join public.classes classroom on classroom.id = requested.class_id and classroom.teacher_id = v_teacher
    where classroom.id is null
  ) then raise exception 'One or more classes are not available to this teacher'; end if;

  for v_class_id in select distinct requested.class_id from unnest(p_class_ids) requested(class_id)
  loop
    select id into v_previous_current_id
    from public.classroom_weeks
    where class_id = v_class_id and is_current
    limit 1;

    select coalesce(max(sort_order), 0) + 1 into v_sort_order
    from public.classroom_weeks
    where class_id = v_class_id;
    v_label := 'T' || v_sort_order::text;

    insert into public.classroom_weeks
      (class_id, label, sort_order, title, focus, grading_mode, classwork_default_grade, created_by)
    values
      (v_class_id, v_label, v_sort_order, btrim(p_title), null, p_grading_mode, p_classwork_default_grade, v_teacher)
    returning id into v_topic_id;

    if not p_make_current then
      update public.classroom_weeks set is_current = false where id = v_topic_id;
      if v_previous_current_id is not null then
        update public.classroom_weeks set is_current = true where id = v_previous_current_id;
      end if;
    end if;

    v_topics := v_topics || jsonb_build_array(jsonb_build_object(
      'id', v_topic_id,
      'classId', v_class_id,
      'label', v_label,
      'sortOrder', v_sort_order,
      'title', btrim(p_title),
      'focus', null,
      'isCurrent', p_make_current,
      'gradingMode', p_grading_mode,
      'classworkDefaultGrade', p_classwork_default_grade,
      'classworkGrades', '{}'::jsonb,
      'finalGradeFormula', null,
      'finalGradeMax', 20,
      'summativeGradeColumnId', null
    ));
  end loop;

  return jsonb_build_object('topics', v_topics, 'classCount', jsonb_array_length(v_topics));
end;
$$;

revoke all on function public.create_classroom_topics(uuid[], text, text, numeric, boolean) from public, anon;
grant execute on function public.create_classroom_topics(uuid[], text, text, numeric, boolean) to authenticated;
