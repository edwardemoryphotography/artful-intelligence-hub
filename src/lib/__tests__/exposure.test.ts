/**
 * The exposure contract is the whole safety story for two SECURITY DEFINER
 * functions granted to anon. These tests are the tripwire.
 */
import { describe, expect, it } from 'vitest'
import { assertExposureContract, ExposureContractError, FORBIDDEN_FIELDS } from '../exposure'

/** A realistic constellation_status() payload — aggregates only. */
const SAFE_STATUS = {
  generated_at: '2026-08-10T04:00:00Z',
  route_status_counts: { confirmed: 3, proposed: 1 },
  route_lanes: ['execution', 'documentation'],
  route_repos: ['edwardemoryphotography/legacy-codex'],
  route_latest_at: '2026-08-09T21:00:00Z',
  evidence_status_counts: { pending: 2, verified: 1 },
  evidence_latest_at: '2026-08-09T20:00:00Z',
  action_status_counts: { TODO: 5, DONE: 2 },
  recent_event_kinds: [
    { action: 'route.persisted', target_type: 'routed_request', at: '2026-08-09T21:00:00Z' },
  ],
  milestone_count: 4,
}

const SAFE_LADDER = {
  generated_at: '2026-08-10T04:00:00Z',
  territories: [
    {
      territory: 'Foundry Console',
      stage: 2,
      signal: '3 route confirmed',
      basis: 'rule',
      provenance: 'inference',
      rule_id: '0f1a2b3c-0000-4000-8000-000000000000',
      ruleset_version: 1,
    },
    {
      territory: 'PocketForge',
      stage: 0,
      signal: null,
      basis: 'declared',
      provenance: 'concept',
      rule_id: null,
      ruleset_version: null,
    },
  ],
}

describe('assertExposureContract', () => {
  it('accepts a real constellation_status payload', () => {
    expect(() => assertExposureContract(SAFE_STATUS)).not.toThrow()
  })

  it('accepts a real constellation_ladder payload', () => {
    expect(() => assertExposureContract(SAFE_LADDER)).not.toThrow()
  })

  it('does not mistake the event verb "action" for the sensitive "action_title"', () => {
    // recent_event_kinds[].action is a coarse event verb and is deliberately
    // exposed; a naive substring check would reject the whole payload.
    expect(() => assertExposureContract(SAFE_STATUS)).not.toThrow()
    expect(() => assertExposureContract({ action_title: 'Ship the thing' })).toThrow(
      ExposureContractError,
    )
  })

  it.each(FORBIDDEN_FIELDS)('rejects a payload carrying "%s"', (field) => {
    expect(() => assertExposureContract({ ...SAFE_STATUS, [field]: 'leaked' })).toThrow(
      ExposureContractError,
    )
  })

  it('finds a forbidden field nested inside an array', () => {
    const widened = {
      ...SAFE_STATUS,
      recent_event_kinds: [
        { action: 'route.persisted', target_type: 'routed_request', at: 'x', metadata: { any: 1 } },
      ],
    }
    expect(() => assertExposureContract(widened)).toThrow(/metadata/)
  })

  it('reports the path to the violation so the offending migration is findable', () => {
    const widened = { territories: [{ territory: 'X', intent: 'the owner ask' }] }
    try {
      assertExposureContract(widened)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ExposureContractError)
      expect((err as ExposureContractError).path).toBe('$.territories[0].intent')
    }
  })

  it('is case-insensitive — a renamed column still trips the wire', () => {
    expect(() => assertExposureContract({ Intent: 'x' })).toThrow(ExposureContractError)
  })

  it('does not hang on a cyclic payload', () => {
    const cyclic: Record<string, unknown> = { a: 1 }
    cyclic.self = cyclic
    expect(() => assertExposureContract(cyclic)).not.toThrow()
  })
})
