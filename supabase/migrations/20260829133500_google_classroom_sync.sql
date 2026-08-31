create table public.google_classroom_connections (
  teacher_id uuid primary key references public.profiles(id) on delete cascade,
  refresh_token text not null,
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.google_classroom_courses (
  google_course_id text primary key,
  class_id uuid not null unique references public.classes(id) on delete restrict,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  google_course_name text not null,
  google_course_section text,
  google_course_state text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index google_classroom_courses_teacher_id_idx on public.google_classroom_courses (teacher_id);

create table public.google_classroom_students (
  google_user_id text primary key,
  student_id uuid not null unique references public.profiles(id) on delete restrict,
  normalized_email text,
  google_full_name text,
  google_photo_url text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index google_classroom_students_student_id_idx on public.google_classroom_students (student_id);
create index google_classroom_students_normalized_email_idx on public.google_classroom_students (normalized_email);

create trigger google_classroom_connections_set_updated_at before update on public.google_classroom_connections for each row execute function public.set_updated_at();
create trigger google_classroom_courses_set_updated_at before update on public.google_classroom_courses for each row execute function public.set_updated_at();
create trigger google_classroom_students_set_updated_at before update on public.google_classroom_students for each row execute function public.set_updated_at();

alter table public.google_classroom_connections enable row level security;
alter table public.google_classroom_courses enable row level security;
alter table public.google_classroom_students enable row level security;

revoke all on table public.google_classroom_connections, public.google_classroom_courses, public.google_classroom_students from anon, authenticated, public;
