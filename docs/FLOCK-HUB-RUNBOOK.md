# Flock Hub Runbook

What the next instance should not have to rediscover. Each entry is a thing
that cost real time to establish, with the evidence that settles it.

---

## 1. Where the ladder rules live

`ladder_rules` + `ladder_territories` (migration `20260810010000`), evaluated by
`constellation_ladder()` (migration `20260810020000`). **Not** in `Home.tsx`.

`src/lib/ladder.ts` holds a *mirror* of the active v1 ruleset for the offline
path only. It is not a second source of truth, and
`src/lib/__tests__/ladder.test.ts` parses the seed migration and fails if the
two disagree about any territory's declared stage or ordering. If that test
fails, change the migration first and mirror it into the client — never the
reverse.

Changing what a rule *means* is a doctrine decision and needs the owner. The v1
seed is a behaviour-preserving transcription of the 2026-08-10 client
heuristics; nothing was retuned in the move.

---

## 2. The browser cannot write a route. At all.

`persist_route_atomic(jsonb)` is granted to `service_role` and explicitly
revoked from `public, anon, authenticated`:

> `legacy-codex/supabase/migrations/20260804020000_routing_control_plane_hardening.sql:447-448`
> ```sql
> revoke all on function persist_route_atomic(jsonb) from public, anon, authenticated;
> grant execute on function persist_route_atomic(jsonb) to service_role;
> ```

An authenticated owner session is **not** sufficient. Any design that has the
SPA calling this RPC directly is wrong and will fail at runtime with a
permission error, no matter how the auth is written. Route writes go through
the `flock-ask` Edge Function, which holds the service-role key server-side.

**`persist_route_owner` does not exist.** It is named in the wiring brief but
appears in no migration in `legacy-codex` or `codex-system-architecture`. Don't
go looking for it; `persist_route_atomic` is the single write path.

---

## 3. Control Panel's auth is not a magic-link pattern

The brief says to "reuse the magic-link pattern already proven in Control
Panel". Reading `codex-control-panel`, that pattern is not there:

- `lib/supabase-server.ts` builds a **service-role** client from
  `SUPABASE_SERVICE_ROLE_KEY` (server-side only).
- `app/api/route/persist/route.ts` gates on a shared **`APP_ACCESS_TOKEN`**
  compared with `timingSafeEqual`.
- Grep for "magic" across that repo hits only `package-lock.json`.

That design works because Next.js gives it a server. The hub is a static Vite
SPA with nowhere to hold a secret, so it uses real Supabase Auth
(`signInWithOtp`) instead: the browser holds a user JWT, never a privileged
key, and privileged work happens in the Edge Function. Same destination, correct
mechanism for a client with no server — and the brief's actual constraint
("no service-role key in the browser") is preserved exactly.

---

## 4. The truth ladder already existed in the schema (boomerang)

`evidence_items.kind` is:

```
('merged_pr', 'live_deployment', 'published_artifact', 'confirmed_action', 'test_run', 'custom')
```

That enum **is** Merged / Deployed / Verified / Live, written into the schema
before the ladder was ever drawn in a UI. And `evidence_items` already carries
a reality gate as a CHECK constraint — `status = 'verified'` is impossible
without `source`, `observed_at`, and an evidence-grade provenance
(`legacy-codex/.../20260804010000_routing_control_plane.sql`).

So "never mark it Live without runtime evidence" is enforced by the database,
and the v1 heuristics route around it: they promote Foundry Console to Live on
*any* verified evidence row, so a verified `test_run` currently reads as Live.

A v2 ruleset keyed to evidence *kind* is seeded as `status='proposed'` — inert,
durable, and awaiting an owner decision. To adopt:

```sql
update ladder_rules set status='active'  where ruleset_version = 2;
update ladder_rules set status='retired' where ruleset_version = 1 and territory = 'Foundry Console';
```

---

## 5. Realtime is owner-only, structurally

Supabase Realtime applies RLS to `postgres_changes`. `routed_requests`,
`evidence_items`, and `events` are authenticated-only, so an anon visitor
subscribes **successfully** and then never receives a row — a "live" indicator
incapable of ever updating. `useConstellation` therefore attaches realtime only
when a session exists, and always polls (45s) underneath. Don't "fix" the anon
case by subscribing anyway.

---

## 6. `ladder_rules.rule_rationale` is named that on purpose

`routed_requests.rationale` is user content and must never reach anon.
`ladder_rules.rule_rationale` is owner-authored doctrine and is public. Two
different things colliding on one English word.

`src/lib/__tests__/exposure-sql.test.ts` fails any migration that so much as
*names* a user-content column — deliberately blunt, because a subtler check is
one an agent can talk itself past. Renaming this column back to `rationale`
would either break that test or force someone to weaken it, and weakening it is
how the anon exposure surface quietly grows.

---

## 7. Runtime verification cannot happen from the agent sandbox

`*.supabase.co` is blocked by this environment's network policy:

```
$ curl -sS "$HTTPS_PROXY/__agentproxy/status"
"detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
"host": "pkydkbuodikttfeawqsw.supabase.co:443"
```

An agent working here can reach **Merged** and nothing further. Do not let a
green `npm run build` be reported as Deployed or Verified — the ladder is law
about our own work too. Runtime verification has to happen from a machine that
can reach the project (see the checklist below).

---

## 8. The command bar has two brains. Do not disable the one that works.

`flock-ask` is owner-gated, not deployed from this sandbox, and needs secrets.
A command bar that is a no-op until sign-in is a dead surface for almost every
visitor — including the agent verifying the hub.

`src/lib/localAsk.ts` restates what is already on screen (ladder entries,
aggregates, declared identity). It is not a second source of truth and must
never promote a declared stage into a measurement. Chips are generated from
the current reading (`adaptiveChips`); static prompt starters pretend the
flock is always in the same state.

Unsigned visitors get a local reading immediately. An owner session may
additionally call flock-ask; if that function 401s or 503s, the local reading
stands and the UI says so. Route writes still cannot happen in the browser
(§2).

PostgREST driver text ("Unregistered API key", PGRST codes) must not appear
on the provenance line. `humanizeControlPlaneError` maps those to a failure
class; the raw string stays in the network tab.

---

## Deployment checklist (run from a machine that can reach Supabase)

Nothing below has been executed. Each step ends with the evidence that would
promote it a rung.

1. **Apply the migrations, in order.**
   ```bash
   supabase db push          # or apply each file against foundry-console
   ```
   Evidence for *Deployed*: both functions present in `pg_proc`.

2. **Verify the anon contract against the live project.**
   ```bash
   curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/constellation_ladder" \
     -H "apikey: $PUBLISHABLE_KEY" -H "Authorization: Bearer $PUBLISHABLE_KEY" \
     -H "Content-Type: application/json" -d '{}' | jq 'keys, .territories[0]'
   ```
   Evidence for *Runtime Verified*: real aggregates, and no `intent`,
   `rationale`, `claim`, `required_evidence`, `source`, or `action_title`
   anywhere in the response. Paste the response keys into the PR.

3. **Confirm the ladder agrees with the client mirror.** Compare
   `constellation_ladder()` output against what the hub renders with the
   function removed. A divergence means the SQL and `deriveLadderFallback`
   disagree — fix the client, not the SQL.

4. **Deploy `flock-ask` and set its secrets.**
   ```bash
   supabase functions deploy flock-ask
   supabase secrets set ANTHROPIC_API_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
     FOUNDRY_WORKSPACE_ID=... FLOCK_OWNER_EMAIL=... [GOOSE_COOKBOOK_URL=...]
   ```
   Without `SUPABASE_SERVICE_ROLE_KEY` and `FOUNDRY_WORKSPACE_ID` the function
   returns an honest 503 on `mode=persist` rather than pretending to write.

5. **Exercise both paths.** `mode=ask` with no session must 401.
   `mode=persist` without `confirm:true` must 400. Only then try a real route.

6. **Check realtime actually delivers.** Sign in, write a row, watch the pulse
   update without a refresh. Subscribing successfully is not the same as
   receiving rows — that's the whole point of §5.

`Merged != Deployed != Runtime Verified != Live.` Say which rung you reached and
how you know.
