-- Let each class keep one teacher-selected current topic. New topics become
-- current automatically, while teachers can switch back to an earlier topic.

alter table public.classroom_weeks
add column is_current boolean not null default false;

with latest_topic as (
  select distinct on (class_id) id
  from public.classroom_weeks
  order by class_id, sort_order desc, created_at desc, id desc
)
update public.classroom_weeks topic
set is_current = true
from latest_topic
where latest_topic.id = topic.id;

create unique index classroom_weeks_one_current_per_class
on public.classroom_weeks (class_id)
where is_current;

create function public.make_new_classroom_topic_current()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.classroom_weeks
  set is_current = false
  where class_id = new.class_id and id <> new.id and is_current;

  update public.classroom_weeks
  set is_current = true
  where id = new.id;
  return new;
end;
$$;

create trigger classroom_weeks_make_new_topic_current
after insert on public.classroom_weeks
for each row execute function public.make_new_classroom_topic_current();

create function public.set_current_classroom_topic(p_class_id uuid, p_topic_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher uuid := auth.uid();
  v_label text;
begin
  if v_teacher is null or not exists (
    select 1 from public.classes
    where id = p_class_id and teacher_id = v_teacher
  ) then
    raise exception 'Class is not available to this teacher';
  end if;

  select label into v_label
  from public.classroom_weeks
  where id = p_topic_id and class_id = p_class_id;
  if v_label is null then raise exception 'Topic is not available for this class'; end if;

  update public.classroom_weeks
  set is_current = false
  where class_id = p_class_id and is_current;

  update public.classroom_weeks
  set is_current = true
  where id = p_topic_id and class_id = p_class_id;

  return jsonb_build_object('status', 'saved', 'topic_id', p_topic_id, 'label', v_label);
end;
$$;

revoke all on function public.set_current_classroom_topic(uuid, uuid) from public, anon;
grant execute on function public.set_current_classroom_topic(uuid, uuid) to authenticated;

comment on column public.classroom_weeks.is_current is
'The teacher-selected current topic for this class. New topics become current automatically.';
