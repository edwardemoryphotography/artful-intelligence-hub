/**
 * PostgREST / supabase-js errors are not visitor-facing copy.
 * The hub may name the failure class; it must not dump driver text like
 * "Unregistered API key" into the constellation provenance line.
 *
 * "does not exist" is not enough to call an RPC missing. Postgres uses that
 * phrase for relations, columns, and types as well. A function that ran and
 * then hit an unapplied migration must not be reported as undeployed.
 */

export interface ControlPlaneDriverError {
  code?: string
  message?: string
}

/** PostgREST schema-cache miss (PGRST202) or Postgres undefined_function (42883). */
export function isMissingRpcError(error: ControlPlaneDriverError): boolean {
  const code = (error.code ?? '').toUpperCase()
  const message = error.message ?? ''
  if (code === 'PGRST202' || code === '42883') return true
  return /could not find the function|function [^\n]+ does not exist/i.test(message)
}

function isMissingRelationError(error: ControlPlaneDriverError): boolean {
  const code = error.code ?? ''
  const message = error.message ?? ''
  if (code === '42P01') return true
  return /relation [^\n]+ does not exist/i.test(message)
}

export function humanizeControlPlaneError(message: string, code?: string): string {
  const text = message.trim()
  if (!text) return 'Control plane did not respond.'
  const error = { code, message: text }
  if (/unregistered api key/i.test(text)) {
    return 'This deploy’s publishable key is not registered with foundry-console.'
  }
  if (/invalid api key|invalid jwt|malformed jwt|bad_jwt/i.test(text)) {
    return 'This deploy’s API key was rejected by foundry-console.'
  }
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(text)) {
    return 'Control plane unreachable from this session.'
  }
  if (isMissingRpcError(error)) {
    return 'The requested constellation function is not deployed on this project.'
  }
  if (isMissingRelationError(error)) {
    return 'Control plane schema is incomplete — a required relation is missing.'
  }
  return 'Control plane unreachable from this session.'
}
