import { useEffect, useState } from 'react'
import '../App.css'
import { useOwnerSession } from '../hooks/useOwnerSession'
import { useConstellation } from '../hooks/useConstellation'
import { askFlock, confirmRoute, type FlockAnswer } from '../lib/flockAsk'
import {
  TERRITORIES,
  TRUTH_LADDER,
  type LadderEntry,
  type TruthStage,
} from '../lib/ladder'

/* ------------------------------------------------------------------ */
/* Doctrine                                                             */
/* ------------------------------------------------------------------ */

/** The chips are prompt starters, not decoration — each is a real question. */
const CHIPS = [
  'Which territories are Live on evidence, not assertion?',
  'What would it take to promote Foundry Console to Live?',
  'What is the control plane telling us that the ladder is not?',
  'Route a task to the flock',
]

const DOCTRINES = [
  {
    quote: 'Don’t preserve every experience. Preserve what the experience taught the system.',
    name: 'The Goose Principle',
  },
  {
    quote:
      'The human reverse-engineered the vision into machinery. The AI reverse-engineered the machinery back into the vision.',
    name: 'The Recursion',
  },
  { quote: 'The deployment is innocent only after verification.', name: 'Fear-Based DevOps' },
]

/* ------------------------------------------------------------------ */
/* Glyphs                                                               */
/* ------------------------------------------------------------------ */

function Sparkle({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={`sparkle-breathe ${className}`} aria-hidden>
      <defs>
        <linearGradient id="sparkgrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4796e3" />
          <stop offset="55%" stopColor="#9177c7" />
          <stop offset="100%" stopColor="#d96570" />
        </linearGradient>
      </defs>
      <path
        d="M12 2c.6 4.8 2.4 7.8 4.6 9.4 1.4 1 3.2 1.9 5.4 2.6-4.8.9-8.2 3.2-10 8-.6-4.8-2.4-7.8-4.6-9.4C6 11.6 4.2 10.7 2 10c4.8-.9 8.2-3.2 10-8z"
        fill="url(#sparkgrad)"
      />
    </svg>
  )
}

function TruthLadder({ stage, muted }: { stage: TruthStage; muted: boolean }) {
  return (
    <div className="flex items-center gap-1.5" title={`Truth ladder: ${TRUTH_LADDER[stage]}`}>
      {TRUTH_LADDER.map((label, i) => {
        const reached = i <= stage
        // Only an evidence-backed Live pulses. A declared Live sits still —
        // the animation is reserved for something we actually measured.
        const isLive = stage === 3 && i === 3 && !muted
        return (
          <div key={label} className="flex items-center gap-1.5">
            <div
              className={`h-1.5 w-1.5 rounded-full ${isLive ? 'live-pulse' : ''}`}
              style={{
                backgroundColor: reached
                  ? isLive
                    ? '#34a853'
                    : 'var(--ladder-reached)'
                  : 'var(--line)',
                opacity: reached && muted ? 0.55 : 1,
              }}
            />
            <span
              className="text-[10px] font-medium tracking-wide"
              style={{ color: reached ? 'var(--text-2)' : 'var(--text-3)', opacity: muted ? 0.7 : 1 }}
            >
              {label}
            </span>
            {i < TRUTH_LADDER.length - 1 && <div className="h-px w-2" style={{ background: 'var(--line)' }} />}
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Up late, Eddie'
  if (h < 12) return 'Good morning, Eddie'
  if (h < 17) return 'Good afternoon, Eddie'
  return 'Good evening, Eddie'
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

const MONO = "'JetBrains Mono', monospace"

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

export default function Home() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const param = new URLSearchParams(window.location.search).get('theme')
    if (param === 'light' || param === 'dark') return param
    const saved = localStorage.getItem('flock-theme')
    return saved === 'light' ? 'light' : 'dark'
  })
  const [query, setQuery] = useState('')
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState<FlockAnswer | null>(null)
  const [askError, setAskError] = useState<string | null>(null)
  const [routeState, setRouteState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [routeError, setRouteError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [showSignIn, setShowSignIn] = useState(false)

  const owner = useOwnerSession()
  const constellation = useConstellation(Boolean(owner.session))

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('flock-theme', theme)
  }, [theme])

  const liveCount = constellation.ladder.filter((e) => e.stage === 3 && e.basis === 'rule').length

  async function handleAsk() {
    const question = query.trim()
    if (!question || asking) return
    setAsking(true)
    setAskError(null)
    setAnswer(null)
    setRouteState('idle')
    setRouteError(null)
    const result = await askFlock(question)
    if (result.ok) setAnswer(result.data)
    else setAskError(result.message)
    setAsking(false)
  }

  async function handleConfirmRoute() {
    if (!answer?.proposed_route) return
    setRouteState('saving')
    setRouteError(null)
    const result = await confirmRoute(answer.proposed_route)
    if (result.ok) {
      setRouteState('saved')
      constellation.refresh()
    } else {
      setRouteState('error')
      setRouteError(result.message)
    }
  }

  const syncLabel = (() => {
    switch (constellation.sync) {
      case 'syncing':
        return 'syncing control plane…'
      case 'live':
        return `${liveCount} Live on evidence · ${
          constellation.lastUpdatedAt ? timeAgo(constellation.lastUpdatedAt) : ''
        }`
      case 'degraded':
        return 'control plane degraded'
      case 'error':
        return 'control plane unreachable'
    }
  })()

  const syncColor =
    constellation.sync === 'error' ? '#d96570' : constellation.sync === 'degraded' ? '#e8934a' : '#34a853'

  return (
    <div
      className="theme-fade relative min-h-screen"
      style={{ background: 'var(--bg)', fontFamily: "'Outfit', 'Google Sans', sans-serif", color: 'var(--text)' }}
    >
      {/* Ambient orbs */}
      <div className="orb" style={{ width: 520, height: 220, top: -70, left: '6%' }} />
      <div className="orb" style={{ width: 440, height: 190, top: '40%', right: '-5%' }} />
      <div className="orb" style={{ width: 400, height: 170, bottom: -50, left: '20%' }} />

      {/* Nav */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 pt-7">
        <div className="flex items-center gap-2.5">
          <Sparkle size={26} />
          <span className="gemini-gradient text-lg font-semibold tracking-tight">Artful Intelligence</span>
        </div>
        <div className="flex items-center gap-3">
          <div
            className="hidden items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium sm:flex"
            style={{ background: 'var(--surface-2)', backdropFilter: 'blur(8px)', color: syncColor }}
            title={constellation.notice ?? undefined}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                constellation.sync === 'syncing' ? 'sync-pulse' : 'live-pulse'
              }`}
              style={{ background: syncColor }}
            />
            {syncLabel}
            {constellation.realtime === 'subscribed' && (
              <span style={{ color: 'var(--text-3)' }}>· realtime</span>
            )}
          </div>

          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle dark mode"
            className="toggle-track relative flex h-8 w-14 items-center rounded-full px-1"
            style={{ background: theme === 'dark' ? 'linear-gradient(90deg,#4796e3,#9177c7)' : 'var(--line)' }}
          >
            <span
              className="toggle-thumb flex h-6 w-6 items-center justify-center rounded-full text-[11px]"
              style={{
                background: 'var(--surface)',
                transform: theme === 'dark' ? 'translateX(24px)' : 'translateX(0)',
                boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
              }}
            >
              {theme === 'dark' ? '🌙' : '☀️'}
            </span>
          </button>

          <button
            onClick={() => (owner.session ? void owner.signOut() : setShowSignIn((v) => !v))}
            className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white"
            style={{
              background: owner.session
                ? 'linear-gradient(135deg,#4796e3,#9177c7)'
                : 'var(--surface-2)',
              color: owner.session ? '#fff' : 'var(--text-2)',
            }}
            title={owner.session ? 'Signed in as owner — click to sign out' : 'Owner sign-in'}
            aria-label={owner.session ? 'Sign out' : 'Owner sign in'}
          >
            E
          </button>
        </div>
      </header>

      {/* Owner sign-in */}
      {showSignIn && !owner.session && (
        <div className="relative z-10 mx-auto mt-4 max-w-md px-6">
          <div
            className="rounded-3xl p-5"
            style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
          >
            <p className="text-sm font-semibold tracking-tight">Owner sign-in</p>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
              A magic link unlocks the command bar and realtime updates. Read-only
              aggregates are public and need no session.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@example.com"
                className="w-full rounded-full px-4 py-2 text-sm outline-none"
                style={{ background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--line)' }}
              />
              <button
                onClick={() => void owner.sendMagicLink(email)}
                disabled={owner.signInState.phase === 'sending'}
                className="shrink-0 rounded-full px-4 py-2 text-sm font-medium text-white"
                style={{ background: 'linear-gradient(90deg,#4796e3,#9177c7)' }}
              >
                {owner.signInState.phase === 'sending' ? 'Sending…' : 'Send link'}
              </button>
            </div>
            {owner.signInState.phase === 'sent' && (
              <p className="mt-2 text-xs" style={{ color: '#34a853' }}>
                Link sent to {owner.signInState.email}. Check your inbox.
              </p>
            )}
            {owner.signInState.phase === 'error' && (
              <p className="mt-2 text-xs" style={{ color: '#d96570' }}>
                {owner.signInState.message}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Hero */}
      <section className="relative z-10 mx-auto max-w-3xl px-6 pt-20 text-center sm:pt-24">
        <div className="mb-6 flex justify-center">
          <Sparkle size={46} />
        </div>
        <h1 className="text-4xl font-medium leading-tight tracking-tight sm:text-[3.4rem] sm:leading-[1.1]">
          <span className="gemini-gradient font-semibold">{greeting()}.</span>
          <br />
          <span style={{ color: 'var(--text)' }}>One home for the whole flock.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Every project, every agent, every doctrine — unified behind a single command bar,
          reading the live control plane as it moves.
        </p>

        {/* Command bar */}
        <div
          className="command-bar mx-auto mt-10 flex items-center gap-3 rounded-[2rem] px-5 py-4"
          style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
        >
          <Sparkle size={20} className="shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleAsk()
            }}
            placeholder={owner.session ? 'Ask the flock anything…' : 'Sign in as owner to ask the flock…'}
            className="w-full bg-transparent text-base outline-none"
            style={{ color: 'var(--text)' }}
          />
          <button
            onClick={() => void handleAsk()}
            disabled={asking || !owner.session || !query.trim()}
            className="shrink-0 rounded-full px-4 py-2 text-sm font-medium text-white transition-transform hover:scale-[1.03] disabled:opacity-50"
            style={{ background: 'linear-gradient(90deg,#4796e3,#9177c7,#d96570)', backgroundSize: '200% auto' }}
          >
            {asking ? 'Thinking…' : 'Send'}
          </button>
        </div>

        {/* Chips — real prompt starters */}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {CHIPS.map((chip) => (
            <button
              key={chip}
              onClick={() => setQuery(chip)}
              className="chip rounded-full border px-3.5 py-1.5 text-xs font-medium"
              style={{ borderColor: 'var(--line)', color: 'var(--text-2)', background: 'var(--surface-2)' }}
            >
              {chip}
            </button>
          ))}
        </div>

        {askError && (
          <div
            className="mx-auto mt-6 max-w-2xl rounded-3xl p-5 text-left text-sm"
            style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)', color: '#d96570' }}
          >
            {askError}
          </div>
        )}

        {answer && <AnswerCard
          answer={answer}
          routeState={routeState}
          routeError={routeError}
          onConfirm={() => void handleConfirmRoute()}
        />}
      </section>

      {/* Constellation */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pt-24">
        <div className="mb-8">
          <h2 className="text-xl font-semibold tracking-tight">The Constellation</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-2)' }}>
            Seven territories. One truth ladder:{' '}
            <span style={{ fontFamily: MONO, fontSize: 12 }}>Merged ≠ Deployed ≠ Verified ≠ Live</span>
          </p>
          <p className="mt-2 text-xs" style={{ color: 'var(--text-3)' }}>
            <LadderProvenance source={constellation.ladderSource} notice={constellation.notice} />
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TERRITORIES.map((t) => {
            const entry: LadderEntry | undefined = constellation.ladderByTerritory.get(t.name)
            const stage = entry?.stage ?? t.declaredStage
            const declaredOnly = (entry?.basis ?? 'declared') === 'declared'
            return (
              <article
                key={t.name}
                className="project-card rounded-3xl p-6"
                style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-base"
                    style={{ background: `${t.hue}18`, color: t.hue }}
                  >
                    {t.glyph}
                  </div>
                  <TruthLadder stage={stage} muted={declaredOnly} />
                </div>
                <h3 className="mt-4 text-base font-semibold tracking-tight">{t.name}</h3>
                <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
                  {t.tagline}
                </p>

                {entry?.signal ? (
                  <p
                    className="mt-4 flex items-center gap-1.5 text-xs"
                    style={{ color: '#34a853', fontFamily: MONO }}
                  >
                    <span className="live-pulse inline-block h-1 w-1 rounded-full" style={{ background: '#34a853' }} />
                    {entry.signal}
                  </p>
                ) : (
                  // No live signal. Say so — never let a declared stage read as
                  // a measured one.
                  <p className="mt-4 text-xs" style={{ color: 'var(--text-3)', fontFamily: MONO }}>
                    declared only · no control-plane signal wired
                  </p>
                )}
              </article>
            )
          })}

          <article
            className="project-card rounded-3xl p-6"
            style={{
              background:
                'linear-gradient(135deg, rgba(71,150,227,0.09), rgba(145,119,199,0.11), rgba(217,101,112,0.09))',
              border: '1px solid rgba(145,119,199,0.25)',
            }}
          >
            <Sparkle size={24} />
            <h3 className="mt-4 text-base font-semibold tracking-tight">The Next Territory</h3>
            <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
              Every weird analogy is a candidate structure. The flock is listening — throw the
              boomerang and it will be caught.
            </p>
            <p className="mt-4 text-xs font-medium" style={{ color: '#9177c7' }}>
              A goose is not always a goose.
            </p>
          </article>
        </div>

        {/* Live event stream */}
        {constellation.status && constellation.status.recent_event_kinds.length > 0 && (
          <div className="mt-6 rounded-3xl p-6" style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}>
            <h3 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--text-2)' }}>
              Control plane pulse
              {constellation.realtime !== 'subscribed' && (
                <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-3)' }}>
                  · polling every 45s{owner.session ? '' : ' — realtime needs an owner session'}
                </span>
              )}
            </h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {constellation.status.recent_event_kinds.map((e, i) => (
                <span
                  key={`${e.at}-${i}`}
                  className="rounded-full px-3 py-1.5 text-xs"
                  style={{
                    background: 'var(--surface-2)',
                    color: 'var(--text-2)',
                    fontFamily: MONO,
                    border: '1px solid var(--line)',
                  }}
                >
                  {e.action} · {timeAgo(e.at)}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Doctrine */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-24">
        <h2 className="mb-8 text-xl font-semibold tracking-tight">Doctrine, inherited</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {DOCTRINES.map((d) => (
            <blockquote
              key={d.name}
              className="rounded-3xl p-7"
              style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
            >
              <p className="text-[15px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
                “{d.quote}”
              </p>
              <footer className="gemini-gradient mt-4 text-sm font-semibold">{d.name}</footer>
            </blockquote>
          ))}
        </div>

        <p className="mt-12 text-center text-sm" style={{ color: 'var(--text-3)' }}>
          MasterChef-certified surfaces only ·{' '}
          <span style={{ fontFamily: MONO, fontSize: 12 }}>
            reading the cookbook makes you a diner — catching the boomerang makes you a chef
          </span>
        </p>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                       */
/* ------------------------------------------------------------------ */

/** Names where the stages on screen came from. Never let the UI imply more. */
function LadderProvenance({
  source,
  notice,
}: {
  source: 'server' | 'fallback' | 'declared'
  notice: string | null
}) {
  if (source === 'server') {
    return <>Stages evaluated server-side from ladder_rules — the canonical ruleset.</>
  }
  if (source === 'fallback') {
    return (
      <>
        Stages derived in the browser from live aggregates (v1 client mirror).
        {notice ? ` ${notice}` : ' constellation_ladder() was unavailable.'}
      </>
    )
  }
  return (
    <>
      No control-plane data. Every stage below is the owner’s declaration, not a
      measurement.{notice ? ` ${notice}` : ''}
    </>
  )
}

function AnswerCard({
  answer,
  routeState,
  routeError,
  onConfirm,
}: {
  answer: FlockAnswer
  routeState: 'idle' | 'saving' | 'saved' | 'error'
  routeError: string | null
  onConfirm: () => void
}) {
  const degraded =
    !answer.grounding.status_available ||
    !answer.grounding.ladder_available ||
    answer.grounding.doctrine_source === 'embedded'

  return (
    <div
      className="mx-auto mt-6 max-w-2xl rounded-3xl p-6 text-left"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-[15px] leading-relaxed" style={{ color: 'var(--text)' }}>
        {answer.answer}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs" style={{ fontFamily: MONO }}>
        <span
          className="rounded-full px-3 py-1"
          style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--line)' }}
        >
          confidence {answer.confidence}
        </span>
        {degraded && (
          <span
            className="rounded-full px-3 py-1"
            style={{ background: 'var(--surface-2)', color: '#e8934a', border: '1px solid var(--line)' }}
            title={[
              answer.grounding.status_error,
              answer.grounding.ladder_error,
              answer.grounding.doctrine_source === 'embedded' ? 'doctrine: embedded fallback' : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          >
            partially grounded
          </span>
        )}
      </div>

      {answer.required_evidence && (
        <p className="mt-4 text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
          <span style={{ color: 'var(--text-3)' }}>Required evidence — </span>
          {answer.required_evidence}
        </p>
      )}

      {answer.proposed_route && (
        <div className="mt-5 rounded-2xl p-4" style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
          <p className="text-xs font-semibold tracking-tight" style={{ color: 'var(--text-2)' }}>
            Proposed route — not persisted until you confirm
          </p>
          <dl className="mt-3 grid gap-1 text-xs" style={{ fontFamily: MONO, color: 'var(--text-2)' }}>
            <div>repository · {answer.proposed_route.repository}</div>
            <div>lane · {answer.proposed_route.execution_lane}</div>
            <div>agent · {answer.proposed_route.selected_agent}</div>
            <div>
              risk · {answer.proposed_route.risk} · sensitivity · {answer.proposed_route.sensitivity}
            </div>
            <div>evidence · {answer.proposed_route.evidence_kind}</div>
          </dl>
          <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
            {answer.proposed_route.rationale}
          </p>

          {routeState === 'saved' ? (
            <p className="mt-3 text-xs" style={{ color: '#34a853' }}>
              Route persisted to the control plane.
            </p>
          ) : (
            <button
              onClick={onConfirm}
              disabled={routeState === 'saving'}
              className="mt-3 rounded-full px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(90deg,#4796e3,#9177c7)' }}
            >
              {routeState === 'saving' ? 'Persisting…' : 'Confirm and persist'}
            </button>
          )}
          {routeError && (
            <p className="mt-2 text-xs" style={{ color: '#d96570' }}>
              {routeError}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
