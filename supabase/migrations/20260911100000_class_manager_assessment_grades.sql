alter table public.assignments
add column include_in_class_manager boolean not null default false;

comment on column public.assignments.include_in_class_manager is
'When true, submitted grades appear in the teacher class manager gradebook.';

update public.assignments
set include_in_class_manager = true
where id = 'c52c2009-e53e-404c-a9f6-05056209ecb2';
