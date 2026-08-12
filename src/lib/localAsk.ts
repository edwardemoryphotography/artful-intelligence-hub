/**
 * Local reading of the constellation — the command bar's intelligence when
 * flock-ask is unavailable (unsigned visitor, function not deployed, or the
 * control plane is unreachable).
 *
 * This is not a second source of truth. It only restates what the hub already
 * has: ladder entries, coarse aggregates, and declared identity. It must never
 * promote a declared stage into a measurement, invent a signal, or speak as
 * the owner function.
 */
import {
  TERRITORIES,
  type ConstellationStatus,
  type LadderEntry,
  type TruthStage,
} from './ladder'

export type LadderSource = 'server' | 'fallback' | 'declared'
export type SyncState = 'syncing' | 'live' | 'degraded' | 'error'

export type LocalIntent =
  | 'overview'
  | 'live_evidence'
  | 'declared'
  | 'promote'
  | 'territory'
  | 'control_plane'
  | 'doctrine'
  | 'route'
  | 'offline'

export interface LocalAskInput {
  question: string
  ladder: LadderEntry[]
  status: ConstellationStatus | null
  ladderSource: LadderSource
  notice: string | null
  sync: SyncState
  signedIn: boolean
}

export interface LocalAskResult {
  answer: string
  confidence: number
  required_evidence: string | null
  focusTerritory: string | null
  intent: LocalIntent
}

export interface AdaptiveChip {
  label: string
  prompt: string
}

const STAGE_NAME: Record<TruthStage, string> = {
  0: 'Merged',
  1: 'Deployed',
  2: 'Verified',
  3: 'Live',
}

const TERRITORY_ALIASES: ReadonlyArray<{ name: string; aliases: readonly string[] }> = [
  { name: 'Legacy Codex', aliases: ['legacy codex', 'codex'] },
  { name: 'Foundry Console', aliases: ['foundry console', 'foundry'] },
  { name: 'Control Panel', aliases: ['control panel'] },
  { name: 'System Atlas', aliases: ['system atlas', 'atlas'] },
  { name: 'PocketForge', aliases: ['pocketforge', 'pocket forge'] },
  { name: 'Goose Cookbook', aliases: ['goose cookbook', 'cookbook'] },
  { name: 'LLM Wiki', aliases: ['llm wiki'] },
]

function normalize(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, ' ')
}

function byName(ladder: LadderEntry[]): Map<string, LadderEntry> {
  return new Map(ladder.map((e) => [e.territory, e]))
}

function namedTerritory(q: string): string | null {
  for (const { name, aliases } of TERRITORY_ALIASES) {
    if (aliases.some((alias) => q.includes(alias))) return name
  }
  return null
}

/** Territory named in a question, if any. Used to highlight cards as the user types. */
export function mentionedTerritory(question: string): string | null {
  return namedTerritory(normalize(question))
}

function liveOnEvidence(ladder: LadderEntry[]): LadderEntry[] {
  return ladder.filter((e) => e.stage === 3 && e.basis === 'rule')
}

function measured(ladder: LadderEntry[]): LadderEntry[] {
  return ladder.filter((e) => e.basis === 'rule')
}

function declaredOnly(ladder: LadderEntry[]): LadderEntry[] {
  return ladder.filter((e) => e.basis === 'declared')
}

function laggingMeasured(ladder: LadderEntry[]): LadderEntry[] {
  return ladder.filter((e) => e.basis === 'rule' && e.stage < 3)
}

function sourceLine(source: LadderSource): string {
  switch (source) {
    case 'server':
      return 'Stages on screen were evaluated server-side from ladder_rules.'
    case 'fallback':
      return 'Stages on screen are the v1 client mirror over live aggregates — constellation_ladder() was unavailable.'
    case 'declared':
      return 'No control-plane data. Every stage on screen is the owner’s declaration, not a measurement.'
  }
}

function listNames(entries: LadderEntry[]): string {
  if (entries.length === 0) return 'none'
  return entries.map((e) => e.territory).join(', ')
}

function describeEntry(entry: LadderEntry): string {
  const stage = STAGE_NAME[entry.stage]
  if (entry.basis === 'declared') {
    return `${entry.territory} is declared ${stage} — owner assertion, no control-plane signal wired.`
  }
  const signal = entry.signal ? ` (${entry.signal})` : ''
  return `${entry.territory} is ${stage} on a v${entry.ruleset_version ?? 1} rule${signal}.`
}

function countsLine(rec: Record<string, number> | undefined, empty: string): string {
  if (!rec) return empty
  const parts = Object.entries(rec)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}`)
  return parts.length > 0 ? parts.join(', ') : empty
}

export function classifyIntent(question: string): LocalIntent {
  const q = normalize(question)
  if (!q) return 'overview'
  if (/\b(route a task|persist (a |the )?route|assign .*flock)\b/.test(q)) return 'route'
  if (/\b(goose principle|fear-based|recursion|boomerang|doctrine)\b/.test(q)) return 'doctrine'
  if (/\b(without the control plane|unreachable|offline|no control-plane)\b/.test(q)) return 'offline'
  if (/\b(live on evidence|which territories are live|measured, not asserted|not assertion)\b/.test(q)) {
    return 'live_evidence'
  }
  if (/\b(declared-only|declared only|assertion|unwired)\b/.test(q)) return 'declared'
  if (/\b(promote|what would it take|next rung|how (do we|to) (get|make).*\blive\b)\b/.test(q)) {
    return 'promote'
  }
  if (/\b(control plane|pulse|aggregates|telling us that the ladder)\b/.test(q)) return 'control_plane'
  if (namedTerritory(q)) return 'territory'
  if (/\b(truth ladder|merged|deployed|verified)\b/.test(q)) return 'overview'
  return 'overview'
}

function answerOverview(input: LocalAskInput): LocalAskResult {
  const live = liveOnEvidence(input.ladder)
  const declared = declaredOnly(input.ladder)
  const measuredEntries = measured(input.ladder)
  const lines = [
    sourceLine(input.ladderSource),
    `${live.length} Live on evidence: ${listNames(live)}.`,
    `${measuredEntries.length} measured by a rule: ${listNames(measuredEntries)}.`,
    `${declared.length} declared-only (no wired signal): ${listNames(declared)}.`,
  ]
  if (input.notice) lines.push(input.notice)
  return {
    answer: lines.join(' '),
    confidence: input.ladderSource === 'declared' ? 0.7 : 0.86,
    required_evidence: live.length === 0 ? 'A wired rule plus verified evidence before any territory can read as Live.' : null,
    focusTerritory: null,
    intent: 'overview',
  }
}

function answerLiveEvidence(input: LocalAskInput): LocalAskResult {
  const live = liveOnEvidence(input.ladder)
  if (live.length === 0) {
    return {
      answer:
        'None. Live on evidence requires basis=rule and stage=Live. Declared Live is an owner assertion and is not counted here. ' +
        sourceLine(input.ladderSource),
      confidence: 0.9,
      required_evidence: 'Verified evidence (or the active rule’s actual predicate) for at least one wired territory.',
      focusTerritory: null,
      intent: 'live_evidence',
    }
  }
  const detail = live.map(describeEntry).join(' ')
  return {
    answer: `${live.length} territor${live.length === 1 ? 'y is' : 'ies are'} Live on evidence: ${detail} ${sourceLine(input.ladderSource)}`,
    confidence: 0.92,
    required_evidence: null,
    focusTerritory: live[0]?.territory ?? null,
    intent: 'live_evidence',
  }
}

function answerDeclared(input: LocalAskInput, focus: string | null): LocalAskResult {
  const declared = declaredOnly(input.ladder)
  const target = focus ? declared.find((e) => e.territory === focus) : null
  if (target) {
    const identity = TERRITORIES.find((t) => t.name === target.territory)
    return {
      answer:
        `${target.territory} is declared-only. The hub knows its identity` +
        (identity ? ` (“${identity.tagline}”)` : '') +
        ` and a declared stage of ${STAGE_NAME[target.stage]}, but no control-plane signal is wired, so the ladder must not read that stage as a measurement.`,
      confidence: 0.9,
      required_evidence: `A ladder_rules row for ${target.territory} plus a live aggregate that can fire it.`,
      focusTerritory: target.territory,
      intent: 'declared',
    }
  }
  if (declared.length === 0) {
    return {
      answer: 'Every territory currently on screen has a wired rule. Declared-only is empty.',
      confidence: 0.85,
      required_evidence: null,
      focusTerritory: null,
      intent: 'declared',
    }
  }
  return {
    answer: `Declared-only (no wired signal): ${listNames(declared)}. Their stages are owner assertions. ${sourceLine(input.ladderSource)}`,
    confidence: 0.9,
    required_evidence: 'A wired rule per territory before a declared stage can become a measurement.',
    focusTerritory: declared[0]?.territory ?? null,
    intent: 'declared',
  }
}

function promoteHint(entry: LadderEntry): string {
  if (entry.basis === 'declared') {
    return `${entry.territory} has no wired signal. Promotion is an owner decision plus a ladder_rules row — this client cannot measure a next rung that does not exist.`
  }
  switch (entry.territory) {
    case 'Foundry Console':
      if (entry.stage === 3) return 'Foundry Console is already Live on verified evidence under the v1 rule.'
      return 'v1 rule: Foundry Console becomes Live when constellation_status reports at least one verified evidence row. A confirmed route only reaches Verified.'
    case 'Legacy Codex':
      if (entry.stage >= 2) return 'Legacy Codex is at Verified under v1 (routed + confirmed route + milestones). Live is not in the active v1 rule for this territory.'
      return 'v1 rule: Legacy Codex reaches Verified when a legacy-codex repo is routed, at least one route is confirmed, and milestone_count > 0. Live is not claimed by v1.'
    case 'Control Panel':
      if (entry.stage >= 2) return 'Control Panel is at Verified under v1 (completed actions). Live is not in the active v1 rule for this territory.'
      return 'v1 rule: Control Panel reaches Verified when action_status_counts.DONE > 0. Live is not claimed by v1.'
    default:
      return `${entry.territory} is measured at ${STAGE_NAME[entry.stage]} (${entry.signal ?? 'no signal text'}). The next rung is whatever the active ladder_rules row says — not a client heuristic.`
  }
}

function answerPromote(input: LocalAskInput, focus: string | null): LocalAskResult {
  const ladderBy = byName(input.ladder)
  const targetName =
    focus ??
    [...laggingMeasured(input.ladder)].sort((a, b) => b.stage - a.stage)[0]?.territory ??
    declaredOnly(input.ladder).sort((a, b) => a.stage - b.stage)[0]?.territory ??
    null
  if (!targetName) {
    return {
      answer: 'Every wired territory is already Live on evidence. There is no next rung to promote from this reading.',
      confidence: 0.8,
      required_evidence: null,
      focusTerritory: null,
      intent: 'promote',
    }
  }
  const entry = ladderBy.get(targetName)
  if (!entry) {
    return answerOverview(input)
  }
  return {
    answer: `${describeEntry(entry)} ${promoteHint(entry)} ${sourceLine(input.ladderSource)}`,
    confidence: entry.basis === 'rule' ? 0.88 : 0.84,
    required_evidence:
      entry.basis === 'declared'
        ? `A ladder_rules row for ${entry.territory} before any promotion can be measured.`
        : entry.territory === 'Foundry Console' && entry.stage < 3
          ? 'At least one evidence_items row with status=verified.'
          : null,
    focusTerritory: entry.territory,
    intent: 'promote',
  }
}

function answerTerritory(input: LocalAskInput, name: string): LocalAskResult {
  const entry = byName(input.ladder).get(name)
  const identity = TERRITORIES.find((t) => t.name === name)
  if (!entry || !identity) return answerOverview(input)
  return {
    answer: `${identity.tagline}. ${describeEntry(entry)} ${promoteHint(entry)} ${sourceLine(input.ladderSource)}`,
    confidence: 0.9,
    required_evidence: entry.basis === 'declared' ? `A wired rule for ${name}.` : null,
    focusTerritory: name,
    intent: 'territory',
  }
}

function answerControlPlane(input: LocalAskInput): LocalAskResult {
  if (!input.status) {
    return {
      answer:
        'The control plane is not reachable from this session, so it is telling us nothing the ladder is not. The ladder is showing declared identity only. Aggregates (route counts, evidence, actions, pulse) are absent.',
      confidence: 0.88,
      required_evidence: 'A reachable constellation_status() response.',
      focusTerritory: null,
      intent: 'control_plane',
    }
  }
  const s = input.status
  const pulse =
    s.recent_event_kinds.length > 0
      ? `Recent pulse: ${s.recent_event_kinds
          .slice(0, 5)
          .map((e) => e.action)
          .join(', ')}.`
      : 'No recent event kinds in the last pulse.'
  const answer = [
    `Routes: ${countsLine(s.route_status_counts, 'none counted')}.`,
    s.route_lanes.length ? `Lanes: ${s.route_lanes.join(', ')}.` : null,
    s.route_repos.length ? `Repos: ${s.route_repos.join(', ')}.` : null,
    `Evidence: ${countsLine(s.evidence_status_counts, 'none counted')}.`,
    `Actions: ${countsLine(s.action_status_counts, 'none counted')}.`,
    `Milestones: ${s.milestone_count}.`,
    pulse,
    'The ladder is a ruleset over these aggregates (or a declaration when no rule is wired). Counts are not themselves a rung.',
    sourceLine(input.ladderSource),
  ]
    .filter((line): line is string => Boolean(line))
    .join(' ')
  return {
    answer,
    confidence: 0.9,
    required_evidence: null,
    focusTerritory: null,
    intent: 'control_plane',
  }
}

function answerDoctrine(question: string): LocalAskResult {
  const q = normalize(question)
  if (q.includes('goose principle')) {
    return {
      answer:
        'The Goose Principle: don’t preserve every experience. Preserve what the experience taught the system. The hub’s job is the teaching, not the transcript.',
      confidence: 0.95,
      required_evidence: null,
      focusTerritory: 'Goose Cookbook',
      intent: 'doctrine',
    }
  }
  if (q.includes('fear-based')) {
    return {
      answer:
        'Fear-Based DevOps: the deployment is innocent only after verification. Merged ≠ Deployed ≠ Verified ≠ Live. A green build is not a working integration.',
      confidence: 0.95,
      required_evidence: null,
      focusTerritory: null,
      intent: 'doctrine',
    }
  }
  if (q.includes('recursion')) {
    return {
      answer:
        'The Recursion: the human reverse-engineered the vision into machinery. The AI reverse-engineered the machinery back into the vision.',
      confidence: 0.95,
      required_evidence: null,
      focusTerritory: null,
      intent: 'doctrine',
    }
  }
  if (q.includes('boomerang')) {
    return {
      answer:
        'Catch the boomerang: reading the cookbook makes you a diner — catching the boomerang makes you a chef. If a lesson already exists in the runbook, do not rediscover it.',
      confidence: 0.93,
      required_evidence: null,
      focusTerritory: 'Goose Cookbook',
      intent: 'doctrine',
    }
  }
  return {
    answer:
      'Inherited doctrine on this surface: the Goose Principle, the Recursion, and Fear-Based DevOps. Ladder meaning is an owner decision; this client only restates what is already on screen.',
    confidence: 0.8,
    required_evidence: null,
    focusTerritory: 'Goose Cookbook',
    intent: 'doctrine',
  }
}

function answerRoute(signedIn: boolean): LocalAskResult {
  if (!signedIn) {
    return {
      answer:
        'Routing writes cannot happen in the browser. persist_route_atomic is service-role only. Sign in as owner so flock-ask can propose a route; nothing is persisted until you confirm.',
      confidence: 0.95,
      required_evidence: 'An owner session, then an explicit confirm on a proposed route.',
      focusTerritory: null,
      intent: 'route',
    }
  }
  return {
    answer:
      'A route write still cannot happen from this page directly. flock-ask must propose; you confirm; the Edge Function holds the service-role key. If the function is not deployed, the proposal will not arrive — that is a missing deployment, not a client bug.',
    confidence: 0.9,
    required_evidence: 'flock-ask deployed, with SUPABASE_SERVICE_ROLE_KEY set, plus your confirm.',
    focusTerritory: 'Foundry Console',
    intent: 'route',
  }
}

function answerOffline(input: LocalAskInput): LocalAskResult {
  const declared = TERRITORIES.map((t) => `${t.name} declared ${STAGE_NAME[t.declaredStage]}`).join('; ')
  return {
    answer:
      `Without the control plane we still know identity: ${declared}. We do not know any measurement. ${sourceLine(input.ladderSource)} ` +
      'A green build of this hub is not evidence that foundry-console is Live.',
    confidence: 0.9,
    required_evidence: 'Network access to constellation_status() / constellation_ladder().',
    focusTerritory: null,
    intent: 'offline',
  }
}

export function askLocal(input: LocalAskInput): LocalAskResult {
  const q = normalize(input.question)
  const focus = namedTerritory(q)
  const intent = classifyIntent(input.question)

  switch (intent) {
    case 'route':
      return answerRoute(input.signedIn)
    case 'doctrine':
      return answerDoctrine(input.question)
    case 'offline':
      return answerOffline(input)
    case 'live_evidence':
      return answerLiveEvidence(input)
    case 'declared':
      return answerDeclared(input, focus)
    case 'promote':
      return answerPromote(input, focus)
    case 'control_plane':
      return answerControlPlane(input)
    case 'territory':
      return focus ? answerTerritory(input, focus) : answerOverview(input)
    case 'overview':
      return answerOverview(input)
  }
}

/**
 * Prompt starters that change with the ladder. Static chips pretend the flock
 * is always in the same state; these ask the question the current reading
 * actually raises.
 */
export function adaptiveChips(input: Omit<LocalAskInput, 'question' | 'signedIn'>): AdaptiveChip[] {
  const chips: AdaptiveChip[] = []
  const live = liveOnEvidence(input.ladder)
  const declared = declaredOnly(input.ladder)
  const lagging = laggingMeasured(input.ladder)

  if (input.sync === 'error' || input.ladderSource === 'declared') {
    chips.push({
      label: 'Without the control plane',
      prompt: 'What can we know without the control plane?',
    })
  } else if (live.length > 0) {
    chips.push({
      label: 'Live on evidence',
      prompt: 'Which territories are Live on evidence, not assertion?',
    })
  } else {
    chips.push({
      label: 'Live on evidence',
      prompt: 'Which territories are Live on evidence, not assertion?',
    })
  }

  if (lagging.length > 0) {
    const closest = [...lagging].sort((a, b) => b.stage - a.stage)[0]
    if (closest) {
      chips.push({
        label: `Promote ${closest.territory}`,
        prompt: `What would it take to promote ${closest.territory} to Live?`,
      })
    }
  } else if (declared.length > 0) {
    const lowest = [...declared].sort((a, b) => a.stage - b.stage)[0]
    if (lowest) {
      chips.push({
        label: `${lowest.territory} declared-only`,
        prompt: `Why is ${lowest.territory} declared-only?`,
      })
    }
  }

  chips.push({
    label: 'Control plane vs ladder',
    prompt: 'What is the control plane telling us that the ladder is not?',
  })

  chips.push({
    label: 'Route a task',
    prompt: 'Route a task to the flock',
  })

  return chips.slice(0, 4)
}

export function flockSummary(input: Omit<LocalAskInput, 'question' | 'signedIn'>): string {
  if (input.sync === 'syncing' && input.ladderSource === 'declared' && !input.status) {
    return 'Reading the constellation…'
  }
  const live = liveOnEvidence(input.ladder).length
  const measuredCount = measured(input.ladder).length
  const declaredCount = declaredOnly(input.ladder).length
  if (input.sync === 'error' || input.ladderSource === 'declared') {
    return `${TERRITORIES.length} territories by declaration · control plane unreachable · ${live} Live on evidence`
  }
  return `${live} Live on evidence · ${measuredCount} measured · ${declaredCount} declared-only`
}
