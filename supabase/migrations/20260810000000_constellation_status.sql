-- constellation_status(): public, anon-safe aggregate of the foundry-console
-- routing control plane for the Artful Intelligence unified hub.
--
-- Exposure contract (do not weaken):
--   * SECURITY DEFINER, but returns ONLY coarse aggregates: counts, statuses,
--     lanes, repositories, timestamps.
--   * NEVER intent text, action titles, rationales, or any user-authored content.
--   * RLS on routed_requests / evidence_items / events / actions stays
--     authenticated-only; this function is the deliberate, reviewed exception.
--
-- Applied to foundry-console (pkydkbuodikttfeawqsw) on 2026-08-10 via three
-- iterations (bad aggregates caught in testing before the working version
-- shipped). Fear-Based DevOps: the function failed twice under test and was
-- fixed before being declared verified.

create or replace function public.constellation_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'generated_at', now(),
    'route_status_counts', coalesce((
      select jsonb_object_agg(status, n) from (select status, count(*) as n from routed_requests group by status) s
    ), '{}'::jsonb),
    'route_lanes', coalesce((
      select jsonb_agg(distinct execution_lane) from routed_requests where execution_lane is not null
    ), '[]'::jsonb),
    'route_repos', coalesce((
      select jsonb_agg(distinct repository) from routed_requests where repository is not null
    ), '[]'::jsonb),
    'route_latest_at', (select max(created_at) from routed_requests),
    'evidence_status_counts', coalesce((
      select jsonb_object_agg(status, n) from (select status, count(*) as n from evidence_items group by status) s
    ), '{}'::jsonb),
    'evidence_latest_at', (select max(created_at) from evidence_items),
    'action_status_counts', coalesce((
      select jsonb_object_agg(status, n) from (select status, count(*) as n from actions group by status) s
    ), '{}'::jsonb),
    'recent_event_kinds', coalesce((
      select jsonb_agg(jsonb_build_object('action', action, 'target_type', target_type, 'at', created_at))
      from (select action, target_type, created_at from events order by created_at desc limit 8) e
    ), '[]'::jsonb),
    'milestone_count', (select count(*) from milestones)
  ) into result;
  return result;
end;
$$;

revoke all on function public.constellation_status() from public;
grant execute on function public.constellation_status() to anon, authenticated;
