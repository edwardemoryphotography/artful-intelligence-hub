/**
 * Runtime enforcement of the constellation exposure contract.
 *
 * constellation_status() and constellation_ladder() are SECURITY DEFINER: they
 * read tables that RLS otherwise keeps authenticated-only, and they are granted
 * to anon. The entire safety of that arrangement rests on those functions
 * returning coarse aggregates and nothing else.
 *
 * A migration authored by a future agent could widen them by one column and
 * nothing in the frontend would notice — it would simply render whatever
 * arrived. This module makes that failure loud instead of silent: every RPC
 * response is walked before use, and a payload carrying a field from the
 * user-content side of the schema is refused rather than displayed.
 *
 * This is defence in depth, not the primary control. The primary control is
 * the SQL itself. But a contract nobody checks is a contract that erodes.
 */

/**
 * Column names from the control-plane schema that carry user-authored or
 * otherwise sensitive content. Sourced from the real table definitions:
 *   routed_requests / evidence_items — legacy-codex 20260804010000
 *   events / workspaces              — legacy-codex 20260804005900
 *   actions                          — codex-system-architecture 20260520120000
 *
 * Deliberately NOT forbidden, because the reviewed contract already exposes
 * them as coarse labels: repository, execution_lane, status, kind, action
 * (the event verb), target_type, created_at.
 */
export const FORBIDDEN_FIELDS: readonly string[] = [
  // routed_requests — the owner's ask and the model's reasoning
  'intent',
  'rationale',
  'required_evidence',
  'repository_path',
  'selected_agent',
  // evidence_items — the claim and where it was observed
  'claim',
  'source',
  'observed_at',
  // actions — task titles and business segmentation
  'action_title',
  'portfolio_segment',
  'context_complexity',
  // events — free-form payload and actor identity
  'metadata',
  'actor_id',
  'target_id',
  // workspaces / auth
  'email',
  'user_id',
]

export class ExposureContractError extends Error {
  readonly field: string
  readonly path: string

  constructor(field: string, path: string) {
    super(
      `Exposure contract violation: control-plane response contained "${field}" at ${path}. ` +
        `The constellation functions must return coarse aggregates only. ` +
        `Refusing to render this payload.`,
    )
    this.name = 'ExposureContractError'
    this.field = field
    this.path = path
  }
}

/**
 * Walk a decoded RPC payload and throw on the first forbidden field.
 * Cycle-safe; arrays are indexed in the reported path for debuggability.
 */
export function assertExposureContract(value: unknown, path = '$'): void {
  const seen = new WeakSet<object>()
  const forbidden = new Set(FORBIDDEN_FIELDS.map((f) => f.toLowerCase()))

  const walk = (node: unknown, here: string): void => {
    if (node === null || typeof node !== 'object') return
    if (seen.has(node as object)) return
    seen.add(node as object)

    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${here}[${i}]`))
      return
    }

    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (forbidden.has(key.toLowerCase())) {
        throw new ExposureContractError(key, `${here}.${key}`)
      }
      walk(child, `${here}.${key}`)
    }
  }

  walk(value, path)
}
