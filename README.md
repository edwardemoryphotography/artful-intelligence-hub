# Artful Intelligence — One Home for the Whole Flock

Unified hub UI for the Legacy Codex / Artful Intelligence ecosystem. Dark-first,
Gemini-inspired, reading the live foundry-console routing control plane.

## Doctrine (read before touching anything)

1. `codex-system-architecture/notion-wiki/docs/GOOSE-COOKBOOK.md` — canonical doctrine
   (Goose Principle, CATCH THE FUCKING BOOMERANG, MasterChef of Geese, Fear-Based DevOps).
2. `codex-system-architecture/docs/PROMPTS/flock-hub-wiring.md` — the wiring mission
   (backend, intelligence, ladder canonization).
3. The truth ladder is law: `Merged != Deployed != Runtime Verified != Live`.

## What exists and is verified (2026-08-10)

- `src/pages/Home.tsx` — the hub: theme toggle (dark default, `?theme=` override,
  localStorage persist), truth-ladder project cards, control-plane event pulse.
- `supabase/migrations/20260810000000_constellation_status.sql` — the anon-safe
  SECURITY DEFINER aggregate the UI calls via `supabase.rpc('constellation_status')`.
  Already applied to foundry-console (`pkydkbuodikttfeawqsw`) and verified returning
  real data. Ladder stages derive client-side from those signals (first-pass
  heuristics — canonization into `ladder_rules` is open work).

## Stack

React 19 + TypeScript + Vite 7 + Tailwind 3 + @supabase/supabase-js.

```bash
npm install
npm run dev
npm run build
```

## Rules for agents

- Never weaken the exposure contract of `constellation_status()` (aggregates only,
  no user-authored text). RLS stays authenticated-only on control-plane tables.
- All writes go through `persist_route_owner` / `persist_route_atomic` — no side-channel inserts.
- Green build != working integration. Say what you verified and how.
- Final test before closing: what did this teach the system that the next instance
  should not have to rediscover? Encode it durably.
