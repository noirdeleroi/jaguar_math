-- Preserve presentation settings when an owner duplicates an assignment.

create function public.duplicate_owned_assignment_with_presentation(p_assignment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_source public.assignments;
  v_copy_id uuid;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'Only authenticated teachers can duplicate assignments';
  end if;
  select * into v_source from public.assignments where id = p_assignment_id and created_by = v_user;
  if not found then raise exception 'Assignment is not managed by this teacher'; end if;
  select public.duplicate_owned_assignment_with_exam(p_assignment_id) into v_copy_id;
  update public.assignments
  set question_display_mode = v_source.question_display_mode,
      show_feedback_after_each_question = v_source.show_feedback_after_each_question
  where id = v_copy_id and created_by = v_user;
  return v_copy_id;
end;
$$;

revoke all on function public.duplicate_owned_assignment_with_presentation(uuid) from public;
grant execute on function public.duplicate_owned_assignment_with_presentation(uuid) to authenticated;
