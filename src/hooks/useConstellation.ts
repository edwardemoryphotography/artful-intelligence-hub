/**
 * Live control-plane state for the hub.
 *
 * Two update paths, deliberately layered:
 *
 *   Polling   — always on. Works for anon. The floor.
 *   Realtime  — only meaningful for an authenticated owner. Supabase Realtime
 *               applies RLS to postgres_changes, and routed_requests /
 *               evidence_items / events are authenticated-only, so an anon
 *               visitor would subscribe successfully and then never receive a
 *               row. Subscribing anonymously would produce a "live" indicator
 *               that is structurally incapable of updating — a lie in the UI.
 *               So realtime is attached only once a session exists.
 *
 * The ladder has three possible sources and the hook always reports which one
 * produced the stages on screen:
 *   'server'   — constellation_ladder() evaluated ladder_rules. Canonical.
 *   'fallback' — the function was unreachable or not yet deployed; stages came
 *                from the client mirror of the v1 ruleset over live aggregates.
 *   'declared' — no live data at all; stages are owner assertions only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchConstellationLadder, fetchConstellationStatus } from '../lib/constellation'
import {
  deriveLadderFallback,
  indexLadder,
  type ConstellationStatus,
  type LadderEntry,
} from '../lib/ladder'

export const POLL_INTERVAL_MS = 45_000
const REALTIME_DEBOUNCE_MS = 750

/** Tables whose changes should refresh the hub, when the session can see them. */
const WATCHED_TABLES = ['routed_requests', 'evidence_items', 'events', 'actions'] as const

export type SyncState = 'syncing' | 'live' | 'degraded' | 'error'
export type LadderSource = 'server' | 'fallback' | 'declared'
export type RealtimeState = 'off' | 'connecting' | 'subscribed' | 'unavailable'

export interface ConstellationState {
  status: ConstellationStatus | null
  ladder: LadderEntry[]
  ladderByTerritory: Map<string, LadderEntry>
  ladderSource: LadderSource
  sync: SyncState
  realtime: RealtimeState
  /** Human-readable reason the state is degraded or errored. */
  notice: string | null
  lastUpdatedAt: string | null
  refresh: () => void
}

export function useConstellation(hasSession: boolean): ConstellationState {
  const [status, setStatus] = useState<ConstellationStatus | null>(null)
  const [ladder, setLadder] = useState<LadderEntry[]>(() => deriveLadderFallback(null))
  const [ladderSource, setLadderSource] = useState<LadderSource>('declared')
  const [sync, setSync] = useState<SyncState>('syncing')
  const [channelState, setChannelState] = useState<Exclude<RealtimeState, 'off'>>('connecting')
  const [notice, setNotice] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)

  const cancelled = useRef(false)
  const inFlight = useRef(false)

  const pull = useCallback(async () => {
    // Realtime bursts and the poll timer can collide; one request at a time.
    if (inFlight.current) return
    inFlight.current = true
    try {
      const [statusResult, ladderResult] = await Promise.all([
        fetchConstellationStatus(),
        fetchConstellationLadder(),
      ])
      if (cancelled.current) return

      const nextStatus = statusResult.ok ? statusResult.data : null
      if (statusResult.ok) setStatus(statusResult.data)

      if (ladderResult.ok) {
        setLadder(ladderResult.data.territories)
        setLadderSource('server')
      } else {
        // No canonical ladder. Fall back, and say which floor we landed on.
        setLadder(deriveLadderFallback(nextStatus))
        setLadderSource(nextStatus ? 'fallback' : 'declared')
      }

      if (statusResult.ok && ladderResult.ok) {
        setSync('live')
        setNotice(null)
        setLastUpdatedAt(ladderResult.data.generated_at ?? statusResult.data.generated_at)
      } else if (statusResult.ok || ladderResult.ok) {
        setSync('degraded')
        setNotice(
          !ladderResult.ok && ladderResult.reason === 'missing_function'
            ? 'constellation_ladder() is not deployed on this project — showing client-derived v1 stages.'
            : (!statusResult.ok && statusResult.message) ||
                (!ladderResult.ok && ladderResult.message) ||
                'Partial control-plane response.',
        )
        setLastUpdatedAt(nextStatus?.generated_at ?? null)
      } else {
        setSync('error')
        setNotice(statusResult.ok ? null : statusResult.message)
      }
    } finally {
      inFlight.current = false
    }
  }, [])

  // Poll: immediately, then on an interval, plus whenever the tab regains focus.
  useEffect(() => {
    cancelled.current = false
    void pull()
    const timer = setInterval(() => void pull(), POLL_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void pull()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled.current = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [pull])

  // Realtime: owner sessions only, for the reason documented above.
  //
  // `channelState` tracks only the subscription itself; the 'off' case is
  // derived from hasSession below rather than written here. Writing it here
  // would be a synchronous setState in an effect body — a cascading render,
  // and a value React can compute for free from a prop it already has.
  useEffect(() => {
    if (!hasSession) return
    let debounce: ReturnType<typeof setTimeout> | undefined

    const channel = supabase.channel('constellation-changes')
    for (const table of WATCHED_TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        // Collapse bursts — persist_route_atomic writes several tables at once.
        clearTimeout(debounce)
        debounce = setTimeout(() => void pull(), REALTIME_DEBOUNCE_MS)
      })
    }

    channel.subscribe((state) => {
      if (state === 'SUBSCRIBED') setChannelState('subscribed')
      else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') setChannelState('unavailable')
    })

    return () => {
      clearTimeout(debounce)
      void supabase.removeChannel(channel)
      // Reset so a later re-subscribe reports 'connecting' rather than
      // inheriting the previous channel's status.
      setChannelState('connecting')
    }
  }, [hasSession, pull])

  const ladderByTerritory = useMemo(() => indexLadder(ladder), [ladder])

  // 'off' is a fact about the session, not about the channel — derive it.
  const realtime: RealtimeState = hasSession ? channelState : 'off'

  return {
    status,
    ladder,
    ladderByTerritory,
    ladderSource,
    sync,
    realtime,
    notice,
    lastUpdatedAt,
    refresh: () => void pull(),
  }
}
