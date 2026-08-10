/**
 * Client for the flock-ask Edge Function.
 *
 * The function requires an owner session, so this is only callable once
 * signed in. Every failure is returned as a value with a message the UI can
 * show verbatim — a command bar that silently does nothing is worse than one
 * that says why.
 */
import { supabase, SUPABASE_URL } from './supabase'

export interface ProposedRoute {
  intent: string
  repository: string
  task_type: string
  execution_lane: string
  selected_agent: string
  risk: string
  sensitivity: string
  required_evidence: string
  rationale: string
  confidence: number
  evidence_kind: string
}

export interface FlockAnswer {
  answer: string
  confidence: number
  required_evidence: string
  proposed_route: ProposedRoute | null
  grounding: {
    doctrine_source: 'canonical' | 'embedded'
    status_available: boolean
    ladder_available: boolean
    status_error: string | null
    ladder_error: string | null
  }
}

export type FlockAskResult =
  | { ok: true; data: FlockAnswer }
  | { ok: false; message: string }

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/flock-ask`

async function call(body: Record<string, unknown>): Promise<Response | { error: string }> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return { error: 'Sign in as the owner to use the command bar.' }

  try {
    return await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export async function askFlock(question: string): Promise<FlockAskResult> {
  const res = await call({ mode: 'ask', question })
  if ('error' in res) return { ok: false, message: res.error }

  let payload: Record<string, unknown>
  try {
    payload = await res.json()
  } catch {
    return { ok: false, message: `flock-ask returned a non-JSON response (HTTP ${res.status}).` }
  }
  if (!res.ok) {
    return { ok: false, message: String(payload.error ?? `flock-ask failed (HTTP ${res.status}).`) }
  }
  return { ok: true, data: payload as unknown as FlockAnswer }
}

/**
 * Confirm and persist a proposed route. Deliberately a separate call: the
 * model can propose, only the owner can confirm, and the write itself happens
 * server-side through persist_route_atomic.
 */
export async function confirmRoute(
  route: ProposedRoute,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const res = await call({ mode: 'persist', confirm: true, route })
  if ('error' in res) return { ok: false, message: res.error }
  if (!res.ok) {
    let message = `Route persistence failed (HTTP ${res.status}).`
    try {
      const payload = await res.json()
      if (payload?.error) message = String(payload.error)
    } catch {
      // Keep the status-based message.
    }
    return { ok: false, message }
  }
  return { ok: true }
}
