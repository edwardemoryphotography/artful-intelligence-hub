-- Truth-ladder promotion rules, encoded as data.
--
-- WHY THIS EXISTS
-- The per-territory rules for what counts as Merged / Deployed / Verified /
-- Live lived only inside src/pages/Home.tsx as a hand-written `derive()`
-- closure per project. That made them (a) invisible to every non-frontend
-- agent, (b) impossible to version, and (c) unattributable — no provenance,
-- no rationale, no record of who decided. This migration moves them into the
-- database as inheritable structure. The next instance reads the rules
-- instead of rediscovering them.
--
-- EXPOSURE CONTRACT
-- These tables carry owner-authored doctrine (rule names, justifications,
-- signal templates). They carry NO user content from the control plane. They
-- are readable by anon because constellation_ladder() must evaluate them for
-- the public hub; they are writable by no one but service_role.
--
-- WHY THE COLUMN IS `rule_rationale` AND NOT `rationale`
-- Do not "tidy" this back to `rationale`. routed_requests.rationale holds the
-- model's reasoning about a specific owner request — user content, never
-- exposed to anon. This column holds a doctrine justification the owner wrote.
-- Two different things that collide on one English word, and the collision is
-- load-bearing: exposure-sql.test.ts fails any migration that so much as names
-- a user-content column, and it cannot tell the two apart by name alone.
-- Renaming this column would either break that test or force someone to weaken
-- it — and weakening it is how the anon exposure surface quietly grows.
--
-- RULE MEANING IS AN OWNER DECISION
-- The seeded v1 ruleset is a faithful, behaviour-preserving transcription of
-- the client-side heuristics as they existed on 2026-08-10. Nothing was
-- retuned, tightened, or "improved" in the move. Where a stronger basis
-- exists it is seeded as status='proposed' (inert — constellation_ladder
-- evaluates only status='active') so the analysis is durable without
-- silently changing what the ladder means. Promoting a proposed rule to
-- active is a doctrine decision and requires the owner.

-- ---------------------------------------------------------------------------
-- Territories — the declared identity of each member of the flock.
-- ---------------------------------------------------------------------------
-- declared_stage is the honest fallback: what the owner asserts absent any
-- live signal. It is NOT evidence. A territory whose stage comes from here
-- is reported with basis='declared' so the UI can never present an assertion
-- as a measurement.

create table if not exists ladder_territories (
  territory text primary key,
  display_order int not null,
  declared_stage smallint not null check (declared_stage between 0 and 3),
  provenance text not null default 'unknown' check (provenance in
    ('verified', 'repository_evidence', 'runtime_evidence', 'user_confirmed',
     'inference', 'concept', 'unknown')),
  rule_rationale text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Rules — one row per (territory, candidate stage).
-- ---------------------------------------------------------------------------
-- `conditions` is a jsonb ARRAY of condition objects, ALL of which must hold
-- for the rule to fire (conjunction). Each condition:
--
--   { "kind": <signal kind>, "key": <text|null>,
--     "min_count": <int, default 1>, "repository_match": <text|null> }
--
-- Supported kinds (evaluated by constellation_ladder — extend both together):
--   route_status      count routed_requests where status = key
--   route_repository  count routed_requests where repository ilike %key%
--   evidence_status   count evidence_items  where status = key
--   evidence_kind     count evidence_items  where kind = key
--                     (+ status = 'verified' when require_verified is true)
--   action_status     count actions         where status = key
--   milestone_count   count milestones      (key ignored)
--
-- Every kind is a COUNT over a status/kind/repository column. No condition
-- can read intent, rationale, claim, or any other user-authored text — the
-- exposure contract is enforced by the shape of the rule language itself,
-- not merely by the discipline of whoever writes the next rule.
--
-- `signal_template` renders the human-facing one-liner. Placeholders are
-- {c0}, {c1}, … for the counts of conditions 0, 1, … in order.

create table if not exists ladder_rules (
  id uuid primary key default gen_random_uuid(),
  territory text not null references ladder_territories(territory) on delete cascade,
  stage smallint not null check (stage between 0 and 3),
  -- Higher priority is evaluated first. Ties break on stage desc: the
  -- highest stage a territory can justify is the stage it gets.
  priority int not null default 0,
  conditions jsonb not null,
  signal_template text not null,
  status text not null default 'active' check (status in ('active', 'proposed', 'retired')),
  provenance text not null check (provenance in
    ('verified', 'repository_evidence', 'runtime_evidence', 'user_confirmed',
     'inference', 'concept', 'unknown')),
  rule_rationale text not null,
  ruleset_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- conditions must be a non-empty array; a rule with no conditions would
  -- fire unconditionally and silently pin a territory to a stage.
  constraint ladder_rules_conditions_is_array check (
    jsonb_typeof(conditions) = 'array' and jsonb_array_length(conditions) > 0
  )
);

create index if not exists idx_ladder_rules_territory
  on ladder_rules(territory, status, priority desc, stage desc);

-- ---------------------------------------------------------------------------
-- Privileges: read-only to the world, writable only by service_role.
-- ---------------------------------------------------------------------------

alter table ladder_territories enable row level security;
alter table ladder_rules enable row level security;

revoke all on table ladder_territories, ladder_rules from public, anon, authenticated;
grant select on table ladder_territories, ladder_rules to anon, authenticated;

drop policy if exists "public read ladder_territories" on ladder_territories;
create policy "public read ladder_territories"
  on ladder_territories for select to anon, authenticated using (true);

drop policy if exists "public read ladder_rules" on ladder_rules;
create policy "public read ladder_rules"
  on ladder_rules for select to anon, authenticated using (true);

-- No insert/update/delete policy is defined for anon or authenticated, so
-- RLS denies every write from a browser regardless of grants. service_role
-- bypasses RLS and remains the only write path.

-- ---------------------------------------------------------------------------
-- Seed: v1 ruleset — transcription of the 2026-08-10 client heuristics.
-- ---------------------------------------------------------------------------

insert into ladder_territories (territory, display_order, declared_stage, provenance, rule_rationale) values
  ('Legacy Codex',   1, 3, 'inference',
   'Owner-declared Live. Live signal narrows this to what routing evidence actually supports.'),
  ('Foundry Console', 2, 2, 'inference',
   'Owner-declared Verified. Evidence rows can promote it to Live or demote it to Merged.'),
  ('Control Panel',  3, 1, 'inference',
   'Owner-declared Deployed. Action completion is the only live signal wired so far.'),
  ('System Atlas',   4, 3, 'concept',
   'Declared only — no control-plane signal is wired. Stage is an assertion, not a measurement.'),
  ('PocketForge',    5, 0, 'concept',
   'Declared only — iOS client is unstarted. Honest zero.'),
  ('Goose Cookbook', 6, 3, 'concept',
   'Declared only — doctrine lives in git, not in the control plane. No signal to read.'),
  ('LLM Wiki',       7, 3, 'concept',
   'Declared only — no control-plane signal is wired.')
on conflict (territory) do nothing;

-- Legacy Codex — Verified requires routing evidence in the repo AND a
-- confirmed route AND at least one milestone. Conjunction of three.
insert into ladder_rules (territory, stage, priority, conditions, signal_template, status, provenance, rule_rationale) values
  ('Legacy Codex', 2, 100,
   '[{"kind":"route_repository","key":"legacy-codex","min_count":1},
     {"kind":"route_status","key":"confirmed","min_count":1},
     {"kind":"milestone_count","min_count":1}]'::jsonb,
   '{c1} route confirmed · {c2} milestones',
   'active', 'inference',
   'v1 transcription of Home.tsx: routed && confirmed>0 && milestone_count>0 => Verified.'),

  ('Legacy Codex', 1, 10,
   '[{"kind":"milestone_count","min_count":0}]'::jsonb,
   'awaiting routing evidence',
   'active', 'inference',
   'v1 transcription: the else-branch floor. min_count 0 always holds, so this is the honest floor, not a measurement.'),

-- Foundry Console — verified evidence promotes to Live; a confirmed route
-- holds it at Verified; otherwise it falls to Merged.
  ('Foundry Console', 3, 100,
   '[{"kind":"evidence_status","key":"verified","min_count":1}]'::jsonb,
   '{c0} evidence verified',
   'active', 'inference',
   'v1 transcription: verifiedEvidence>0 => Live.'),

  ('Foundry Console', 2, 50,
   '[{"kind":"route_status","key":"confirmed","min_count":1}]'::jsonb,
   '{c0} route confirmed',
   'active', 'inference',
   'v1 transcription: confirmed>0 => Verified.'),

  ('Foundry Console', 0, 10,
   '[{"kind":"route_status","key":"confirmed","min_count":0}]'::jsonb,
   'no confirmed routes',
   'active', 'inference',
   'v1 transcription: the else-branch floor at Merged.'),

-- Control Panel — completed actions promote to Verified; otherwise Deployed.
  ('Control Panel', 2, 100,
   '[{"kind":"action_status","key":"DONE","min_count":1}]'::jsonb,
   '{c0} actions done',
   'active', 'inference',
   'v1 transcription: done>0 => Verified.'),

  ('Control Panel', 1, 10,
   '[{"kind":"action_status","key":"TODO","min_count":0}]'::jsonb,
   '{c0} actions queued',
   'active', 'inference',
   'v1 transcription: the else-branch floor, reporting the TODO count.')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Seeded as PROPOSED — inert until the owner activates them.
-- ---------------------------------------------------------------------------
-- Boomerang: the truth ladder already exists in the schema. evidence_items.kind
-- is ('merged_pr','live_deployment','published_artifact','confirmed_action',
-- 'test_run','custom') — that enum IS Merged/Deployed/Verified/Live, written
-- a year of doctrine before the ladder was drawn in a UI. And evidence_items
-- already carries a reality gate in a CHECK constraint: status='verified'
-- is impossible without source + observed_at + an evidence-grade provenance.
--
-- That means "never mark it Live without runtime evidence" is already
-- enforced by the database, and the v1 heuristics route around it — they
-- promote Foundry Console to Live on ANY verified evidence row regardless of
-- what kind of evidence it is, so a verified test_run currently reads as
-- Live. These proposed rules key the ladder to evidence KIND instead, which
-- is what the schema was built to say.
--
-- Activating them changes what the ladder MEANS. That is the owner's call,
-- not an agent's. To adopt:
--   update ladder_rules set status='active'  where ruleset_version=2;
--   update ladder_rules set status='retired' where ruleset_version=1 and territory='Foundry Console';

insert into ladder_rules (territory, stage, priority, conditions, signal_template, status, provenance, rule_rationale, ruleset_version) values
  ('Foundry Console', 3, 100,
   '[{"kind":"evidence_kind","key":"live_deployment","min_count":1}]'::jsonb,
   '{c0} live deployment verified',
   'proposed', 'repository_evidence',
   'v2 proposal: Live requires a VERIFIED live_deployment evidence row, not any verified row. Basis: evidence_items.kind enum + the evidence_verified_requires_reality CHECK constraint (legacy-codex 20260804010000).', 2),

  ('Foundry Console', 2, 90,
   '[{"kind":"evidence_kind","key":"test_run","min_count":1}]'::jsonb,
   '{c0} test runs verified',
   'proposed', 'repository_evidence',
   'v2 proposal: a verified test_run substantiates Verified, not Live.', 2),

  ('Foundry Console', 1, 80,
   '[{"kind":"evidence_kind","key":"merged_pr","min_count":1}]'::jsonb,
   '{c0} merged PRs recorded',
   'proposed', 'repository_evidence',
   'v2 proposal: a merged_pr evidence row substantiates Merged only. Merged != Deployed.', 2)
on conflict do nothing;

comment on table ladder_rules is
  'Truth-ladder promotion rules as data. Evaluated by constellation_ladder(). '
  'status=active is evaluated; status=proposed is durable analysis awaiting an owner decision. '
  'Changing a rule''s meaning is a doctrine decision — see the migration header.';
