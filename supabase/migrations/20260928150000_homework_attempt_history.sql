-- Restore explicit homework submission while keeping deadline finalization as
-- a safety net. The mature implementations below enforce student ownership,
-- assignment state, timestamps, response membership, revision ordering, and
-- atomic grading. Each finalized row remains a distinct numbered attempt.

create or replace function public.submit_attempt(p_attempt_id uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.submit_attempt_before_deadline_only_homework(p_attempt_id);
end;
$$;

revoke all on function public.submit_attempt(uuid) from public, anon;
grant execute on function public.submit_attempt(uuid) to authenticated;

create or replace function public.submit_attempt_snapshot(
  p_attempt_id uuid,
  p_responses jsonb,
  p_client_submitted_at timestamptz,
  p_timed boolean default false
)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.submit_attempt_snapshot_before_deadline_only_homework(
    p_attempt_id,
    p_responses,
    p_client_submitted_at,
    p_timed
  );
end;
$$;

revoke all on function public.submit_attempt_snapshot(uuid, jsonb, timestamptz, boolean)
  from public, anon;
grant execute on function public.submit_attempt_snapshot(uuid, jsonb, timestamptz, boolean)
  to authenticated;
