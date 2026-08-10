/**
 * Owner sign-in via Supabase magic link.
 *
 * A note on what this does and does not reuse. The wiring brief said to reuse
 * "the magic-link pattern already proven in Control Panel". Reading
 * codex-control-panel, that pattern is not what is there: it gates its API
 * routes with a shared APP_ACCESS_TOKEN and then calls persist_route_atomic
 * with a SERVICE-ROLE key held server-side (lib/supabase-server.ts). That works
 * for a Next.js app with a server. The hub is a static SPA — it has nowhere to
 * hold a service-role key, and putting one in a browser bundle would hand
 * every visitor full control-plane write access.
 *
 * So the hub uses real Supabase Auth (signInWithOtp) instead: the browser gets
 * a user JWT, never a privileged key, and every elevated operation is executed
 * by an Edge Function that checks the JWT and holds the service-role key
 * server-side. Same destination as the Control Panel, correct mechanism for a
 * client with no server. The brief's constraint — "there is no service-role key
 * in the browser — keep it that way" — is preserved exactly.
 */
import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export type SignInState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'sent'; email: string }
  | { phase: 'error'; message: string }

export interface OwnerSession {
  session: Session | null
  /** True once the initial getSession() has resolved — before that, unknown. */
  ready: boolean
  signInState: SignInState
  sendMagicLink: (email: string) => Promise<void>
  signOut: () => Promise<void>
  resetSignInState: () => void
}

export function useOwnerSession(): OwnerSession {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [signInState, setSignInState] = useState<SignInState>({ phase: 'idle' })

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setReady(true)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      // A completed sign-in should clear the "check your email" banner.
      if (next) setSignInState({ phase: 'idle' })
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const sendMagicLink = useCallback(async (email: string) => {
    const trimmed = email.trim()
    if (!trimmed) {
      setSignInState({ phase: 'error', message: 'Enter the owner email address.' })
      return
    }
    setSignInState({ phase: 'sending' })
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: window.location.origin,
        // Sign-in only. The owner account already exists; this hub is not a
        // signup surface and must not mint accounts for arbitrary addresses.
        shouldCreateUser: false,
      },
    })
    if (error) {
      setSignInState({ phase: 'error', message: error.message })
      return
    }
    setSignInState({ phase: 'sent', email: trimmed })
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSignInState({ phase: 'idle' })
  }, [])

  const resetSignInState = useCallback(() => setSignInState({ phase: 'idle' }), [])

  return { session, ready, signInState, sendMagicLink, signOut, resetSignInState }
}
