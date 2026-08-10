/**
 * The truth ladder — shared types, declared identity, and the client-side
 * fallback evaluation.
 *
 * The canonical rules live in the database (ladder_rules, evaluated by
 * constellation_ladder). This module exists for one reason: when the control
 * plane is unreachable the hub must still render, and it must render HONESTLY
 * — showing declared stages labelled as declarations, never as measurements.
 *
 * `deriveLadderFallback` mirrors the ACTIVE v1 ruleset. It is a fallback, not
 * a second source of truth: ladder.drift.test.ts parses the seed migration and
 * fails if this file and the database disagree about any territory's declared
 * stage or ordering.
 */

export const TRUTH_LADDER = ['Merged', 'Deployed', 'Verified', 'Live'] as const
export type TruthStage = 0 | 1 | 2 | 3

/** Where a stage came from. The UI must never render 'declared' as evidence. */
export type LadderBasis = 'rule' | 'declared'

export interface LadderEntry {
  territory: string
  stage: TruthStage
  /** Human-facing one-liner, or null when the stage is merely declared. */
  signal: string | null
  basis: LadderBasis
  provenance: string
  rule_id: string | null
  ruleset_version: number | null
}

export interface LadderPayload {
  generated_at: string
  territories: LadderEntry[]
}

/** Coarse aggregates from constellation_status(). Counts and labels only. */
export interface ConstellationStatus {
  generated_at: string
  route_status_counts: Record<string, number>
  route_lanes: string[]
  route_repos: string[]
  route_latest_at: string | null
  evidence_status_counts: Record<string, number>
  evidence_latest_at: string | null
  action_status_counts: Record<string, number>
  recent_event_kinds: { action: string; target_type: string; at: string }[]
  milestone_count: number
}

export interface Territory {
  name: string
  tagline: string
  /** Owner assertion used only when no live rule fires. Not evidence. */
  declaredStage: TruthStage
  hue: string
  glyph: string
}

/**
 * The flock. Kept client-side so the hub renders its own identity without a
 * network round trip — identity is not live state. Stages and ordering are
 * mirrored from the ladder_territories seed and drift-tested against it.
 */
export const TERRITORIES: Territory[] = [
  {
    name: 'Legacy Codex',
    tagline: 'Canonical memory — experience converted into inherited capability',
    declaredStage: 3,
    hue: '#9177c7',
    glyph: '◆',
  },
  {
    name: 'Foundry Console',
    tagline: 'Routing control plane — human intent to technical execution',
    declaredStage: 2,
    hue: '#4796e3',
    glyph: '▲',
  },
  {
    name: 'Control Panel',
    tagline: 'Mission control for agents, routes and evidence',
    declaredStage: 1,
    hue: '#21a4c4',
    glyph: '●',
  },
  {
    name: 'System Atlas',
    tagline: 'Knowledge graph as constellation — relationships are first-class',
    declaredStage: 3,
    hue: '#d96570',
    glyph: '✦',
  },
  {
    name: 'PocketForge',
    tagline: 'iOS client — the bridge in your pocket',
    declaredStage: 0,
    hue: '#e8934a',
    glyph: '■',
  },
  {
    name: 'Goose Cookbook',
    tagline: 'Canonical doctrine for every mind building the bridge',
    declaredStage: 3,
    hue: '#c9a227',
    glyph: '🪿',
  },
  {
    name: 'LLM Wiki',
    tagline: 'Agent layer — origin sessions and inheritance evidence',
    declaredStage: 3,
    hue: '#34a853',
    glyph: '◇',
  },
]

function count(rec: Record<string, number> | undefined, key: string): number {
  return rec?.[key] ?? 0
}

function declaredEntry(t: Territory): LadderEntry {
  return {
    territory: t.name,
    stage: t.declaredStage,
    signal: null,
    basis: 'declared',
    provenance: 'unknown',
    rule_id: null,
    ruleset_version: null,
  }
}

/**
 * Client mirror of the ACTIVE v1 ruleset, evaluated against constellation_status
 * aggregates. Used only when constellation_ladder() is unavailable.
 *
 * Any change here is a change to what the ladder means and must be made in
 * ladder_rules first — see supabase/migrations/20260810010000_ladder_rules.sql.
 */
export function deriveLadderFallback(status: ConstellationStatus | null): LadderEntry[] {
  if (!status) return TERRITORIES.map(declaredEntry)

  const routeConfirmed = count(status.route_status_counts, 'confirmed')
  const evidenceVerified = count(status.evidence_status_counts, 'verified')
  const actionsDone = count(status.action_status_counts, 'DONE')
  const actionsTodo = count(status.action_status_counts, 'TODO')
  const milestones = status.milestone_count ?? 0

  const rule = (
    territory: string,
    stage: TruthStage,
    signal: string,
  ): LadderEntry => ({
    territory,
    stage,
    signal,
    basis: 'rule',
    provenance: 'inference',
    rule_id: null,
    ruleset_version: 1,
  })

  return TERRITORIES.map((t) => {
    switch (t.name) {
      case 'Legacy Codex': {
        const routed = status.route_repos.some((r) => r.includes('legacy-codex'))
        if (routed && routeConfirmed > 0 && milestones > 0) {
          return rule(t.name, 2, `${routeConfirmed} route confirmed · ${milestones} milestones`)
        }
        return rule(t.name, 1, 'awaiting routing evidence')
      }
      case 'Foundry Console': {
        if (evidenceVerified > 0) return rule(t.name, 3, `${evidenceVerified} evidence verified`)
        if (routeConfirmed > 0) return rule(t.name, 2, `${routeConfirmed} route confirmed`)
        return rule(t.name, 0, 'no confirmed routes')
      }
      case 'Control Panel': {
        if (actionsDone > 0) return rule(t.name, 2, `${actionsDone} actions done`)
        return rule(t.name, 1, `${actionsTodo} actions queued`)
      }
      default:
        // No signal is wired for this territory. Say so by staying declared.
        return declaredEntry(t)
    }
  })
}

/** Index a ladder payload by territory for O(1) lookup during render. */
export function indexLadder(entries: LadderEntry[]): Map<string, LadderEntry> {
  return new Map(entries.map((e) => [e.territory, e]))
}
