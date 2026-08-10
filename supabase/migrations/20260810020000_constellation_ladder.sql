-- constellation_ladder(): server-side evaluation of the truth ladder.
--
-- WHY THIS EXISTS
-- The ladder was derived in the browser. That put the rules in one client,
-- in one language, reachable by no other agent, and made every consumer of
-- the control plane responsible for reimplementing them. This function makes
-- the database the single place the ladder is computed. The client keeps a
-- fallback implementation for when the control plane is unreachable, and a
-- test asserts the two cannot drift.
--
-- EXPOSURE CONTRACT (identical to constellation_status — do not weaken)
--   * SECURITY DEFINER, but returns ONLY: territory names, integer stages,
--     counts, rule provenance, and owner-authored template strings.
--   * NEVER intent, rationale, claim, required_evidence, action_title, or any
--     other user-authored text. The rule language cannot express reading them.
--   * RLS on routed_requests / evidence_items / events / actions stays
--     authenticated-only. This function is a reviewed, deliberate exception
--     in exactly the same shape as constellation_status().
--
-- HONESTY REQUIREMENT
-- Every returned row carries `basis`:
--   'rule'     — a live signal satisfied an active rule. A measurement.
--   'declared' — no rule fired. The stage is the owner's assertion, and the
--                UI must not present it as evidence.
-- A territory with no rules at all is always 'declared'. Never invent a
-- measurement for a territory nothing is wired to.

-- ---------------------------------------------------------------------------
-- Condition evaluator. Internal — not callable by anon or authenticated.
-- ---------------------------------------------------------------------------
-- Returns the COUNT for a single condition object. Every branch is a count
-- over a status / kind / repository column. There is deliberately no branch
-- that can return text: the rule language is incapable of leaking content.

create or replace function public.ladder_condition_count(cond jsonb)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  k    text := cond ->> 'kind';
  key  text := cond ->> 'key';
  repo text := cond ->> 'repository_match';
  n    bigint := 0;
begin
  -- actions and milestones are created by migrations owned by other repos in
  -- the ecosystem and may legitimately be absent on a fresh stack. An absent
  -- table is zero signal, not an error that takes the whole hub down.
  case k

    when 'route_status' then
      select count(*) into n from routed_requests r
       where r.status = key
         and (repo is null or r.repository ilike '%' || repo || '%');

    when 'route_repository' then
      select count(*) into n from routed_requests r
       where r.repository ilike '%' || key || '%';

    when 'evidence_status' then
      select count(*) into n from evidence_items e
       where e.status = key;

    when 'evidence_kind' then
      -- Evidence of a KIND only counts when it is itself verified. The
      -- evidence_verified_requires_reality CHECK constraint guarantees a
      -- verified row has a source and an observed_at, so this cannot promote
      -- a territory on an unsubstantiated claim.
      select count(*) into n from evidence_items e
       where e.kind = key and e.status = 'verified';

    when 'action_status' then
      if to_regclass('public.actions') is null then
        n := 0;
      else
        execute 'select count(*) from actions where status = $1' into n using key;
      end if;

    when 'milestone_count' then
      if to_regclass('public.milestones') is null then
        n := 0;
      else
        execute 'select count(*) from milestones' into n;
      end if;

    else
      -- Unknown kind: contribute no signal rather than guessing. A rule
      -- referencing an unsupported kind simply never fires.
      n := 0;
  end case;

  return coalesce(n, 0);
end;
$$;

revoke all on function public.ladder_condition_count(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- constellation_ladder()
-- ---------------------------------------------------------------------------

create or replace function public.constellation_ladder()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  terr        record;
  rule        record;
  cond        jsonb;
  cond_count  bigint;
  counts      bigint[];
  satisfied   boolean;
  signal_text text;
  idx         int;
  rows_out    jsonb := '[]'::jsonb;
  matched     boolean;
begin
  for terr in
    select * from ladder_territories order by display_order
  loop
    matched := false;

    for rule in
      select * from ladder_rules
       where territory = terr.territory
         and status = 'active'
       order by priority desc, stage desc
    loop
      satisfied := true;
      counts    := array[]::bigint[];

      for cond in select * from jsonb_array_elements(rule.conditions)
      loop
        cond_count := ladder_condition_count(cond);
        counts     := counts || cond_count;
        if cond_count < coalesce((cond ->> 'min_count')::int, 1) then
          satisfied := false;
        end if;
      end loop;

      if satisfied then
        -- Render {c0}, {c1}, … from the counts collected above.
        signal_text := rule.signal_template;
        for idx in 1 .. coalesce(array_length(counts, 1), 0) loop
          signal_text := replace(signal_text, '{c' || (idx - 1) || '}', counts[idx]::text);
        end loop;

        rows_out := rows_out || jsonb_build_object(
          'territory',  terr.territory,
          'stage',      rule.stage,
          'signal',     signal_text,
          'basis',      'rule',
          'provenance', rule.provenance,
          'rule_id',    rule.id,
          'ruleset_version', rule.ruleset_version
        );
        matched := true;
        exit;
      end if;
    end loop;

    if not matched then
      -- No active rule fired. Report the declared stage and say so plainly.
      rows_out := rows_out || jsonb_build_object(
        'territory',  terr.territory,
        'stage',      terr.declared_stage,
        'signal',     null,
        'basis',      'declared',
        'provenance', terr.provenance,
        'rule_id',    null,
        'ruleset_version', null
      );
    end if;
  end loop;

  return jsonb_build_object(
    'generated_at', now(),
    'territories',  rows_out
  );
end;
$$;

revoke all on function public.constellation_ladder() from public;
grant execute on function public.constellation_ladder() to anon, authenticated;

comment on function public.constellation_ladder() is
  'Anon-safe truth-ladder evaluation. Returns per-territory stage, signal, and basis '
  '(rule|declared). Aggregates only — never user-authored text. Rules live in ladder_rules.';
