-- One delivery per issued student paper. Uncertain Gmail outcomes are never
-- retried automatically: Gmail does not offer an idempotent send operation.
create table public.paper_feedback_deliveries (
  sheet_id uuid primary key references public.paper_scan_sheets(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  recipient text not null,
  status text not null check (status in ('preparing','sending','sent','failed','uncertain')),
  claim_token uuid not null default gen_random_uuid(),
  fingerprint text not null,
  message_id text,
  error text,
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.paper_feedback_deliveries enable row level security;
revoke all on public.paper_feedback_deliveries from public, anon, authenticated;
grant all on public.paper_feedback_deliveries to service_role;
create index paper_feedback_assignment on public.paper_feedback_deliveries(assignment_id);

-- Returns NULL unless the exact issued paper has a complete, final grade.
-- The snapshot also detects edits while the PDF is being prepared.
create function public.paper_feedback_fingerprint(p_sheet uuid, p_teacher uuid)
returns text language sql stable security definer set search_path = '' as $$
  select md5(jsonb_build_object(
    'sheet', to_jsonb(s), 'title', a.title, 'recipient', p.email,
    'grade', to_jsonb(g),
    'pages', (select jsonb_agg(to_jsonb(pg) order by pg.sheet_page)
      from public.paper_scan_pages pg where pg.sheet_id=s.id and pg.status in ('accepted','review')),
    'responses', (select jsonb_agg(to_jsonb(r) order by r.question_id)
      from public.responses r where r.attempt_id=g.id),
    'questions', (select jsonb_agg(jsonb_build_object('question',to_jsonb(q),'key',to_jsonb(k)) order by q.id)
      from jsonb_array_elements(s.questions) slot
      join public.questions q on q.id=(slot->>'questionId')::uuid
      join public.question_keys k on k.question_id=q.id)
  )::text)
  from public.paper_scan_sheets s
  join public.assignments a on a.id=s.assignment_id
  join public.profiles p on p.id=s.student_id
  join public.attempts g on g.id=s.attempt_id and g.assignment_id=s.assignment_id and g.student_id=s.student_id
  where s.id=p_sheet and a.created_by=p_teacher and a.paper_scan_enabled
    and a.status in ('published','closed') and a.archived_at is null
    and exists(select 1 from public.profiles t where t.id=p_teacher and t.role='teacher')
    and p.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and g.status='submitted' and g.score is not null and g.max_score > 0
    and not exists(select 1 from public.paper_scan_pages pg where pg.sheet_id=s.id and pg.status='review')
    and (select count(*) from public.paper_scan_pages pg where pg.sheet_id=s.id and pg.status='accepted')
      = (jsonb_array_length(s.questions)+59)/60
    and not exists(select 1 from generate_series(1,(jsonb_array_length(s.questions)+59)/60) n
      where not exists(select 1 from public.paper_scan_pages pg where pg.sheet_id=s.id and pg.sheet_page=n and pg.status='accepted'))
    and (select count(*) from public.responses r where r.attempt_id=g.id)=jsonb_array_length(s.questions)
    and not exists(select 1 from jsonb_array_elements(s.questions) slot
      where not exists(select 1 from public.responses r
        where r.attempt_id=g.id and r.question_id=(slot->>'questionId')::uuid
          and r.is_correct is not null and r.points_awarded is not null));
$$;
revoke all on function public.paper_feedback_fingerprint(uuid,uuid) from public, anon, authenticated;
grant execute on function public.paper_feedback_fingerprint(uuid,uuid) to service_role;

create function public.claim_paper_feedback(p_sheet uuid, p_teacher uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.paper_scan_sheets; d public.paper_feedback_deliveries; f text; recipient_email text;
begin
  -- Serialize concurrent clicks, including the first insert.
  perform pg_advisory_xact_lock(hashtext('paper-feedback'),hashtext(p_sheet::text));
  f := public.paper_feedback_fingerprint(p_sheet,p_teacher);
  if f is null then return jsonb_build_object('claimed',false,'reason','not_ready'); end if;
  select * into d from public.paper_feedback_deliveries where sheet_id=p_sheet for update;
  if found and (d.status in ('sent','sending','uncertain') or
    (d.status='preparing' and d.updated_at > now()-interval '5 minutes')) then
    return jsonb_build_object('claimed',false,'reason',d.status);
  end if;
  select * into s from public.paper_scan_sheets where id=p_sheet;
  select email into recipient_email from public.profiles where id=s.student_id;
  insert into public.paper_feedback_deliveries(sheet_id,assignment_id,teacher_id,recipient,status,fingerprint)
  values(s.id,s.assignment_id,p_teacher,recipient_email,'preparing',f)
  on conflict(sheet_id) do update set status='preparing',claim_token=gen_random_uuid(),
    fingerprint=excluded.fingerprint,recipient=excluded.recipient,error=null,updated_at=now()
  returning * into d;
  return jsonb_build_object('claimed',true,'delivery',to_jsonb(d));
end; $$;
revoke all on function public.claim_paper_feedback(uuid,uuid) from public, anon, authenticated;
grant execute on function public.claim_paper_feedback(uuid,uuid) to service_role;

create function public.begin_paper_feedback_send(p_sheet uuid, p_teacher uuid, p_claim uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare d public.paper_feedback_deliveries;
begin
  select * into d from public.paper_feedback_deliveries
    where sheet_id=p_sheet and teacher_id=p_teacher and claim_token=p_claim for update;
  if not found or d.status <> 'preparing' or d.updated_at <= now()-interval '5 minutes' then return false; end if;
  if public.paper_feedback_fingerprint(p_sheet,p_teacher) is distinct from d.fingerprint then
    update public.paper_feedback_deliveries set status='failed',error='This paper changed. Refresh and retry.',updated_at=now() where sheet_id=p_sheet;
    return false;
  end if;
  update public.paper_feedback_deliveries set status='sending',updated_at=now() where sheet_id=p_sheet;
  return true;
end; $$;
revoke all on function public.begin_paper_feedback_send(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.begin_paper_feedback_send(uuid,uuid,uuid) to service_role;
