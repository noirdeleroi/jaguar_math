create table public.student_notifications (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in (
    'assessment_new',
    'assessment_score_released',
    'assessment_review_released',
    'assessment_pdf_released',
    'star_gained',
    'skull_gained',
    'homework_status',
    'classwork_status',
    'classwork_note'
  )),
  title text not null check (char_length(title) between 1 and 160),
  body text not null check (char_length(body) between 1 and 500),
  href text not null check (href like '/student/%'),
  source_type text not null,
  source_id uuid,
  event_key text unique,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index student_notifications_student_created_idx
on public.student_notifications (student_id, created_at desc);

create index student_notifications_student_unread_idx
on public.student_notifications (student_id, created_at desc)
where read_at is null;

alter publication supabase_realtime add table public.student_notifications;

alter table public.student_notifications enable row level security;
revoke all on table public.student_notifications from anon, public;
grant select on table public.student_notifications to authenticated;
grant update (read_at) on table public.student_notifications to authenticated;

create policy "student notifications: students read own"
on public.student_notifications for select to authenticated
using (student_id = auth.uid());

create policy "student notifications: students update own"
on public.student_notifications for update to authenticated
using (student_id = auth.uid())
with check (student_id = auth.uid());

create function public.notify_students_of_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.student_notifications (
    student_id, kind, title, body, href, source_type, source_id, event_key, metadata
  )
  select member.student_id,
         'assessment_new',
         left('New assessment: ' || new.title, 160),
         left(format(
           '%s is ready in %s%s',
           case new.kind when 'homework' then 'Homework' when 'quiz' then 'Quiz' else 'Test' end,
           string_agg(distinct classroom.name, ' · ' order by classroom.name),
           case when new.due_at is null then '.' else '. Due ' || to_char(new.due_at, 'Mon FMDD at HH12:MI AM') || '.' end
         ), 500),
         '/student/assignments/' || new.id,
         'assignment',
         new.id,
         'assessment:new:' || new.id || ':' || member.student_id,
         jsonb_build_object('assignment_id', new.id, 'assignment_kind', new.kind)
  from public.assignment_classes assignment_class
  join public.class_members member on member.class_id = assignment_class.class_id
  join public.classes classroom on classroom.id = assignment_class.class_id
  where assignment_class.assignment_id = new.id
  group by member.student_id
  on conflict (event_key) do nothing;
  return new;
end;
$$;

create trigger assignments_notify_students_after_publish
after update of status on public.assignments
for each row
when (old.status = 'draft' and new.status = 'published')
execute function public.notify_students_of_assignment();

create function public.notify_students_of_published_assignment_class()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_assignment public.assignments;
begin
  select * into v_assignment
  from public.assignments
  where id = new.assignment_id and status = 'published';

  if v_assignment.id is null then return new; end if;

  insert into public.student_notifications (
    student_id, kind, title, body, href, source_type, source_id, event_key, metadata
  )
  select member.student_id,
         'assessment_new',
         left('New assessment: ' || v_assignment.title, 160),
         left(format(
           '%s is ready in %s%s',
           case v_assignment.kind when 'homework' then 'Homework' when 'quiz' then 'Quiz' else 'Test' end,
           classroom.name,
           case when v_assignment.due_at is null then '.' else '. Due ' || to_char(v_assignment.due_at, 'Mon FMDD at HH12:MI AM') || '.' end
         ), 500),
         '/student/assignments/' || v_assignment.id,
         'assignment',
         v_assignment.id,
         'assessment:new:' || v_assignment.id || ':' || member.student_id,
         jsonb_build_object('assignment_id', v_assignment.id, 'assignment_kind', v_assignment.kind)
  from public.class_members member
  join public.classes classroom on classroom.id = member.class_id
  where member.class_id = new.class_id
  on conflict (event_key) do nothing;
  return new;
end;
$$;

create trigger assignment_classes_notify_students_after_insert
after insert on public.assignment_classes
for each row execute function public.notify_students_of_published_assignment_class();

create function public.notify_new_member_of_published_assignments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.student_notifications (
    student_id, kind, title, body, href, source_type, source_id, event_key, metadata
  )
  select new.student_id,
         'assessment_new',
         left('New assessment: ' || assignment.title, 160),
         left(format(
           '%s is ready in %s%s',
           case assignment.kind when 'homework' then 'Homework' when 'quiz' then 'Quiz' else 'Test' end,
           classroom.name,
           case when assignment.due_at is null then '.' else '. Due ' || to_char(assignment.due_at, 'Mon FMDD at HH12:MI AM') || '.' end
         ), 500),
         '/student/assignments/' || assignment.id,
         'assignment',
         assignment.id,
         'assessment:new:' || assignment.id || ':' || new.student_id,
         jsonb_build_object('assignment_id', assignment.id, 'assignment_kind', assignment.kind)
  from public.assignment_classes assignment_class
  join public.assignments assignment on assignment.id = assignment_class.assignment_id
  join public.classes classroom on classroom.id = assignment_class.class_id
  where assignment_class.class_id = new.class_id
    and assignment.status = 'published'
  on conflict (event_key) do nothing;
  return new;
end;
$$;

create trigger class_members_notify_after_insert
after insert on public.class_members
for each row execute function public.notify_new_member_of_published_assignments();

create function public.notify_students_of_released_results()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_title text;
  v_body text;
begin
  if new.show_answers_after_submit and not old.show_answers_after_submit then
    v_kind := 'assessment_review_released';
    v_title := left('Full results released: ' || new.title, 160);
    v_body := 'Your score and answer review are now available.';
  elsif new.show_score_after_submit and not old.show_score_after_submit then
    v_kind := 'assessment_score_released';
    v_title := left('Score released: ' || new.title, 160);
    v_body := 'Your assessment score is now available.';
  else
    return new;
  end if;

  insert into public.student_notifications (
    student_id, kind, title, body, href, source_type, source_id, event_key, metadata
  )
  select distinct attempt.student_id,
         v_kind,
         v_title,
         v_body,
         '/student/assignments/' || new.id,
         'assignment_results',
         new.id,
         'assessment:results:' || new.id || ':' || attempt.student_id || ':' || new.updated_at,
         jsonb_build_object('assignment_id', new.id, 'visibility', case when new.show_answers_after_submit then 'full_review' else 'score_only' end)
  from public.attempts attempt
  where attempt.assignment_id = new.id and attempt.status = 'submitted'
  on conflict (event_key) do nothing;
  return new;
end;
$$;

create trigger assignments_notify_students_after_result_release
after update of show_score_after_submit, show_answers_after_submit on public.assignments
for each row execute function public.notify_students_of_released_results();

create function public.notify_students_of_released_homework_pdf()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.homework_pdf_released_at is not null or new.homework_pdf_released_at is null then return new; end if;

  insert into public.student_notifications (
    student_id, kind, title, body, href, source_type, source_id, event_key, metadata
  )
  select distinct member.student_id,
         'assessment_pdf_released',
         left('Homework PDF released: ' || new.title, 160),
         case
           when new.due_at is null then 'The printable questions and answer key will be ready after a deadline is set.'
           when new.due_at <= now() then 'The printable questions and answer key are ready to download.'
           else 'The printable questions and answer key will be ready after the deadline on ' || to_char(new.due_at, 'Mon FMDD at HH12:MI AM') || '.'
         end,
         '/student/assignments/' || new.id,
         'assignment_pdf',
         new.id,
         'assessment:pdf:' || new.id || ':' || member.student_id || ':' || new.updated_at,
         jsonb_build_object('assignment_id', new.id, 'due_at', new.due_at, 'released_at', new.homework_pdf_released_at)
  from public.assignment_classes assignment_class
  join public.class_members member on member.class_id = assignment_class.class_id
  where assignment_class.assignment_id = new.id
  on conflict (event_key) do nothing;
  return new;
end;
$$;

create trigger assignments_notify_students_after_homework_pdf_release
after update of homework_pdf_released_at on public.assignments
for each row execute function public.notify_students_of_released_homework_pdf();

create function public.notify_student_of_star_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class_name text;
  v_week_label text;
  v_amount integer := abs(new.delta);
begin
  select classroom.name, week.label into v_class_name, v_week_label
  from public.classes classroom
  join public.classroom_weeks week on week.class_id = classroom.id
  where classroom.id = new.class_id and week.id = new.week_id;

  insert into public.student_notifications (
    student_id, kind, title, body, href, source_type, source_id, event_key, metadata, created_at
  ) values (
    new.student_id,
    case when new.delta > 0 then 'star_gained' else 'skull_gained' end,
    case
      when new.delta = 1 then 'You earned a star!'
      when new.delta > 1 then v_amount || ' stars added'
      when new.delta = -1 then 'You received a skull'
      else v_amount || ' skulls added'
    end,
    left(coalesce(v_class_name, 'Your class') || ' · Week ' || coalesce(v_week_label, '—') || coalesce(' · ' || nullif(new.note, ''), ''), 500),
    '/student/records',
    'star_event',
    new.id,
    'star-event:' || new.id,
    jsonb_build_object('class_id', new.class_id, 'week_id', new.week_id, 'delta', new.delta),
    now()
  )
  on conflict (event_key) do nothing;
  return new;
end;
$$;

create trigger classroom_star_events_notify_student
after insert on public.classroom_star_events
for each row execute function public.notify_student_of_star_event();

create function public.notify_student_of_work_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.classroom_work_items;
  v_class_name text;
  v_week_label text;
  v_status_label text;
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;

  select * into v_item from public.classroom_work_items where id = new.work_item_id;
  select name into v_class_name from public.classes where id = v_item.class_id;
  select label into v_week_label from public.classroom_weeks where id = v_item.week_id;
  v_status_label := case
    when new.status in ('ok', 'done') then 'OK'
    when new.status = 'late' then 'Late'
    else 'Not OK'
  end;

  insert into public.student_notifications (
    student_id, kind, title, body, href, source_type, source_id, metadata
  ) values (
    new.student_id,
    case when v_item.kind = 'homework' then 'homework_status' else 'classwork_status' end,
    case when v_item.kind = 'homework' then 'Homework marked ' else 'Classwork marked ' end || v_status_label,
    v_item.title || ' · Week ' || coalesce(v_week_label, '—') || ' · ' || coalesce(v_class_name, 'Your class'),
    '/student/records',
    'work_status',
    new.work_item_id,
    jsonb_build_object('class_id', v_item.class_id, 'week_id', v_item.week_id, 'work_item_id', new.work_item_id, 'status', new.status)
  );
  return new;
end;
$$;

create trigger classroom_work_statuses_notify_student
after insert or update of status on public.classroom_work_statuses
for each row execute function public.notify_student_of_work_status();

create function public.remove_cleared_work_status_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.student_notifications
  where student_id = old.student_id
    and source_type = 'work_status'
    and source_id = old.work_item_id;
  return old;
end;
$$;

create trigger classroom_work_statuses_remove_cleared_notification
after delete on public.classroom_work_statuses
for each row execute function public.remove_cleared_work_status_notifications();

create function public.notify_student_of_cw_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class_name text;
  v_week_label text;
begin
  select name into v_class_name from public.classes where id = new.class_id;
  select label into v_week_label from public.classroom_weeks where id = new.week_id;

  insert into public.student_notifications (
    student_id, kind, title, body, href, source_type, source_id, event_key, metadata, created_at
  ) values (
    new.student_id,
    'classwork_note',
    'Classwork marked Not OK',
    left('Week ' || coalesce(v_week_label, '—') || ' · ' || coalesce(v_class_name, 'Your class') || ' · ' || new.reason, 500),
    '/student/records',
    'cw_record',
    new.id,
    'cw-record:' || new.id,
    jsonb_build_object('class_id', new.class_id, 'week_id', new.week_id, 'record_date', new.record_date),
    new.created_at
  )
  on conflict (event_key) do nothing;
  return new;
end;
$$;

create trigger classroom_cw_records_notify_student
after insert on public.classroom_cw_records
for each row execute function public.notify_student_of_cw_note();

create function public.remove_deleted_cw_note_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.student_notifications where event_key = 'cw-record:' || old.id;
  return old;
end;
$$;

create trigger classroom_cw_records_remove_notification
after delete on public.classroom_cw_records
for each row execute function public.remove_deleted_cw_note_notification();

revoke all on function public.notify_students_of_assignment() from public, anon, authenticated;
revoke all on function public.notify_students_of_published_assignment_class() from public, anon, authenticated;
revoke all on function public.notify_new_member_of_published_assignments() from public, anon, authenticated;
revoke all on function public.notify_students_of_released_results() from public, anon, authenticated;
revoke all on function public.notify_students_of_released_homework_pdf() from public, anon, authenticated;
revoke all on function public.notify_student_of_star_event() from public, anon, authenticated;
revoke all on function public.notify_student_of_work_status() from public, anon, authenticated;
revoke all on function public.remove_cleared_work_status_notifications() from public, anon, authenticated;
revoke all on function public.notify_student_of_cw_note() from public, anon, authenticated;
revoke all on function public.remove_deleted_cw_note_notification() from public, anon, authenticated;
