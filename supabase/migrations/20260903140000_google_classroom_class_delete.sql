alter table public.google_classroom_courses
  drop constraint google_classroom_courses_class_id_fkey;

alter table public.google_classroom_courses
  add constraint google_classroom_courses_class_id_fkey
  foreign key (class_id) references public.classes(id) on delete cascade;
