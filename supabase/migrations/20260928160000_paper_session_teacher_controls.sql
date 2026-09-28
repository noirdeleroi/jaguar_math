alter table public.assignments
  add column if not exists paper_writing_paused_at timestamptz;

create or replace function public.pause_owned_paper_session(p_assignment_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_paused_at timestamptz;
begin
  if v_user is null or not exists (
    select 1 from public.profiles where id = v_user and role = 'teacher'
  ) then
    raise exception 'Only authenticated teachers can pause paper tests';
  end if;

  update public.assignments
  set paper_writing_paused_at = now()
  where id = p_assignment_id
    and created_by = v_user
    and kind = 'paper'
    and status = 'published'
    and paper_started_at is not null
    and paper_writing_ends_at > now()
    and paper_writing_paused_at is null
    and questions_released_at is null
  returning paper_writing_paused_at into v_paused_at;

  if not found then raise exception 'The paper writing timer is not running'; end if;
  return v_paused_at;
end;
$$;

create or replace function public.resume_owned_paper_session(p_assignment_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_writing_ends_at timestamptz;
begin
  if v_user is null or not exists (
    select 1 from public.profiles where id = v_user and role = 'teacher'
  ) then
    raise exception 'Only authenticated teachers can resume paper tests';
  end if;

  update public.assignments
  set paper_writing_ends_at = paper_writing_ends_at + (now() - paper_writing_paused_at),
      paper_writing_paused_at = null
  where id = p_assignment_id
    and created_by = v_user
    and kind = 'paper'
    and status = 'published'
    and paper_writing_paused_at is not null
    and questions_released_at is null
  returning paper_writing_ends_at into v_writing_ends_at;

  if not found then raise exception 'The paper writing timer is not paused'; end if;
  return v_writing_ends_at;
end;
$$;

create or replace function public.set_owned_paper_writing_time(
  p_assignment_id uuid,
  p_remaining_seconds integer
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_writing_ends_at timestamptz;
begin
  if v_user is null or not exists (
    select 1 from public.profiles where id = v_user and role = 'teacher'
  ) then
    raise exception 'Only authenticated teachers can change paper test time';
  end if;
  if p_remaining_seconds is null or p_remaining_seconds < 1 or p_remaining_seconds > 86400 then
    raise exception 'Writing time must be between 1 second and 24 hours';
  end if;

  update public.assignments
  set paper_writing_ends_at = coalesce(paper_writing_paused_at, now())
      + make_interval(secs => p_remaining_seconds)
  where id = p_assignment_id
    and created_by = v_user
    and kind = 'paper'
    and status = 'published'
    and paper_started_at is not null
    and questions_released_at is null
  returning paper_writing_ends_at into v_writing_ends_at;

  if not found then raise exception 'The paper writing session is not available'; end if;
  return v_writing_ends_at;
end;
$$;

create or replace function public.finish_owned_paper_writing_and_release_answers(p_assignment_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_released_at timestamptz;
  v_answer_duration integer;
begin
  if v_user is null or not exists (
    select 1 from public.profiles where id = v_user and role = 'teacher'
  ) then
    raise exception 'Only authenticated teachers can release paper answers';
  end if;

  update public.assignments
  set paper_writing_ends_at = now(),
      paper_writing_paused_at = null,
      questions_released_at = now()
  where id = p_assignment_id
    and created_by = v_user
    and kind = 'paper'
    and status = 'published'
    and paper_started_at is not null
    and questions_released_at is null
  returning questions_released_at, paper_answer_duration_seconds
  into v_released_at, v_answer_duration;

  if not found then raise exception 'The paper writing session is not available'; end if;

  update public.attempts attempt
  set expires_at = coalesce((
        select adjustment.answers_released_at
        from public.assignment_student_paper_time adjustment
        where adjustment.assignment_id = p_assignment_id
          and adjustment.student_id = attempt.student_id
      ), v_released_at) + make_interval(secs => greatest(10,
        v_answer_duration + coalesce((
          select adjustment.adjustment_seconds
          from public.assignment_student_paper_time adjustment
          where adjustment.assignment_id = p_assignment_id
            and adjustment.student_id = attempt.student_id
        ), 0)))
  where attempt.assignment_id = p_assignment_id
    and attempt.status = 'in_progress';

  return v_released_at;
end;
$$;

drop function public.get_my_paper_session_state(uuid);

create function public.get_my_paper_session_state(p_assignment_id uuid)
returns table (
  server_now timestamptz,
  writing_started_at timestamptz,
  writing_ends_at timestamptz,
  writing_paused_at timestamptz,
  answers_released_at timestamptz,
  answer_ends_at timestamptz,
  answer_duration_seconds integer,
  attempt_id uuid,
  attempt_status text,
  form_code text,
  focus_violations integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select now(), assignment.paper_started_at, assignment.paper_writing_ends_at,
         assignment.paper_writing_paused_at, effective.release_at,
         case when effective.release_at is null then null
           else coalesce(attempt.expires_at, effective.release_at + make_interval(secs => effective.duration_seconds))
         end,
         effective.duration_seconds, attempt.id, attempt.status,
         attempt.form_code, coalesce(attempt.exam_focus_violations, 0)
  from public.assignments assignment
  left join public.assignment_student_paper_time adjustment
    on adjustment.assignment_id = assignment.id
   and adjustment.student_id = auth.uid()
  cross join lateral (
    select coalesce(adjustment.answers_released_at, assignment.questions_released_at) as release_at,
           greatest(10, assignment.paper_answer_duration_seconds + coalesce(adjustment.adjustment_seconds, 0))::integer as duration_seconds
  ) effective
  left join lateral (
    select candidate.id, candidate.status, candidate.expires_at, candidate.form_code,
           candidate.exam_focus_violations
    from public.attempts candidate
    where candidate.assignment_id = assignment.id
      and candidate.student_id = auth.uid()
    order by candidate.attempt_number desc, candidate.started_at desc, candidate.id desc
    limit 1
  ) attempt on true
  where assignment.id = p_assignment_id
    and assignment.kind = 'paper'
    and assignment.status in ('published', 'closed')
    and exists (
      select 1 from public.assignment_classes assignment_class
      join public.class_members member on member.class_id = assignment_class.class_id
      where assignment_class.assignment_id = assignment.id
        and member.student_id = auth.uid()
    );
$$;

revoke all on function public.pause_owned_paper_session(uuid) from public, anon;
revoke all on function public.resume_owned_paper_session(uuid) from public, anon;
revoke all on function public.set_owned_paper_writing_time(uuid, integer) from public, anon;
revoke all on function public.finish_owned_paper_writing_and_release_answers(uuid) from public, anon;
revoke all on function public.get_my_paper_session_state(uuid) from public, anon;

grant execute on function public.pause_owned_paper_session(uuid) to authenticated;
grant execute on function public.resume_owned_paper_session(uuid) to authenticated;
grant execute on function public.set_owned_paper_writing_time(uuid, integer) to authenticated;
grant execute on function public.finish_owned_paper_writing_and_release_answers(uuid) to authenticated;
grant execute on function public.get_my_paper_session_state(uuid) to authenticated;
