# Artful Intelligence — One Home for the Whole Flock

Unified hub UI for the Legacy Codex / Artful Intelligence ecosystem. Dark-first,
Gemini-inspired, reading the live foundry-console routing control plane.

## Doctrine (read before touching anything)

1. `codex-system-architecture/notion-wiki/docs/GOOSE-COOKBOOK.md` — canonical doctrine
   (Goose Principle, CATCH THE FUCKING BOOMERANG, MasterChef of Geese, Fear-Based DevOps).
2. `codex-system-architecture/docs/PROMPTS/flock-hub-wiring.md` — the wiring mission.
3. **[`docs/FLOCK-HUB-RUNBOOK.md`](docs/FLOCK-HUB-RUNBOOK.md)** — what previous
   instances learned the hard way. Read it before writing backend code; it will
   save you from at least three dead ends.
4. The truth ladder is law: `Merged != Deployed != Runtime Verified != Live`.

## State of this repo — by rung, not by vibes

| Thing | Rung | How we know |
|---|---|---|
| `constellation_status()` | **Live** | Applied to foundry-console and returning real data (verified 2026-08-10, before this branch) |
| Hub UI, theme, ladder rendering | **Live** | Deployed and in use |
| `ladder_rules` / `ladder_territories` | **Merged** | Migration authored; **not applied** to any project |
| `constellation_ladder()` | **Merged** | Migration authored; **not applied**. The client falls back to the v1 mirror and says so on screen |
| `flock-ask` Edge Function | **Merged** | Written; **not deployed**, no secrets set |
| Owner magic-link sign-in | **Merged** | Written; **not exercised** against real auth |
| Realtime subscriptions | **Merged** | Written; **never observed delivering a row** |
| typecheck / lint / test / build | **Verified** | All four green — see below |

Nothing above was runtime-verified against foundry-console from the machine that
wrote it: `*.supabase.co` is blocked by the agent sandbox's network policy
(runbook §7). A green build is not a working integration. Follow the runbook's
deployment checklist and update this table with the evidence you gathered.

## What exists

- `src/pages/Home.tsx` — the hub: theme toggle (dark default, `?theme=` override,
  localStorage), truth-ladder cards, control-plane pulse, command bar.
- `src/lib/ladder.ts` — shared ladder types, the declared flock, and the
  client-side v1 mirror used only when the control plane is unreachable.
- `src/lib/exposure.ts` — runtime enforcement of the anon exposure contract.
  Every RPC response is walked before use; a payload carrying a user-content
  field is refused rather than rendered.
- `src/hooks/useConstellation.ts` — 45s polling always, realtime when signed in.
- `src/hooks/useOwnerSession.ts` — magic-link auth. No service-role key ships
  to the browser, ever.
- `supabase/migrations/` — `constellation_status`, `ladder_rules`,
  `constellation_ladder`.
- `supabase/functions/flock-ask/` — owner-gated, doctrine-grounded command bar.
  Proposes routes; persists only on explicit confirmation, via
  `persist_route_atomic`.

## Stack

React 19 + TypeScript + Vite 7 + Tailwind 3 + `@supabase/supabase-js`.

```bash
npm install
npm run dev
npm run typecheck && npm run lint && npm test && npm run build
```

## Rules for agents

- Never weaken the exposure contract of the constellation functions (aggregates
  only, no user-authored text). RLS stays authenticated-only on control-plane
  tables. `src/lib/__tests__/exposure-sql.test.ts` enforces this at commit time —
  if it fails, fix the migration, not the test.
- All route writes go through `persist_route_atomic`. The browser cannot call
  it (runbook §2) — this is a grant, not a convention.
- Ladder rule *meaning* is an owner decision. A v2 ruleset sits in the database
  as `status='proposed'`; activating it changes what the ladder claims.
- Green build != working integration. Say what you verified and how.
- Before closing: what did this teach the system that the next instance should
  not have to rediscover? Put it in the runbook.
