-- Final grades are opt-in. A topic can exist with tests and ongoing work but
-- without a final-grade formula or a selected summative test.

alter table public.classroom_weeks
alter column final_grade_formula drop not null,
alter column final_grade_formula drop default;

create or replace function public.maintain_topic_summative_grade_column()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.week_id is distinct from new.week_id then
    update public.classroom_weeks
    set summative_grade_column_id = null
    where id = old.week_id and summative_grade_column_id = old.id;
  end if;

  return new;
end;
$$;

comment on column public.classroom_weeks.final_grade_formula is
'Optional teacher-defined topic final-grade formula. Null means final grades are not configured for the topic.';
