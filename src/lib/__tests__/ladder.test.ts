/**
 * The client fallback must (a) mirror the active v1 SQL ruleset and (b) never
 * manufacture a measurement it did not make.
 *
 * The drift test at the bottom is the important one: it parses the seed
 * migration and fails if the client's declared stages diverge from the
 * database's. Without it, the two copies of the ladder silently disagree the
 * first time somebody edits one — which is precisely the "rediscover it later"
 * failure this whole layer exists to prevent.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  TERRITORIES,
  deriveLadderFallback,
  indexLadder,
  type ConstellationStatus,
} from '../ladder'

function status(overrides: Partial<ConstellationStatus> = {}): ConstellationStatus {
  return {
    generated_at: '2026-08-10T04:00:00Z',
    route_status_counts: {},
    route_lanes: [],
    route_repos: [],
    route_latest_at: null,
    evidence_status_counts: {},
    evidence_latest_at: null,
    action_status_counts: {},
    recent_event_kinds: [],
    milestone_count: 0,
    ...overrides,
  }
}

describe('deriveLadderFallback', () => {
  it('returns every territory as declared when there is no control-plane data', () => {
    const entries = deriveLadderFallback(null)
    expect(entries).toHaveLength(TERRITORIES.length)
    expect(entries.every((e) => e.basis === 'declared')).toBe(true)
    expect(entries.every((e) => e.signal === null)).toBe(true)
  })

  it('never marks an unwired territory as measured, even with full live data', () => {
    const entries = indexLadder(
      deriveLadderFallback(
        status({
          route_status_counts: { confirmed: 9 },
          evidence_status_counts: { verified: 9 },
          action_status_counts: { DONE: 9 },
          milestone_count: 9,
        }),
      ),
    )
    for (const name of ['System Atlas', 'PocketForge', 'Goose Cookbook', 'LLM Wiki']) {
      expect(entries.get(name)?.basis, `${name} has no wired signal`).toBe('declared')
      expect(entries.get(name)?.signal).toBeNull()
    }
  })

  describe('Legacy Codex (v1 rule: routed && confirmed>0 && milestones>0 => Verified)', () => {
    it('reaches Verified only when all three conditions hold', () => {
      const entry = indexLadder(
        deriveLadderFallback(
          status({
            route_repos: ['edwardemoryphotography/legacy-codex'],
            route_status_counts: { confirmed: 2 },
            milestone_count: 3,
          }),
        ),
      ).get('Legacy Codex')
      expect(entry?.stage).toBe(2)
      expect(entry?.signal).toBe('2 route confirmed · 3 milestones')
    })

    it.each([
      ['no repo evidence', { route_status_counts: { confirmed: 2 }, milestone_count: 3 }],
      [
        'no confirmed route',
        { route_repos: ['edwardemoryphotography/legacy-codex'], milestone_count: 3 },
      ],
      [
        'no milestones',
        {
          route_repos: ['edwardemoryphotography/legacy-codex'],
          route_status_counts: { confirmed: 2 },
        },
      ],
    ])('falls back to Deployed with %s', (_label, overrides) => {
      const entry = indexLadder(deriveLadderFallback(status(overrides))).get('Legacy Codex')
      expect(entry?.stage).toBe(1)
      expect(entry?.signal).toBe('awaiting routing evidence')
    })
  })

  describe('Foundry Console', () => {
    it('promotes to Live on verified evidence', () => {
      const entry = indexLadder(
        deriveLadderFallback(status({ evidence_status_counts: { verified: 1 } })),
      ).get('Foundry Console')
      expect(entry?.stage).toBe(3)
      expect(entry?.signal).toBe('1 evidence verified')
    })

    it('holds at Verified on a confirmed route with no verified evidence', () => {
      const entry = indexLadder(
        deriveLadderFallback(
          status({ route_status_counts: { confirmed: 4 }, evidence_status_counts: { pending: 2 } }),
        ),
      ).get('Foundry Console')
      expect(entry?.stage).toBe(2)
    })

    it('floors at Merged with nothing confirmed', () => {
      const entry = indexLadder(deriveLadderFallback(status())).get('Foundry Console')
      expect(entry?.stage).toBe(0)
      expect(entry?.signal).toBe('no confirmed routes')
    })
  })

  describe('Control Panel', () => {
    it('promotes to Verified on completed actions', () => {
      const entry = indexLadder(
        deriveLadderFallback(status({ action_status_counts: { DONE: 7 } })),
      ).get('Control Panel')
      expect(entry?.stage).toBe(2)
      expect(entry?.signal).toBe('7 actions done')
    })

    it('reports the queue depth at Deployed when nothing is done', () => {
      const entry = indexLadder(
        deriveLadderFallback(status({ action_status_counts: { TODO: 5 } })),
      ).get('Control Panel')
      expect(entry?.stage).toBe(1)
      expect(entry?.signal).toBe('5 actions queued')
    })
  })
})

describe('client/database ladder drift', () => {
  const seed = readFileSync(
    join(process.cwd(), 'supabase', 'migrations', '20260810010000_ladder_rules.sql'),
    'utf8',
  )

  /** Parse the ladder_territories seed rows: ('Name', order, stage, 'prov', '...') */
  const seeded = [...seed.matchAll(/\('([^']+)',\s*(\d+),\s*(\d+),\s*'([a-z_]+)'/g)].map((m) => ({
    territory: m[1],
    order: Number(m[2]),
    declaredStage: Number(m[3]),
    provenance: m[4],
  }))

  it('parses the seeded territories out of the migration', () => {
    expect(seeded.length).toBe(TERRITORIES.length)
  })

  it('client TERRITORIES matches ladder_territories in name and order', () => {
    expect(TERRITORIES.map((t) => t.name)).toEqual(
      [...seeded].sort((a, b) => a.order - b.order).map((s) => s.territory),
    )
  })

  it.each(TERRITORIES)('$name declared stage agrees with the database', (territory) => {
    const row = seeded.find((s) => s.territory === territory.name)
    expect(row, `${territory.name} is missing from the ladder_territories seed`).toBeDefined()
    expect(
      row!.declaredStage,
      `${territory.name}: client declares ${territory.declaredStage}, migration seeds ` +
        `${row!.declaredStage}. Change ladder_territories first, then mirror it here.`,
    ).toBe(territory.declaredStage)
  })
})
