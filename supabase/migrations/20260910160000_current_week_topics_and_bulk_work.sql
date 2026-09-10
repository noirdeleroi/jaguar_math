create table public.curriculum_week_topics (
  grade_level integer not null check (grade_level in (11, 12)),
  week_label text not null check (week_label ~ '^[A-Z]+[0-9]+$'),
  sort_order integer not null check (sort_order > 0),
  trimester text not null,
  unit text not null,
  topic text not null,
  primary key (grade_level, week_label),
  unique (grade_level, sort_order)
);

insert into public.curriculum_week_topics (grade_level, week_label, sort_order, trimester, unit, topic)
values
  (11, 'A1', 1, 'Trimester 1', 'Course Introduction', 'Welcome, routines & getting ready to work'),
  (11, 'A2', 2, 'Trimester 1', 'Unit 1: Foundations & Algebra', 'Diagnostic + arithmetic foundations'),
  (11, 'A3', 3, 'Trimester 1', 'Unit 1: Foundations & Algebra', 'Algebra foundations'),
  (11, 'A4', 4, 'Trimester 1', 'Unit 1: Foundations & Algebra', 'Linear equations & modeling'),
  (11, 'A5', 5, 'Trimester 1', 'Unit 1: Foundations & Algebra', 'Lines & linear functions'),
  (11, 'A6', 6, 'Trimester 1', 'Unit 1: Foundations & Algebra', 'Systems & inequalities'),
  (11, 'A7', 7, 'Trimester 1', 'Unit 2: Advanced Algebra & Functions', 'Quadratics I'),
  (11, 'A8', 8, 'Trimester 1', 'Unit 2: Advanced Algebra & Functions', 'Quadratics II'),
  (11, 'A9', 9, 'Trimester 1', 'Unit 2: Advanced Algebra & Functions', 'Polynomials & equivalent expressions'),
  (11, 'A10', 10, 'Trimester 1', 'Unit 2: Advanced Algebra & Functions', 'Exponential functions'),
  (11, 'B1', 11, 'Trimester 2', 'Unit 2: Advanced Algebra & Functions', 'Logarithmic functions'),
  (11, 'B2', 12, 'Trimester 2', 'Unit 2: Advanced Algebra & Functions', 'Functions, domain, range & transformations'),
  (11, 'B3', 13, 'Trimester 2', 'Unit 2: Advanced Algebra & Functions', 'Rational, radical & nonlinear equations'),
  (11, 'B4', 14, 'Trimester 2', 'Unit 3: Geometry & Trigonometry', 'Geometry fundamentals'),
  (11, 'B5', 15, 'Trimester 2', 'Unit 3: Geometry & Trigonometry', 'Similarity, Pythagorean theorem & special triangles'),
  (11, 'B6', 16, 'Trimester 2', 'Unit 3: Geometry & Trigonometry', 'Circles & coordinate geometry'),
  (11, 'B7', 17, 'Trimester 2', 'Unit 3: Geometry & Trigonometry', 'Right-triangle trigonometry'),
  (11, 'B8', 18, 'Trimester 2', 'Unit 3: Geometry & Trigonometry', 'Trigonometric functions & unit circle'),
  (11, 'B9', 19, 'Trimester 2', 'Unit 3: Geometry & Trigonometry', 'Trig graphs & periodicity'),
  (11, 'B10', 20, 'Trimester 2', 'Unit 3: Geometry & Trigonometry', 'Analytic trigonometry'),
  (11, 'C1', 21, 'Trimester 3', 'Unit 3: Geometry & Trigonometry', 'Trig applications & modeling'),
  (11, 'C2', 22, 'Trimester 3', 'Unit 4: Data, Statistics & Probability', 'Data displays, center & spread'),
  (11, 'C3', 23, 'Trimester 3', 'Unit 4: Data, Statistics & Probability', 'Scatterplots, regression & models'),
  (11, 'C4', 24, 'Trimester 3', 'Unit 4: Data, Statistics & Probability', 'Probability fundamentals'),
  (11, 'C5', 25, 'Trimester 3', 'Unit 4: Data, Statistics & Probability', 'Conditional probability'),
  (11, 'C6', 26, 'Trimester 3', 'Unit 4: Data, Statistics & Probability', 'Sampling, inference & study design'),
  (11, 'C7', 27, 'Trimester 3', 'Unit 5: ICFES Extensions & Synthesis', 'Sequences, sets & combinatorics'),
  (11, 'C8', 28, 'Trimester 3', 'Unit 5: ICFES Extensions & Synthesis', 'Full SAT Math survey + Desmos'),
  (11, 'C9', 29, 'Trimester 3', 'Unit 5: ICFES Extensions & Synthesis', 'PBL / Math communication showcase'),
  (11, 'C10', 30, 'Trimester 3', 'Unit 5: ICFES Extensions & Synthesis', 'Cumulative review & Grade 12 readiness'),
  (12, 'A1', 1, 'Trimester 1', 'Course Introduction', 'Welcome, routines & getting ready to work'),
  (12, 'A2', 2, 'Trimester 1', 'Unit 1: Foundations & Linear Relationships', 'Diagnostic + targeted arithmetic foundations'),
  (12, 'A3', 3, 'Trimester 1', 'Unit 1: Foundations & Linear Relationships', 'Algebra foundations at SAT level'),
  (12, 'A4', 4, 'Trimester 1', 'Unit 1: Foundations & Linear Relationships', 'Linear equations & modeling'),
  (12, 'A5', 5, 'Trimester 1', 'Unit 1: Foundations & Linear Relationships', 'Lines & linear functions'),
  (12, 'A6', 6, 'Trimester 1', 'Unit 1: Foundations & Linear Relationships', 'Systems & linear inequalities'),
  (12, 'A7', 7, 'Trimester 1', 'Unit 2: Advanced Algebra & Functions', 'Quadratic functions I'),
  (12, 'A8', 8, 'Trimester 1', 'Unit 2: Advanced Algebra & Functions', 'Quadratic functions II'),
  (12, 'A9', 9, 'Trimester 1', 'Unit 2: Advanced Algebra & Functions', 'Equivalent expressions & polynomials'),
  (12, 'A10', 10, 'Trimester 1', 'Unit 2: Advanced Algebra & Functions', 'Exponential & nonlinear functions'),
  (12, 'B1', 11, 'Trimester 2', 'Unit 2: Advanced Algebra & Functions', 'Rational/radical equations + cumulative review'),
  (12, 'B2', 12, 'Trimester 2', 'Unit 3: Data, Geometry & Trigonometry', 'Ratios, rates, percentages & units'),
  (12, 'B3', 13, 'Trimester 2', 'Unit 3: Data, Geometry & Trigonometry', 'Statistics & data displays'),
  (12, 'B4', 14, 'Trimester 2', 'Unit 3: Data, Geometry & Trigonometry', 'Models, probability & inference'),
  (12, 'B5', 15, 'Trimester 2', 'Unit 3: Data, Geometry & Trigonometry', 'Geometry fundamentals'),
  (12, 'B6', 16, 'Trimester 2', 'Unit 3: Data, Geometry & Trigonometry', 'Circles & coordinate geometry'),
  (12, 'B7', 17, 'Trimester 2', 'Unit 3: Data, Geometry & Trigonometry', 'Right-triangle trigonometry'),
  (12, 'B8', 18, 'Trimester 2', 'Unit 4: SAT & ICFES Preparation', 'ICFES-specific extensions'),
  (12, 'B9', 19, 'Trimester 2', 'Unit 4: SAT & ICFES Preparation', 'Mixed SAT problem solving + Desmos'),
  (12, 'B10', 20, 'Trimester 2', 'Unit 4: SAT & ICFES Preparation', 'Final SAT preparation -> ICFES transition'),
  (12, 'C1', 21, 'Trimester 3', 'Unit 3: Derivatives', 'ICFES final review + introduction to derivatives'),
  (12, 'C2', 22, 'Trimester 3', 'Unit 3: Derivatives', 'Basic derivative rules'),
  (12, 'C3', 23, 'Trimester 3', 'Unit 3: Derivatives', 'Derivatives from graphs & functions'),
  (12, 'C4', 24, 'Trimester 3', 'Unit 3: Derivatives', 'Applications of derivatives'),
  (12, 'C5', 25, 'Trimester 3', 'Unit 3: Derivatives', 'Derivative review & assessment'),
  (12, 'C6', 26, 'Trimester 3', 'Unit 4: Integrals', 'Introduction to antiderivatives'),
  (12, 'C7', 27, 'Trimester 3', 'Unit 4: Integrals', 'Definite integrals & area'),
  (12, 'C8', 28, 'Trimester 3', 'Unit 4: Integrals', 'Fundamental Theorem of Calculus'),
  (12, 'C9', 29, 'Trimester 3', 'Unit 4: Integrals', 'Simple applications & cumulative calculus review'),
  (12, 'C10', 30, 'Trimester 3', 'Unit 4: Integrals', 'Final assessment & reflection')
on conflict (grade_level, week_label) do update set
  sort_order = excluded.sort_order,
  trimester = excluded.trimester,
  unit = excluded.unit,
  topic = excluded.topic;

alter table public.curriculum_week_topics enable row level security;
revoke all on table public.curriculum_week_topics from anon, public;
grant select on table public.curriculum_week_topics to authenticated;
create policy "curriculum week topics: authenticated read" on public.curriculum_week_topics
for select to authenticated using (true);

create table public.teacher_star_settings (
  teacher_id uuid primary key references public.profiles(id) on delete cascade,
  current_week_label text not null default 'A3' check (current_week_label ~ '^[A-Z]+[0-9]+$'),
  updated_at timestamptz not null default now()
);

alter table public.teacher_star_settings enable row level security;
revoke all on table public.teacher_star_settings from anon, public;
grant select, insert, update on table public.teacher_star_settings to authenticated;
create policy "teacher star settings: read own" on public.teacher_star_settings
for select to authenticated using (teacher_id = auth.uid());
create policy "teacher star settings: insert own" on public.teacher_star_settings
for insert to authenticated with check (teacher_id = auth.uid());
create policy "teacher star settings: update own" on public.teacher_star_settings
for update to authenticated using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());
create trigger teacher_star_settings_set_updated_at before update on public.teacher_star_settings
for each row execute function public.set_updated_at();

insert into public.teacher_star_settings (teacher_id, current_week_label)
select distinct teacher_id, 'A3'
from public.classes
where teacher_id is not null
on conflict (teacher_id) do nothing;

alter table public.classroom_work_statuses drop constraint if exists classroom_work_statuses_status_check;
alter table public.classroom_work_statuses disable trigger classroom_work_statuses_validate;
update public.classroom_work_statuses
set status = case status when 'done' then 'ok' when 'missing' then 'not_ok' else status end;
alter table public.classroom_work_statuses
add constraint classroom_work_statuses_status_check check (status in ('ok', 'not_ok', 'late'));

create or replace function public.validate_classroom_work_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind text;
begin
  select kind into v_kind from public.classroom_work_items where id = new.work_item_id;
  if v_kind is null then raise exception 'Work item is not available'; end if;
  if v_kind = 'homework' and new.status not in ('ok', 'not_ok', 'late') then
    raise exception 'Homework status must be OK, Not OK, or Late';
  end if;
  if v_kind = 'classwork' and new.status not in ('ok', 'not_ok') then
    raise exception 'Classwork status must be OK or Not OK';
  end if;
  return new;
end;
$$;
alter table public.classroom_work_statuses enable trigger classroom_work_statuses_validate;

create or replace function public.seed_classroom_weeks()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.teacher_id is not null then
    insert into public.classroom_weeks (class_id, label, sort_order, title, focus, created_by)
    select new.id, topic.week_label, topic.sort_order, topic.unit, topic.topic, new.teacher_id
    from public.curriculum_week_topics topic
    where topic.grade_level = new.grade_level
    on conflict (class_id, label) do update set
      sort_order = excluded.sort_order,
      title = excluded.title,
      focus = excluded.focus;
  end if;
  return new;
end;
$$;

update public.classroom_weeks classroom_week
set sort_order = topic.sort_order,
    title = topic.unit,
    focus = topic.topic
from public.classes classroom
join public.curriculum_week_topics topic on topic.grade_level = classroom.grade_level
where classroom_week.class_id = classroom.id
  and classroom_week.label = topic.week_label;

insert into public.classroom_weeks (class_id, label, sort_order, title, focus, created_by)
select classroom.id, topic.week_label, topic.sort_order, topic.unit, topic.topic, classroom.teacher_id
from public.classes classroom
join public.curriculum_week_topics topic on topic.grade_level = classroom.grade_level
where classroom.teacher_id is not null
on conflict (class_id, label) do update set
  sort_order = excluded.sort_order,
  title = excluded.title,
  focus = excluded.focus;

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
  if not exists (select 1 from public.curriculum_week_topics where week_label = p_week_label) then raise exception 'Teaching week is invalid'; end if;
  if exists (
    select 1
    from unnest(p_class_ids) as requested(class_id)
    left join public.classes classroom on classroom.id = requested.class_id and classroom.teacher_id = v_teacher
    where classroom.id is null
  ) then raise exception 'One or more classes are not available to this teacher'; end if;

  for v_class_id in select distinct requested.class_id from unnest(p_class_ids) as requested(class_id)
  loop
    select id into v_week_id from public.classroom_weeks where class_id = v_class_id and label = p_week_label;
    if v_week_id is null then
      insert into public.classroom_weeks (class_id, label, sort_order, title, focus, created_by)
      select classroom.id, topic.week_label, topic.sort_order, topic.unit, topic.topic, v_teacher
      from public.classes classroom
      join public.curriculum_week_topics topic on topic.grade_level = classroom.grade_level
      where classroom.id = v_class_id and topic.week_label = p_week_label
      returning id into v_week_id;
    end if;
    if v_week_id is null then raise exception 'Teaching week is not available for this class'; end if;

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
