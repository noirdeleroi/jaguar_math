-- Topic final grades are bounded numeric grades. Teachers can choose the
-- maximum, while the class manager clamps calculated values to 0..maximum.

alter table public.classroom_weeks
add column final_grade_max numeric not null default 20,
add constraint classroom_weeks_final_grade_max_range
  check (final_grade_max > 0 and final_grade_max <= 100000);

comment on column public.classroom_weeks.final_grade_max is
'Maximum allowed calculated final grade for this topic; calculated values are clamped between zero and this maximum.';
