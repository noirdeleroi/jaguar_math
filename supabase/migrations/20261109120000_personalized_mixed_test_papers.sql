-- New Mixed Test sheets select each question variant and option order independently.
-- Existing issued sheets/QR identities retain their exact composition and grading.
create or replace function public.prepare_owned_scan_sheets(p_assignment_id uuid)
returns setof public.paper_scan_sheets language plpgsql security definer set search_path = '' as $$
declare a public.assignments; member record;  v_questions jsonb;
begin
  select * into a from public.assignments where id = p_assignment_id and created_by = auth.uid()
    and paper_scan_enabled and status in ('published', 'closed') and archived_at is null;
  if not found or not exists(select 1 from public.profiles where id = auth.uid() and role = 'teacher') then raise exception 'Mixed Test is not available'; end if;
  perform pg_advisory_xact_lock(hashtext(p_assignment_id::text));
  for member in
    select distinct on (m.student_id) m.student_id, m.class_id, c.name as class_name,
      coalesce(p.full_name, m.nickname, p.email, 'Student') as student_name,
      coalesce(r.gradebook_code, left(m.student_id::text, 8)) as student_code
    from public.assignment_classes ac join public.classes c on c.id = ac.class_id
    join public.class_members m on m.class_id = c.id join public.profiles p on p.id = m.student_id and p.role = 'student'
    left join public.class_gradebook_students r on r.class_id = c.id and r.student_id = m.student_id
    where ac.assignment_id = p_assignment_id order by m.student_id, c.name, m.class_id
  loop
    -- Issued papers never change, including sheets from the original four-form mode.
    if exists(select 1 from public.paper_scan_sheets where assignment_id = p_assignment_id and student_id = member.student_id) then continue; end if;
    select jsonb_agg(jsonb_build_object(
      'position', aq.position, 'questionId', chosen.question_id, 'points', aq.points,
      'options', jsonb_build_array('A','B','C','D'), 'variantIndex', chosen.variant_index,
      'optionOrder', shuffled.ids) order by aq.position) into v_questions
    from public.assignment_questions aq
    cross join lateral (
      select candidates.question_id, candidates.variant_index from (
        select aq.question_id, 1 as variant_index
        union all
        select av.question_id, av.variant_index from public.assignment_question_variants av
        where av.assignment_id = p_assignment_id and av.slot_position = aq.position
      ) candidates
      order by md5('variant:' || p_assignment_id::text || ':' || member.student_id::text || ':' || aq.position::text || ':' || candidates.variant_index::text), candidates.variant_index
      limit 1
    ) chosen
    cross join lateral (
      select jsonb_agg(o.id order by md5('option:' || p_assignment_id::text || ':' || member.student_id::text || ':' || aq.position::text || ':' || o.id), o.id) as ids
      from unnest(array['A','B','C','D']) o(id)
    ) shuffled
    where aq.assignment_id = p_assignment_id;
    if v_questions is null then raise exception 'Mixed Test needs a valid question set'; end if;
    insert into public.paper_scan_sheets(assignment_id, student_id, class_id, student_name, student_code, class_name, version, questions)
    values(p_assignment_id, member.student_id, member.class_id, member.student_name, member.student_code, member.class_name, 1, v_questions)
    on conflict (assignment_id, student_id) do nothing;
  end loop;
  return query select * from public.paper_scan_sheets where assignment_id = p_assignment_id order by class_name, student_name, student_id;
end; $$;

-- Scan choices are printed letters. Store source option IDs for the canonical grader.
create or replace function public.scan_refresh_grade(p_sheet_id uuid, p_actor uuid)
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
    values(s.assignment_id,s.student_id,1,case when s.questions->0 ? 'optionOrder' then 'Paper ' || upper(left(s.id::text,8)) else 'Version ' || s.version end,now()) returning id into v_attempt;
    insert into public.attempt_questions(attempt_id,question_id,position,slot_position,points,option_order)
    select v_attempt, (q->>'questionId')::uuid, (q->>'position')::integer, (q->>'position')::integer, (q->>'points')::numeric, array(select jsonb_array_elements_text(coalesce(q->'optionOrder','["A","B","C","D"]'::jsonb)))
    from jsonb_array_elements(s.questions) q;
    update public.paper_scan_sheets set attempt_id = v_attempt where id = s.id;
  else
    update public.attempts set status = 'in_progress', submitted_at = null, score = null, max_score = null where id = v_attempt;
  end if;
  insert into public.responses(attempt_id,question_id,student_answer)
  select v_attempt,(q->>'questionId')::uuid,
    case when r->>'choice' in ('A','B','C','D') then
      coalesce(q->'optionOrder','["A","B","C","D"]'::jsonb)->>(strpos('ABCD',r->>'choice')-1)
    else null end
  from public.paper_scan_pages p cross join lateral jsonb_array_elements(coalesce(p.decisions,p.readings)) r
  join lateral jsonb_array_elements(s.questions) q on (q->>'position')::integer = (r->>'position')::integer
  where p.sheet_id = s.id and p.status = 'accepted'
  on conflict (attempt_id,question_id) do update set student_answer = excluded.student_answer, is_correct = null, points_awarded = null, updated_at = now();
  perform public.finalize_attempt_unchecked(v_attempt);
  insert into public.paper_scan_audit(assignment_id,sheet_id,actor_id,event,detail)
  select s.assignment_id,s.id,p_actor,'grade_finalized',jsonb_build_object('attemptId',id,'score',score,'maxScore',max_score)
  from public.attempts where id = v_attempt;
end; $$;
