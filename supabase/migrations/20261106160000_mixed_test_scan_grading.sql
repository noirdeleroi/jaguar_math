-- Scan based paper assessments share the established attempt/response grader.
-- No attempt is created until every required page has been accepted.
alter table public.assignments add column paper_scan_enabled boolean not null default false;
alter table public.assignments add constraint assignments_scan_kind check (not paper_scan_enabled or kind = 'paper');

create table public.paper_scan_sheets (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete restrict,
  class_id uuid not null references public.classes(id) on delete restrict,
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  student_name text not null,
  student_code text not null,
  class_name text not null,
  version integer not null check (version between 1 and 4),
  template integer not null default 1 check (template = 1),
  questions jsonb not null check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) between 1 and 200),
  attempt_id uuid references public.attempts(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (assignment_id, student_id)
);

create table public.paper_scan_batches (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  file_name text not null check (char_length(file_name) between 1 and 180),
  file_hash text not null check (file_hash ~ '^[a-f0-9]{64}$'),
  file_size bigint not null check (file_size between 1 and 52428800),
  mime text not null check (mime in ('application/pdf', 'image/png', 'image/jpeg')),
  source_path text not null unique,
  status text not null default 'uploading' check (status in ('uploading', 'ready', 'processing', 'complete', 'failed')),
  page_count integer check (page_count between 1 and 200),
  next_page integer not null default 1 check (next_page between 1 and 201),
  lease uuid,
  lease_until timestamptz,
  error text,
  duplicate_uploads integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, file_hash)
);

create table public.paper_scan_pages (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  batch_id uuid not null references public.paper_scan_batches(id) on delete cascade,
  source_page integer not null check (source_page between 1 and 200),
  sheet_id uuid references public.paper_scan_sheets(id) on delete restrict,
  sheet_page integer check (sheet_page between 1 and 4),
  image_path text not null,
  normalized_path text,
  status text not null check (status in ('review', 'accepted', 'unidentified', 'rejected', 'duplicate')),
  readings jsonb not null default '[]',
  decisions jsonb,
  problem text,
  algorithm text not null,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  unique (batch_id, source_page)
);
create unique index paper_scan_one_active_page on public.paper_scan_pages(sheet_id, sheet_page)
  where status in ('review', 'accepted');
create index paper_scan_pages_assignment on public.paper_scan_pages(assignment_id, created_at);

create table public.paper_scan_audit (
  id bigint generated always as identity primary key,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  page_id uuid references public.paper_scan_pages(id) on delete cascade,
  sheet_id uuid references public.paper_scan_sheets(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete restrict,
  event text not null,
  detail jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.paper_scan_sheets enable row level security;
alter table public.paper_scan_batches enable row level security;
alter table public.paper_scan_pages enable row level security;
alter table public.paper_scan_audit enable row level security;
revoke all on public.paper_scan_sheets, public.paper_scan_batches, public.paper_scan_pages, public.paper_scan_audit from public, anon, authenticated;
grant select on public.paper_scan_sheets, public.paper_scan_batches, public.paper_scan_pages, public.paper_scan_audit to authenticated;
grant all on public.paper_scan_sheets, public.paper_scan_batches, public.paper_scan_pages, public.paper_scan_audit to service_role;
grant usage, select on sequence public.paper_scan_audit_id_seq to service_role;

create policy "scan sheets: owning teacher reads" on public.paper_scan_sheets for select to authenticated using (
  exists (select 1 from public.assignments a where a.id = assignment_id and a.created_by = auth.uid())
);
create policy "scan batches: owning teacher reads" on public.paper_scan_batches for select to authenticated using (teacher_id = auth.uid());
create policy "scan pages: owning teacher reads" on public.paper_scan_pages for select to authenticated using (
  exists (select 1 from public.assignments a where a.id = assignment_id and a.created_by = auth.uid())
);
create policy "scan audit: owning teacher reads" on public.paper_scan_audit for select to authenticated using (
  exists (select 1 from public.assignments a where a.id = assignment_id and a.created_by = auth.uid())
);

-- All storage writes and signed links go through owner-checked server routes.
-- Students and other teachers have no direct access, including via public URLs.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('paper-scans', 'paper-scans', false, 52428800, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

create function public.enforce_scan_assignment_policy()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.paper_scan_enabled and old.status <> 'draft' then
    if not new.paper_scan_enabled or new.kind <> 'paper' then raise exception 'Published Mixed Test mode is locked'; end if;
  end if;
  if new.paper_scan_enabled then
    new.include_in_class_manager := true;
    if exists (
      select 1 from (
        select aq.question_id from public.assignment_questions aq where aq.assignment_id = new.id
        union select av.question_id from public.assignment_question_variants av where av.assignment_id = new.id
      ) ids join public.questions q on q.id = ids.question_id
      where q.type <> 'multiple_choice' or jsonb_array_length(q.options) <> 4
        or not (q.options @> '[{"id":"A"},{"id":"B"},{"id":"C"},{"id":"D"}]'::jsonb)
    ) then raise exception 'Mixed Tests require exactly A/B/C/D multiple-choice options'; end if;
  end if;
  return new;
end; $$;
create trigger zz_assignments_scan_policy before insert or update on public.assignments
  for each row execute function public.enforce_scan_assignment_policy();

create function public.scan_publish_grade_columns()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_class uuid; v_week uuid; v_date date;
begin
  if not new.paper_scan_enabled or new.status = 'draft' then return new; end if;
  v_date := coalesce((new.due_at at time zone 'America/Bogota')::date, (now() at time zone 'America/Bogota')::date);
  for v_class in select class_id from public.assignment_classes where assignment_id = new.id loop
    perform pg_advisory_xact_lock(hashtext(v_class::text));
    v_week := public.default_classroom_grade_week(v_class, v_date);
    if v_week is null then
      insert into public.classroom_weeks(class_id, label, sort_order, title, created_by)
      values(v_class, 'Mixed tests', 1, 'Mixed tests', new.created_by) returning id into v_week;
    end if;
    insert into public.classroom_grade_columns(class_id, week_id, title, assessment_date, source, assignment_id, created_by)
    values(v_class, v_week, left(new.title, 120), v_date, 'assessment', new.id, new.created_by)
    on conflict (class_id, assignment_id) where assignment_id is not null do nothing;
  end loop;
  return new;
end; $$;
create trigger assignments_scan_publish after update of status, paper_scan_enabled on public.assignments
  for each row execute function public.scan_publish_grade_columns();

create function public.prepare_owned_scan_sheets(p_assignment_id uuid)
returns setof public.paper_scan_sheets language plpgsql security definer set search_path = '' as $$
declare a public.assignments; member record; v_version integer; v_count integer; v_questions jsonb;
begin
  select * into a from public.assignments where id = p_assignment_id and created_by = auth.uid()
    and paper_scan_enabled and status in ('published', 'closed') and archived_at is null;
  if not found or not exists(select 1 from public.profiles where id = auth.uid() and role = 'teacher') then raise exception 'Mixed Test is not available'; end if;
  perform pg_advisory_xact_lock(hashtext(p_assignment_id::text));
  select greatest(1, coalesce(max(variant_index), 1)) into v_count from public.assignment_question_variants where assignment_id = p_assignment_id;
  for member in
    select distinct on (m.student_id) m.student_id, m.class_id, c.name as class_name,
      coalesce(p.full_name, m.nickname, p.email, 'Student') as student_name,
      coalesce(r.gradebook_code, left(m.student_id::text, 8)) as student_code
    from public.assignment_classes ac join public.classes c on c.id = ac.class_id
    join public.class_members m on m.class_id = c.id join public.profiles p on p.id = m.student_id and p.role = 'student'
    left join public.class_gradebook_students r on r.class_id = c.id and r.student_id = m.student_id
    where ac.assignment_id = p_assignment_id order by m.student_id, c.name, m.class_id
  loop
    v_version := 1 + mod(get_byte(decode(md5(p_assignment_id::text || member.student_id::text), 'hex'), 0), v_count);
    select jsonb_agg(jsonb_build_object('position', aq.position, 'questionId', q.id, 'points', aq.points,
      'options', jsonb_build_array('A','B','C','D')) order by aq.position) into v_questions
    from public.assignment_questions aq
    join public.questions q on q.id = case when v_version = 1 then aq.question_id else (
      select av.question_id from public.assignment_question_variants av where av.assignment_id = p_assignment_id and av.slot_position = aq.position and av.variant_index = v_version
    ) end where aq.assignment_id = p_assignment_id;
    if v_questions is null then raise exception 'Mixed Test needs a valid question set'; end if;
    insert into public.paper_scan_sheets(assignment_id, student_id, class_id, student_name, student_code, class_name, version, questions)
    values(p_assignment_id, member.student_id, member.class_id, member.student_name, member.student_code, member.class_name, v_version, v_questions)
    on conflict (assignment_id, student_id) do nothing;
  end loop;
  return query select * from public.paper_scan_sheets where assignment_id = p_assignment_id order by class_name, student_name, student_id;
end; $$;
revoke all on function public.prepare_owned_scan_sheets(uuid) from public, anon;
grant execute on function public.prepare_owned_scan_sheets(uuid) to authenticated;

-- Protect issued identities/composition. Classes can be chosen freely in drafts;
-- after publication additional roster members receive new sheets on next print.
create function public.protect_scan_classes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.assignments where id = coalesce(new.assignment_id, old.assignment_id) and paper_scan_enabled and status <> 'draft') then
    raise exception 'Classes on a published Mixed Test are locked; duplicate the assessment to change classes';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end; $$;
create trigger assignment_classes_scan_lock before insert or delete on public.assignment_classes
  for each row execute function public.protect_scan_classes();

-- Only the scan transaction may create/change grade-bearing records for this
-- mode. Student start/save RPCs and the legacy teacher force-submit UI cannot
-- bypass scan review, even if called directly.
create function public.guard_scan_attempt()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_assignment uuid;
begin
  if tg_table_name = 'attempts' then v_assignment := new.assignment_id;
  else select assignment_id into v_assignment from public.attempts where id = new.attempt_id; end if;
  if exists(select 1 from public.assignments where id = v_assignment and paper_scan_enabled)
     and current_setting('jaguar.scan_grade', true) is distinct from v_assignment::text then
    raise exception 'Mixed Test grades are managed through scan review';
  end if;
  return new;
end; $$;
create trigger attempts_scan_guard before insert or update on public.attempts for each row execute function public.guard_scan_attempt();
create trigger responses_scan_guard before insert or update on public.responses for each row execute function public.guard_scan_attempt();

create function public.scan_refresh_grade(p_sheet_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.paper_scan_sheets; v_attempt uuid; v_pages integer; v_accepted integer;
begin
  select * into s from public.paper_scan_sheets where id = p_sheet_id for update;
  if not found then raise exception 'Sheet not found'; end if;
  perform pg_advisory_xact_lock(hashtext(s.assignment_id::text), hashtext(s.student_id::text));
  perform set_config('jaguar.scan_grade', s.assignment_id::text, true);
  v_pages := (jsonb_array_length(s.questions) + 59) / 60;
  select count(*) into v_accepted from public.paper_scan_pages where sheet_id = s.id and status = 'accepted';
  if v_accepted <> v_pages then
    if s.attempt_id is not null then
      update public.attempts set status = 'in_progress', submitted_at = null, score = null, max_score = null, expires_at = null where id = s.attempt_id;
      update public.responses set is_correct = null, points_awarded = null where attempt_id = s.attempt_id;
      insert into public.paper_scan_audit(assignment_id,sheet_id,actor_id,event,detail) values(s.assignment_id,s.id,p_actor,'grade_withheld','{}');
    end if;
    return;
  end if;
  v_attempt := s.attempt_id;
  if v_attempt is null then
    insert into public.attempts(assignment_id,student_id,attempt_number,form_code,paper_version_confirmed_at)
    values(s.assignment_id,s.student_id,1,'Version ' || s.version,now()) returning id into v_attempt;
    insert into public.attempt_questions(attempt_id,question_id,position,slot_position,points,option_order)
    select v_attempt, (q->>'questionId')::uuid, (q->>'position')::integer, (q->>'position')::integer, (q->>'points')::numeric, array['A','B','C','D']
    from jsonb_array_elements(s.questions) q;
    update public.paper_scan_sheets set attempt_id = v_attempt where id = s.id;
  else
    update public.attempts set status = 'in_progress', submitted_at = null, score = null, max_score = null where id = v_attempt;
  end if;
  insert into public.responses(attempt_id,question_id,student_answer)
  select v_attempt,(q->>'questionId')::uuid,r->>'choice'
  from public.paper_scan_pages p cross join lateral jsonb_array_elements(coalesce(p.decisions,p.readings)) r
  join lateral jsonb_array_elements(s.questions) q on (q->>'position')::integer = (r->>'position')::integer
  where p.sheet_id = s.id and p.status = 'accepted'
  on conflict (attempt_id,question_id) do update set student_answer = excluded.student_answer, is_correct = null, points_awarded = null, updated_at = now();
  perform public.finalize_attempt_unchecked(v_attempt);
  insert into public.paper_scan_audit(assignment_id,sheet_id,actor_id,event,detail)
  select s.assignment_id,s.id,p_actor,'grade_finalized',jsonb_build_object('attemptId',id,'score',score,'maxScore',max_score)
  from public.attempts where id = v_attempt;
end; $$;
revoke all on function public.scan_refresh_grade(uuid,uuid) from public, anon, authenticated;

create function public.claim_scan_batch(p_batch_id uuid, p_teacher_id uuid)
returns public.paper_scan_batches language plpgsql security definer set search_path = '' as $$
declare b public.paper_scan_batches;
begin
  select * into b from public.paper_scan_batches where id = p_batch_id and teacher_id = p_teacher_id for update;
  if not found then raise exception 'Batch not found'; end if;
  if b.status = 'complete' then return b; end if;
  if b.lease_until > now() then raise exception 'Batch is already processing'; end if;
  if b.status = 'uploading' then raise exception 'Finish uploading first'; end if;
  update public.paper_scan_batches set lease = gen_random_uuid(), lease_until = now() + interval '90 seconds', status = 'processing', error = null, updated_at = now()
  where id = b.id returning * into b;
  return b;
end; $$;
revoke all on function public.claim_scan_batch(uuid,uuid) from public, anon, authenticated;
grant execute on function public.claim_scan_batch(uuid,uuid) to service_role;

create function public.validate_scan_readings(p_sheet uuid, p_page integer, p_readings jsonb, p_manual boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.paper_scan_sheets; v_count integer;
begin
  select * into s from public.paper_scan_sheets where id = p_sheet;
  v_count := least(60, jsonb_array_length(s.questions) - (p_page - 1) * 60);
  if s.id is null or p_page is null or p_page < 1 or v_count < 1 or jsonb_typeof(p_readings) <> 'array' or jsonb_array_length(p_readings) <> v_count then raise exception 'Answer count does not match this page'; end if;
  if (select count(distinct r->>'position') from jsonb_array_elements(p_readings) r) <> v_count then raise exception 'Repeated answer positions'; end if;
  if exists(
    select 1 from jsonb_array_elements(p_readings) r where not exists(
      select 1 from jsonb_array_elements(s.questions) with ordinality q(value,n)
      where n > (p_page - 1) * 60 and n <= p_page * 60 and q.value->>'position' = r->>'position'
    ) or (r->>'choice' is not null and r->>'choice' not in ('A','B','C','D'))
      or (p_manual and (r->>'resolved') is distinct from 'true')
  ) then raise exception 'Review every answer on the correct page'; end if;
end; $$;
revoke all on function public.validate_scan_readings(uuid,integer,jsonb,boolean) from public, anon, authenticated;

create function public.record_scan_page(p_batch_id uuid, p_lease uuid, p_page_count integer, p_sheet uuid, p_sheet_page integer,
  p_image_path text, p_normalized_path text, p_readings jsonb, p_problem text, p_algorithm text)
returns public.paper_scan_pages language plpgsql security definer set search_path = '' as $$
declare b public.paper_scan_batches; s public.paper_scan_sheets; p public.paper_scan_pages; v_status text;
begin
  select * into b from public.paper_scan_batches where id = p_batch_id and lease = p_lease and lease_until > now() for update;
  if not found then raise exception 'Processing lease expired; retry this page'; end if;
  if p_page_count not between 1 and 200 then raise exception 'Invalid page count'; end if;
  if b.page_count is not null and b.page_count <> p_page_count then raise exception 'Document page count changed'; end if;
  if p_sheet is not null then
    select * into s from public.paper_scan_sheets where id = p_sheet and assignment_id = b.assignment_id for update;
    if not found then raise exception 'Sheet belongs to another assessment'; end if;
    perform public.validate_scan_readings(s.id,p_sheet_page,p_readings,false);
    v_status := case when p_problem is null and not exists(select 1 from jsonb_array_elements(p_readings) r where r->>'status' <> 'clear' or r->>'choice' is null) then 'accepted' else 'review' end;
    if exists(select 1 from public.paper_scan_pages where sheet_id = s.id and sheet_page = p_sheet_page and status in ('review','accepted')) then v_status := 'duplicate'; end if;
  else v_status := 'unidentified'; end if;
  insert into public.paper_scan_pages(assignment_id,batch_id,source_page,sheet_id,sheet_page,image_path,normalized_path,status,readings,problem,algorithm)
  values(b.assignment_id,b.id,b.next_page,s.id,p_sheet_page,p_image_path,p_normalized_path,v_status,p_readings,p_problem,p_algorithm) returning * into p;
  insert into public.paper_scan_audit(assignment_id,page_id,sheet_id,actor_id,event,detail)
  values(b.assignment_id,p.id,s.id,b.teacher_id,'recognized',jsonb_build_object('status',v_status,'readings',p_readings,'problem',p_problem,'algorithm',p_algorithm));
  if s.id is not null and v_status <> 'duplicate' then perform public.scan_refresh_grade(s.id,b.teacher_id); end if;
  update public.paper_scan_batches set next_page = next_page + 1, page_count = p_page_count,
    status = case when next_page >= p_page_count then 'complete' else 'ready' end,
    lease = null, lease_until = null, updated_at = now() where id = b.id;
  return p;
end; $$;
revoke all on function public.record_scan_page(uuid,uuid,integer,uuid,integer,text,text,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.record_scan_page(uuid,uuid,integer,uuid,integer,text,text,jsonb,text,text) to service_role;

create function public.review_scan_page(p_page_id uuid, p_teacher_id uuid, p_revision integer, p_action text, p_decisions jsonb, p_note text,
  p_sheet uuid default null, p_sheet_page integer default null)
returns public.paper_scan_pages language plpgsql security definer set search_path = '' as $$
declare p public.paper_scan_pages; s public.paper_scan_sheets; v_old_sheet uuid;
begin
  select page.* into p from public.paper_scan_pages page join public.assignments a on a.id = page.assignment_id
    where page.id = p_page_id and a.created_by = p_teacher_id and a.paper_scan_enabled for update of page;
  if not found then raise exception 'Scan not found'; end if;
  if p.revision <> p_revision then raise exception 'This scan changed. Refresh before saving'; end if;
  if p_action not in ('accept','reject','reopen','identify') or char_length(btrim(coalesce(p_note,''))) not between 1 and 1000 then raise exception 'Add a short reason for this review'; end if;
  v_old_sheet := p.sheet_id;
  if p_action = 'identify' then
    if p.status not in ('unidentified','rejected','duplicate') then raise exception 'Only unmatched or inactive scans can be reassigned'; end if;
    select * into s from public.paper_scan_sheets where id = p_sheet and assignment_id = p.assignment_id for update;
    if not found then raise exception 'Choose a student from this assessment'; end if;
    perform public.validate_scan_readings(s.id,p_sheet_page,p_decisions,true);
    if exists(select 1 from public.paper_scan_pages where sheet_id = s.id and sheet_page = p_sheet_page and status in ('review','accepted') and id <> p.id) then raise exception 'This student page already has an active scan. Reject it before replacing'; end if;
    update public.paper_scan_pages set sheet_id = s.id,sheet_page = p_sheet_page,status = 'accepted',decisions = p_decisions,revision = revision + 1 where id = p.id returning * into p;
  elsif p_action = 'accept' then
    if p.status not in ('review','accepted') or p.sheet_id is null then raise exception 'Identify or reopen this page before review'; end if;
    select * into s from public.paper_scan_sheets where id = p.sheet_id for update;
    perform public.validate_scan_readings(s.id,p.sheet_page,p_decisions,true);
    update public.paper_scan_pages set status = 'accepted',decisions = p_decisions,revision = revision + 1 where id = p.id returning * into p;
  elsif p_action = 'reject' then
    update public.paper_scan_pages set status = 'rejected',revision = revision + 1 where id = p.id returning * into p;
  else
    if p.sheet_id is null then raise exception 'Identify the sheet first'; end if;
    select * into s from public.paper_scan_sheets where id = p.sheet_id for update;
    if exists(select 1 from public.paper_scan_pages where sheet_id = p.sheet_id and sheet_page = p.sheet_page and status in ('review','accepted') and id <> p.id) then raise exception 'Reject the other active scan first'; end if;
    update public.paper_scan_pages set status = 'review',revision = revision + 1 where id = p.id returning * into p;
  end if;
  insert into public.paper_scan_audit(assignment_id,page_id,sheet_id,actor_id,event,detail)
  values(p.assignment_id,p.id,p.sheet_id,p_teacher_id,'manual_' || p_action,jsonb_build_object('note',p_note,'decisions',p_decisions,'revision',p.revision));
  if v_old_sheet is not null and v_old_sheet is distinct from p.sheet_id then perform public.scan_refresh_grade(v_old_sheet,p_teacher_id); end if;
  if p.sheet_id is not null then perform public.scan_refresh_grade(p.sheet_id,p_teacher_id); end if;
  return p;
end; $$;
revoke all on function public.review_scan_page(uuid,uuid,integer,text,jsonb,text,uuid,integer) from public, anon, authenticated;
grant execute on function public.review_scan_page(uuid,uuid,integer,text,jsonb,text,uuid,integer) to service_role;

-- Closing a scan assessment must leave unscanned and unresolved students pending.
alter function public.close_owned_assignment(uuid) rename to close_owned_assignment_before_scans;
revoke all on function public.close_owned_assignment_before_scans(uuid) from public, anon, authenticated;
create function public.close_owned_assignment(p_assignment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.assignments where id = p_assignment_id and created_by = auth.uid() and paper_scan_enabled) then
    update public.assignments set status = 'closed' where id = p_assignment_id and status = 'published';
    if not found then raise exception 'Only published assignments can be closed'; end if;
  else perform public.close_owned_assignment_before_scans(p_assignment_id); end if;
end; $$;
revoke all on function public.close_owned_assignment(uuid) from public, anon;
grant execute on function public.close_owned_assignment(uuid) to authenticated;

-- Trigger helpers are not RPC entry points.
revoke all on function public.enforce_scan_assignment_policy(), public.scan_publish_grade_columns(), public.protect_scan_classes(), public.guard_scan_attempt() from public, anon, authenticated;
