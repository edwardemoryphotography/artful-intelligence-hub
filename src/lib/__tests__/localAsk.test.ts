import { describe, expect, it } from 'vitest'
import {
  TERRITORIES,
  deriveLadderFallback,
  type ConstellationStatus,
} from '../ladder'
import {
  adaptiveChips,
  askLocal,
  classifyIntent,
  flockSummary,
  type LocalAskInput,
} from '../localAsk'

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

function input(overrides: Partial<LocalAskInput> = {}): LocalAskInput {
  return {
    question: '',
    ladder: deriveLadderFallback(null),
    status: null,
    ladderSource: 'declared',
    notice: null,
    sync: 'error',
    signedIn: false,
    ...overrides,
  }
}

describe('classifyIntent', () => {
  it('detects route, doctrine, live evidence, promote, and offline', () => {
    expect(classifyIntent('Route a task to the flock')).toBe('route')
    expect(classifyIntent('What is the Goose Principle?')).toBe('doctrine')
    expect(classifyIntent('Which territories are Live on evidence, not assertion?')).toBe(
      'live_evidence',
    )
    expect(classifyIntent('What would it take to promote Foundry Console to Live?')).toBe('promote')
    expect(classifyIntent('What can we know without the control plane?')).toBe('offline')
    expect(classifyIntent('What is the control plane telling us that the ladder is not?')).toBe(
      'control_plane',
    )
    expect(classifyIntent('Why is PocketForge declared-only?')).toBe('declared')
    expect(classifyIntent('Tell me about System Atlas')).toBe('territory')
  })
})

describe('askLocal', () => {
  it('never reports Live on evidence when every stage is declared', () => {
    const result = askLocal(
      input({ question: 'Which territories are Live on evidence, not assertion?' }),
    )
    expect(result.intent).toBe('live_evidence')
    expect(result.answer).toMatch(/None/)
    expect(result.answer).not.toMatch(/is Live on a/)
  })

  it('names Foundry Console as Live on evidence when the v1 rule fires', () => {
    const ladder = deriveLadderFallback(status({ evidence_status_counts: { verified: 2 } }))
    const result = askLocal(
      input({
        question: 'Which territories are Live on evidence, not assertion?',
        ladder,
        status: status({ evidence_status_counts: { verified: 2 } }),
        ladderSource: 'fallback',
        sync: 'degraded',
      }),
    )
    expect(result.answer).toMatch(/Foundry Console/)
    expect(result.answer).toMatch(/Live/)
    expect(result.focusTerritory).toBe('Foundry Console')
    // Unwired territories must not be smuggled into the Live list.
    expect(result.answer).not.toMatch(/System Atlas is Live on a/)
    expect(result.answer).not.toMatch(/Goose Cookbook is Live on a/)
  })

  it('refuses to invent a next rung for a declared-only territory', () => {
    const result = askLocal(input({ question: 'What would it take to promote PocketForge to Live?' }))
    expect(result.intent).toBe('promote')
    expect(result.focusTerritory).toBe('PocketForge')
    expect(result.answer).toMatch(/no wired signal/)
    expect(result.answer).not.toMatch(/becomes Live when/)
  })

  it('states the v1 Foundry Console predicate instead of a vibe', () => {
    const ladder = deriveLadderFallback(status({ route_status_counts: { confirmed: 3 } }))
    const result = askLocal(
      input({
        question: 'What would it take to promote Foundry Console to Live?',
        ladder,
        status: status({ route_status_counts: { confirmed: 3 } }),
        ladderSource: 'fallback',
        sync: 'degraded',
      }),
    )
    expect(result.answer).toMatch(/verified evidence/)
    expect(result.required_evidence).toMatch(/verified/)
  })

  it('tells an unsigned visitor that routing is not a browser write', () => {
    const result = askLocal(input({ question: 'Route a task to the flock', signedIn: false }))
    expect(result.intent).toBe('route')
    expect(result.answer).toMatch(/service-role/)
    expect(result.answer).toMatch(/Sign in/)
  })

  it('lists declared identity when asked what we know without the control plane', () => {
    const result = askLocal(input({ question: 'What can we know without the control plane?' }))
    expect(result.intent).toBe('offline')
    for (const t of TERRITORIES) {
      expect(result.answer).toContain(t.name)
    }
    expect(result.answer).toMatch(/do not know any measurement/)
  })

  it('restates aggregates for a control-plane question and does not call counts a rung', () => {
    const st = status({
      route_status_counts: { confirmed: 3 },
      evidence_status_counts: { verified: 1 },
      recent_event_kinds: [{ action: 'route.persisted', target_type: 'routed_request', at: '2026-08-09T21:00:00Z' }],
      milestone_count: 4,
    })
    const result = askLocal(
      input({
        question: 'What is the control plane telling us that the ladder is not?',
        status: st,
        ladder: deriveLadderFallback(st),
        ladderSource: 'fallback',
        sync: 'degraded',
      }),
    )
    expect(result.answer).toMatch(/3 confirmed/)
    expect(result.answer).toMatch(/route\.persisted/)
    expect(result.answer).toMatch(/Counts are not themselves a rung/)
  })
})

describe('adaptiveChips', () => {
  it('asks what we can know without the control plane when it is unreachable', () => {
    const chips = adaptiveChips({
      ladder: deriveLadderFallback(null),
      status: null,
      ladderSource: 'declared',
      notice: null,
      sync: 'error',
    })
    expect(chips.some((c) => c.prompt.includes('without the control plane'))).toBe(true)
    expect(chips).toHaveLength(4)
  })

  it('asks about promoting a lagging measured territory when one exists', () => {
    const st = status({ route_status_counts: { confirmed: 2 } })
    const chips = adaptiveChips({
      ladder: deriveLadderFallback(st),
      status: st,
      ladderSource: 'fallback',
      notice: null,
      sync: 'degraded',
    })
    expect(chips.some((c) => c.prompt.includes('promote Foundry Console'))).toBe(true)
  })
})

describe('flockSummary', () => {
  it('does not claim Live on evidence from declared stages', () => {
    const summary = flockSummary({
      ladder: deriveLadderFallback(null),
      status: null,
      ladderSource: 'declared',
      notice: null,
      sync: 'error',
    })
    expect(summary).toMatch(/0 Live on evidence/)
    expect(summary).toMatch(/unreachable/)
  })
})
