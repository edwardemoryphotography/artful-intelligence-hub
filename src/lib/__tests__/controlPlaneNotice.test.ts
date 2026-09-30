import { describe, expect, it } from 'vitest'
import { humanizeControlPlaneError, isMissingRpcError } from '../controlPlaneNotice'

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

  it('does not treat a missing relation as a missing constellation RPC', () => {
    const relationGone = 'relation "ladder_rules" does not exist'
    expect(humanizeControlPlaneError(relationGone)).not.toMatch(/function is not deployed/)
    expect(humanizeControlPlaneError(relationGone, '42P01')).toMatch(/relation is missing/)
    expect(isMissingRpcError({ message: relationGone })).toBe(false)
    expect(isMissingRpcError({ code: '42P01', message: relationGone })).toBe(false)
  })

  it('does not treat a missing column as a missing constellation RPC', () => {
    expect(humanizeControlPlaneError('column "generated_at" does not exist')).not.toMatch(
      /function is not deployed/,
    )
    expect(isMissingRpcError({ code: '42703', message: 'column "generated_at" does not exist' })).toBe(
      false,
    )
  })

  it('still names a missing RPC as not deployed', () => {
    const schemaCache =
      'Could not find the function public.constellation_ladder without parameters in the schema cache'
    expect(isMissingRpcError({ code: 'PGRST202', message: schemaCache })).toBe(true)
    expect(isMissingRpcError({ message: schemaCache })).toBe(true)
    expect(humanizeControlPlaneError(schemaCache, 'PGRST202')).toMatch(/not deployed/)
    expect(isMissingRpcError({ code: '42883', message: 'function constellation_status() does not exist' })).toBe(
      true,
    )
  })
})
