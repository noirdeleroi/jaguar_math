create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'student' check (role in ('student', 'teacher')),
  grade_level smallint check (grade_level in (11, 12)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  grade_level smallint not null check (grade_level in (11, 12)),
  academic_year text not null,
  teacher_id uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (name, academic_year)
);

create table public.class_members (
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (class_id, student_id)
);

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  domain text not null,
  subdomain text not null,
  name text not null,
  sort_order integer not null,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.skill_aero_mappings (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references public.skills(id) on delete cascade,
  aero_code text,
  mapping_status text not null check (mapping_status in ('direct', 'partial', 'prerequisite', 'extension'))
);
create unique index skill_aero_mappings_unique on public.skill_aero_mappings (skill_id, coalesce(aero_code, ''));

create table public.skill_sat_mappings (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references public.skills(id) on delete cascade,
  sat_domain text,
  sat_skill text,
  mapping_status text not null check (mapping_status in ('direct', 'supporting', 'not_assessed'))
);
create unique index skill_sat_mappings_unique on public.skill_sat_mappings (skill_id, coalesce(sat_domain, ''), coalesce(sat_skill, ''));

create table public.skill_icfes_mappings (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references public.skills(id) on delete cascade,
  category text check (category in ('Estadística', 'Geometría', 'Álgebra y cálculo')),
  content_type text check (content_type in ('Genérico', 'No genérico', 'Mixto')),
  mapping_status text not null check (mapping_status in ('direct', 'supporting', 'not_explicit'))
);
create unique index skill_icfes_mappings_unique on public.skill_icfes_mappings (skill_id, coalesce(category, ''), coalesce(content_type, ''));

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  kind text not null check (kind in ('homework', 'quiz', 'test')),
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  due_at timestamptz,
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  max_attempts integer not null default 1 check (max_attempts >= 1),
  show_score_after_submit boolean not null default true,
  show_answers_after_submit boolean not null default false,
  shuffle_questions boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create table public.assignment_classes (
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  primary key (assignment_id, class_id)
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  prompt text not null,
  type text not null check (type in ('multiple_choice', 'numeric', 'short_text')),
  options jsonb check (options is null or jsonb_typeof(options) = 'array'),
  difficulty smallint not null check (difficulty between 1 and 5),
  icfes_competency text check (icfes_competency in ('INTERPRETACION_REPRESENTACION', 'FORMULACION_EJECUCION', 'ARGUMENTACION')),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.question_keys (
  question_id uuid primary key references public.questions(id) on delete cascade,
  correct_answer text not null,
  numeric_tolerance numeric not null default 0 check (numeric_tolerance >= 0),
  explanation text
);

create table public.question_skills (
  question_id uuid not null references public.questions(id) on delete cascade,
  skill_id uuid not null references public.skills(id) on delete restrict,
  weight numeric not null default 1 check (weight > 0),
  is_primary boolean not null default false,
  primary key (question_id, skill_id)
);
create unique index question_skills_one_primary on public.question_skills (question_id) where is_primary;

create table public.assignment_questions (
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  position integer not null check (position > 0),
  points numeric not null default 1 check (points > 0),
  primary key (assignment_id, question_id),
  unique (assignment_id, position)
);

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete restrict,
  student_id uuid not null references public.profiles(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted')),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  score numeric,
  max_score numeric,
  unique (assignment_id, student_id, attempt_number)
);
create index attempts_student_id_idx on public.attempts (student_id);

create table public.responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  student_answer text,
  is_correct boolean,
  points_awarded numeric,
  answered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attempt_id, question_id),
  check (points_awarded is null or points_awarded >= 0)
);
create index responses_attempt_id_idx on public.responses (attempt_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$ begin new.updated_at = now(); return new; end; $$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger skills_set_updated_at before update on public.skills for each row execute function public.set_updated_at();
create trigger assignments_set_updated_at before update on public.assignments for each row execute function public.set_updated_at();
create trigger questions_set_updated_at before update on public.questions for each row execute function public.set_updated_at();
create trigger responses_set_updated_at before update on public.responses for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

insert into public.profiles (id, email, full_name)
select id, email, raw_user_meta_data ->> 'full_name'
from auth.users
on conflict (id) do nothing;

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'teacher'); $$;

create or replace function public.try_parse_numeric(p_value text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_value is not null and char_length(btrim(p_value)) between 1 and 100 and btrim(p_value) ~ '^[+-]?(\d+(\.\d*)?|\.\d+)$' then btrim(p_value)::numeric else null end;
$$;

alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.class_members enable row level security;
alter table public.skills enable row level security;
alter table public.skill_aero_mappings enable row level security;
alter table public.skill_sat_mappings enable row level security;
alter table public.skill_icfes_mappings enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_classes enable row level security;
alter table public.questions enable row level security;
alter table public.question_keys enable row level security;
alter table public.question_skills enable row level security;
alter table public.assignment_questions enable row level security;
alter table public.attempts enable row level security;
alter table public.responses enable row level security;

revoke all on table public.profiles, public.classes, public.class_members, public.skills, public.skill_aero_mappings, public.skill_sat_mappings, public.skill_icfes_mappings, public.assignments, public.assignment_classes, public.questions, public.question_keys, public.question_skills, public.assignment_questions, public.attempts, public.responses from anon, public;
grant all on table public.profiles, public.classes, public.class_members, public.skills, public.skill_aero_mappings, public.skill_sat_mappings, public.skill_icfes_mappings, public.assignments, public.assignment_classes, public.questions, public.question_keys, public.question_skills, public.assignment_questions, public.attempts, public.responses to authenticated;

create policy "profiles: students read self" on public.profiles for select to authenticated using (id = auth.uid());
create policy "profiles: teachers manage" on public.profiles for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "classes: students read memberships" on public.classes for select to authenticated using (public.is_teacher() or exists (select 1 from public.class_members where class_id = classes.id and student_id = auth.uid()));
create policy "classes: teachers manage" on public.classes for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "class members: students read self" on public.class_members for select to authenticated using (student_id = auth.uid() or public.is_teacher());
create policy "class members: teachers manage" on public.class_members for all to authenticated using (public.is_teacher()) with check (public.is_teacher());

create policy "skills: authenticated read" on public.skills for select to authenticated using (true);
create policy "skills: teachers manage" on public.skills for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "aero mappings: authenticated read" on public.skill_aero_mappings for select to authenticated using (true);
create policy "aero mappings: teachers manage" on public.skill_aero_mappings for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "sat mappings: authenticated read" on public.skill_sat_mappings for select to authenticated using (true);
create policy "sat mappings: teachers manage" on public.skill_sat_mappings for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "icfes mappings: authenticated read" on public.skill_icfes_mappings for select to authenticated using (true);
create policy "icfes mappings: teachers manage" on public.skill_icfes_mappings for all to authenticated using (public.is_teacher()) with check (public.is_teacher());

create policy "assignments: students read published class work" on public.assignments for select to authenticated using (public.is_teacher() or (status = 'published' and exists (select 1 from public.assignment_classes ac join public.class_members cm on cm.class_id = ac.class_id where ac.assignment_id = assignments.id and cm.student_id = auth.uid())));
create policy "assignments: teachers manage" on public.assignments for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "assignment classes: students read own class links" on public.assignment_classes for select to authenticated using (public.is_teacher() or exists (select 1 from public.class_members where class_id = assignment_classes.class_id and student_id = auth.uid()));
create policy "assignment classes: teachers manage" on public.assignment_classes for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "questions: students read assigned published questions" on public.questions for select to authenticated using (public.is_teacher() or exists (select 1 from public.assignment_questions aq join public.assignments a on a.id = aq.assignment_id join public.assignment_classes ac on ac.assignment_id = a.id join public.class_members cm on cm.class_id = ac.class_id where aq.question_id = questions.id and a.status = 'published' and cm.student_id = auth.uid()));
create policy "questions: teachers manage" on public.questions for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "question keys: teachers only" on public.question_keys for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "question skills: students read assigned mappings" on public.question_skills for select to authenticated using (public.is_teacher() or exists (select 1 from public.assignment_questions aq join public.assignments a on a.id = aq.assignment_id join public.assignment_classes ac on ac.assignment_id = a.id join public.class_members cm on cm.class_id = ac.class_id where aq.question_id = question_skills.question_id and a.status = 'published' and cm.student_id = auth.uid()));
create policy "question skills: teachers manage" on public.question_skills for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "assignment questions: students read assigned composition" on public.assignment_questions for select to authenticated using (public.is_teacher() or exists (select 1 from public.assignments a join public.assignment_classes ac on ac.assignment_id = a.id join public.class_members cm on cm.class_id = ac.class_id where a.id = assignment_questions.assignment_id and a.status = 'published' and cm.student_id = auth.uid()));
create policy "assignment questions: teachers manage" on public.assignment_questions for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "attempts: students read own" on public.attempts for select to authenticated using (student_id = auth.uid() or public.is_teacher());
create policy "responses: students read own" on public.responses for select to authenticated using (public.is_teacher() or exists (select 1 from public.attempts where attempts.id = responses.attempt_id and attempts.student_id = auth.uid()));

create or replace function public.start_attempt(p_assignment_id uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_assignment public.assignments; v_attempt public.attempts; v_next integer;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'student') then raise exception 'Only authenticated students can start attempts'; end if;
  select * into v_assignment from public.assignments where id = p_assignment_id and status = 'published';
  if not found then raise exception 'Assignment is not available'; end if;
  if not exists (select 1 from public.assignment_classes ac join public.class_members cm on cm.class_id = ac.class_id where ac.assignment_id = p_assignment_id and cm.student_id = v_user) then raise exception 'Assignment is not assigned to this student'; end if;
  perform pg_advisory_xact_lock(hashtext(p_assignment_id::text), hashtext(v_user::text));
  select count(*) + 1 into v_next from public.attempts where assignment_id = p_assignment_id and student_id = v_user;
  if v_next > v_assignment.max_attempts then raise exception 'Maximum attempts reached'; end if;
  insert into public.attempts (assignment_id, student_id, attempt_number) values (p_assignment_id, v_user, v_next) returning * into v_attempt;
  return v_attempt;
end;
$$;

create or replace function public.save_response(p_attempt_id uuid, p_question_id uuid, p_student_answer text)
returns public.responses
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_response public.responses;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'student') then raise exception 'Only authenticated students can save responses'; end if;
  if not exists (select 1 from public.attempts where id = p_attempt_id and student_id = v_user and status = 'in_progress') then raise exception 'Attempt is not available for editing'; end if;
  if not exists (select 1 from public.attempts a join public.assignment_questions aq on aq.assignment_id = a.assignment_id where a.id = p_attempt_id and aq.question_id = p_question_id) then raise exception 'Question is not part of this attempt'; end if;
  insert into public.responses (attempt_id, question_id, student_answer) values (p_attempt_id, p_question_id, p_student_answer)
  on conflict (attempt_id, question_id) do update set student_answer = excluded.student_answer, is_correct = null, points_awarded = null, answered_at = now(), updated_at = now()
  returning * into v_response;
  return v_response;
end;
$$;

create or replace function public.submit_attempt(p_attempt_id uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_attempt public.attempts; v_score numeric; v_max_score numeric;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'student') then raise exception 'Only authenticated students can submit attempts'; end if;
  select * into v_attempt from public.attempts where id = p_attempt_id and student_id = v_user for update;
  if not found then raise exception 'Attempt not found'; end if;
  if v_attempt.status <> 'in_progress' then raise exception 'Attempt has already been submitted'; end if;
  if exists (select 1 from public.assignment_questions aq left join public.question_keys key on key.question_id = aq.question_id where aq.assignment_id = v_attempt.assignment_id and key.question_id is null) then raise exception 'Assignment contains an ungradable question'; end if;
  insert into public.responses (attempt_id, question_id, student_answer)
  select v_attempt.id, aq.question_id, null from public.assignment_questions aq
  where aq.assignment_id = v_attempt.assignment_id and not exists (select 1 from public.responses r where r.attempt_id = v_attempt.id and r.question_id = aq.question_id);
  with grading as (
    select r.id, aq.points, case q.type
      when 'multiple_choice' then lower(btrim(coalesce(r.student_answer, ''))) = lower(btrim(key.correct_answer))
      when 'short_text' then lower(btrim(coalesce(r.student_answer, ''))) = lower(btrim(key.correct_answer))
      when 'numeric' then public.try_parse_numeric(r.student_answer) is not null and public.try_parse_numeric(key.correct_answer) is not null and abs(public.try_parse_numeric(r.student_answer) - public.try_parse_numeric(key.correct_answer)) <= key.numeric_tolerance
    end as correct
    from public.responses r join public.assignment_questions aq on aq.question_id = r.question_id and aq.assignment_id = v_attempt.assignment_id join public.questions q on q.id = r.question_id join public.question_keys key on key.question_id = q.id
    where r.attempt_id = v_attempt.id
  ) update public.responses r set is_correct = grading.correct, points_awarded = case when grading.correct then grading.points else 0 end, updated_at = now() from grading where r.id = grading.id;
  select coalesce(sum(r.points_awarded), 0), coalesce(sum(aq.points), 0) into v_score, v_max_score from public.assignment_questions aq left join public.responses r on r.question_id = aq.question_id and r.attempt_id = v_attempt.id where aq.assignment_id = v_attempt.assignment_id;
  update public.attempts set status = 'submitted', submitted_at = now(), score = v_score, max_score = v_max_score where id = v_attempt.id returning * into v_attempt;
  return v_attempt;
end;
$$;

revoke all on function public.is_teacher() from public;
revoke all on function public.handle_new_user() from public;
revoke all on function public.set_updated_at() from public;
revoke all on function public.try_parse_numeric(text) from public;
revoke all on function public.start_attempt(uuid) from public;
revoke all on function public.save_response(uuid, uuid, text) from public;
revoke all on function public.submit_attempt(uuid) from public;
grant execute on function public.is_teacher() to authenticated;
grant execute on function public.start_attempt(uuid) to authenticated;
grant execute on function public.save_response(uuid, uuid, text) to authenticated;
grant execute on function public.submit_attempt(uuid) to authenticated;
