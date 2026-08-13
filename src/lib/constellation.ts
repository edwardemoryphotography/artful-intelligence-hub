/**
 * Typed access to the two anon-safe control-plane functions.
 *
 * Every response is run through the exposure contract before it is handed to
 * the UI. Failures are returned as values, not thrown, because the hub's job
 * when the control plane is degraded is to say so plainly — not to blank out
 * and not to quietly show stale or invented state.
 */
import { supabase } from './supabase'
import { assertExposureContract, ExposureContractError } from './exposure'
import { humanizeControlPlaneError } from './controlPlaneNotice'
import type { ConstellationStatus, LadderPayload } from './ladder'

export type ControlPlaneFailure =
  /** Network down, project paused, CORS, timeout. */
  | 'unreachable'
  /** The function is not deployed on this project (migration not applied). */
  | 'missing_function'
  /** The response carried a field the exposure contract forbids. */
  | 'contract'

export type ControlPlaneResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: ControlPlaneFailure; message: string }

/**
 * PostgREST reports an undefined RPC as PGRST202. Distinguishing that from a
 * network failure matters: "not deployed yet" is a truthful, expected state
 * while a migration is pending, and the UI should degrade to the client
 * fallback rather than claim the control plane is down.
 */
function classify(error: { code?: string; message?: string }): ControlPlaneFailure {
  const code = error.code ?? ''
  const message = error.message ?? ''
  if (code === 'PGRST202' || /could not find the function|does not exist/i.test(message)) {
    return 'missing_function'
  }
  return 'unreachable'
}

async function callRpc<T>(fn: string): Promise<ControlPlaneResult<T>> {
  try {
    const { data, error } = await supabase.rpc(fn)
    if (error) {
      return {
        ok: false,
        reason: classify(error),
        message: humanizeControlPlaneError(error.message),
      }
    }
    assertExposureContract(data)
    return { ok: true, data: data as T }
  } catch (err) {
    if (err instanceof ExposureContractError) {
      // Loud on purpose: this means a migration widened a public function.
      console.error(err.message)
      return { ok: false, reason: 'contract', message: err.message }
    }
    return {
      ok: false,
      reason: 'unreachable',
      message: humanizeControlPlaneError(err instanceof Error ? err.message : String(err)),
    }
  }
}

export function fetchConstellationStatus(): Promise<ControlPlaneResult<ConstellationStatus>> {
  return callRpc<ConstellationStatus>('constellation_status')
}

export function fetchConstellationLadder(): Promise<ControlPlaneResult<LadderPayload>> {
  return callRpc<LadderPayload>('constellation_ladder')
}
