import { describe, expect, it } from 'vitest'
import { humanizeControlPlaneError } from '../controlPlaneNotice'

describe('humanizeControlPlaneError', () => {
  it('does not leak Unregistered API key into visitor copy', () => {
    expect(humanizeControlPlaneError('Unregistered API key')).not.toMatch(/Unregistered API key/i)
    expect(humanizeControlPlaneError('Unregistered API key')).toMatch(/publishable key/)
  })

  it('maps network failures without echoing the driver', () => {
    expect(humanizeControlPlaneError('Failed to fetch')).toBe(
      'Control plane unreachable from this session.',
    )
  })

  it('maps a missing RPC without dumping PostgREST codes', () => {
    expect(humanizeControlPlaneError('PGRST202: could not find the function')).toMatch(
      /not deployed/,
    )
    expect(humanizeControlPlaneError('PGRST202: could not find the function')).not.toMatch(/PGRST/)
  })

  it('never returns the raw unknown driver string', () => {
    expect(humanizeControlPlaneError('some internal supabase boom')).toBe(
      'Control plane unreachable from this session.',
    )
  })
})
