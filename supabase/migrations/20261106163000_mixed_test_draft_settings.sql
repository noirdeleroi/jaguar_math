-- Keep mode changes and the established settings/class validator transactional.
create function public.update_owned_mixed_draft(p_assignment_id uuid, p_settings jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.assignments; v_classes uuid[]; v_kind text; v_scan boolean;
begin
  select * into a from public.assignments where id = p_assignment_id and created_by = auth.uid() and status = 'draft' for update;
  if not found or not exists(select 1 from public.profiles where id = auth.uid() and role = 'teacher') then raise exception 'Draft is not available'; end if;
  v_kind := p_settings->>'kind'; v_scan := coalesce((p_settings->>'paper_scan_enabled')::boolean,false);
  if v_scan and v_kind <> 'paper' then raise exception 'Mixed Tests use paper mode'; end if;
  select array_agg(value::uuid) into v_classes from jsonb_array_elements_text(p_settings->'class_ids');
  update public.assignments set paper_scan_enabled = false where id = a.id;
  -- The paper wrapper temporarily uses test mode for legacy version validation.
  if v_kind = 'paper' then
    perform public.update_owned_paper_assignment_ready(a.id,p_settings->>'title',p_settings->>'description',v_kind,(p_settings->>'due_at')::timestamptz,
      (p_settings->>'duration_minutes')::integer,(p_settings->>'max_attempts')::integer,(p_settings->>'show_score_after_submit')::boolean,(p_settings->>'show_answers_after_submit')::boolean,
      (p_settings->>'shuffle_questions')::boolean,(p_settings->>'shuffle_options')::boolean,v_classes,(p_settings->>'exam_mode')::boolean,(p_settings->>'exam_require_fullscreen')::boolean,
      (p_settings->>'exam_track_focus_exits')::boolean,(p_settings->>'exam_allowed_focus_exits')::integer,p_settings->>'exam_violation_action',p_settings->>'question_display_mode',(p_settings->>'show_feedback_after_each_question')::boolean);
  else
    perform public.update_owned_assignment_ready(a.id,p_settings->>'title',p_settings->>'description',v_kind,(p_settings->>'due_at')::timestamptz,
      (p_settings->>'duration_minutes')::integer,(p_settings->>'max_attempts')::integer,(p_settings->>'show_score_after_submit')::boolean,(p_settings->>'show_answers_after_submit')::boolean,
      (p_settings->>'shuffle_questions')::boolean,(p_settings->>'shuffle_options')::boolean,v_classes,(p_settings->>'exam_mode')::boolean,(p_settings->>'exam_require_fullscreen')::boolean,
      (p_settings->>'exam_track_focus_exits')::boolean,(p_settings->>'exam_allowed_focus_exits')::integer,p_settings->>'exam_violation_action',p_settings->>'question_display_mode',(p_settings->>'show_feedback_after_each_question')::boolean);
  end if;
  update public.assignments set paper_scan_enabled = v_scan,
    include_in_class_manager = v_scan or coalesce((p_settings->>'include_in_class_manager')::boolean,false),
    paper_answer_duration_seconds = (p_settings->>'paper_answer_duration_seconds')::integer,
    allow_graphing_calculator = (p_settings->>'allow_graphing_calculator')::boolean,
    teacher_controlled_question_release = (p_settings->>'teacher_controlled_question_release')::boolean where id = a.id;
end; $$;
revoke all on function public.update_owned_mixed_draft(uuid,jsonb) from public,anon;
grant execute on function public.update_owned_mixed_draft(uuid,jsonb) to authenticated;

create function public.lock_published_scan_mode()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.paper_scan_enabled and not old.paper_scan_enabled and old.status <> 'draft' then raise exception 'Choose Mixed Test before publishing'; end if;
  return new;
end; $$;
create trigger assignments_scan_mode_lock before update on public.assignments for each row execute function public.lock_published_scan_mode();
revoke all on function public.lock_published_scan_mode() from public,anon,authenticated;
