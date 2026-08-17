/**
 * PostgREST / supabase-js errors are not visitor-facing copy.
 * The hub may name the failure class; it must not dump driver text like
 * "Unregistered API key" into the constellation provenance line.
 */
export function humanizeControlPlaneError(message: string): string {
  const text = message.trim()
  if (!text) return 'Control plane did not respond.'
  if (/unregistered api key/i.test(text)) {
    return 'This deploy’s publishable key is not registered with foundry-console.'
  }
  if (/invalid api key|invalid jwt|malformed jwt|bad_jwt/i.test(text)) {
    return 'This deploy’s API key was rejected by foundry-console.'
  }
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(text)) {
    return 'Control plane unreachable from this session.'
  }
  if (/could not find the function|does not exist|PGRST202/i.test(text)) {
    return 'The requested constellation function is not deployed on this project.'
  }
  return 'Control plane unreachable from this session.'
}
