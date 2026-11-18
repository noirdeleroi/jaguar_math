-- Teacher entries fill missing assessment results without changing attempts.
-- Existing submitted scores always take precedence in the gradebook.
create or replace function public.validate_classroom_manual_grade()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_column public.classroom_grade_columns;
  v_max_score numeric;
begin
  select * into v_column from public.classroom_grade_columns where id = new.column_id;
  if not found then raise exception 'Grade column not found'; end if;
  if not exists (
    select 1 from public.class_members member
    where member.class_id = v_column.class_id and member.student_id = new.student_id
  ) then raise exception 'Student is not enrolled in this class'; end if;

  if v_column.source = 'assessment' then
    if exists (
      select 1 from public.attempts a
      where a.assignment_id = v_column.assignment_id and a.student_id = new.student_id
        and a.status = 'submitted' and a.max_score > 0 and a.score is not null
    ) then raise exception 'This student has a submitted result. Review that attempt to change its grade'; end if;
    select sum(q.points) into v_max_score from public.assignment_questions q where q.assignment_id = v_column.assignment_id;
  else
    v_max_score := v_column.max_score;
  end if;
  if v_max_score is null or v_max_score <= 0 then raise exception 'The assessment has no maximum score'; end if;
  if new.score < 0 or new.score > v_max_score then raise exception 'Grade cannot exceed the assessment maximum'; end if;
  return new;
end;
$$;

comment on table public.classroom_manual_grades is
  'Teacher-entered class-manager grades, including missing assessment/project results. Submitted attempts and completed project rubrics take precedence.';
