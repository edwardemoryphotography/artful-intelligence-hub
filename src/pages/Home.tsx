import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import '../App.css'

/* ------------------------------------------------------------------ */
/* Live connection — foundry-console control plane                      */
/* ------------------------------------------------------------------ */

const SUPABASE_URL = 'https://pkydkbuodikttfeawqsw.supabase.co'
const SUPABASE_KEY = 'sb_publishable_obr-7Y0u02p5c5pD-5f3Sw_zda5lWTa'
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

interface ConstellationStatus {
  generated_at: string
  route_status_counts: Record<string, number>
  route_lanes: string[]
  route_repos: string[]
  route_latest_at: string | null
  evidence_status_counts: Record<string, number>
  evidence_latest_at: string | null
  action_status_counts: Record<string, number>
  recent_event_kinds: { action: string; target_type: string; at: string }[]
  milestone_count: number
}

/* ------------------------------------------------------------------ */
/* The flock — declared state + live-signal derivation                  */
/* ------------------------------------------------------------------ */

type TruthStage = 0 | 1 | 2 | 3
const TRUTH_LADDER = ['Merged', 'Deployed', 'Verified', 'Live'] as const

interface Project {
  name: string
  tagline: string
  declared: TruthStage
  hue: string
  glyph: string
  derive?: (s: ConstellationStatus) => { stage: TruthStage; signal: string }
}

function count(rec: Record<string, number> | undefined, key: string): number {
  return rec?.[key] ?? 0
}

const PROJECTS: Project[] = [
  {
    name: 'Legacy Codex',
    tagline: 'Canonical memory — experience converted into inherited capability',
    declared: 3,
    hue: '#9177c7',
    glyph: '◆',
    derive: (s) => {
      const routed = s.route_repos.some((r) => r.includes('legacy-codex'))
      const confirmed = count(s.route_status_counts, 'confirmed')
      if (routed && confirmed > 0 && s.milestone_count > 0)
        return { stage: 2, signal: `${confirmed} route confirmed · ${s.milestone_count} milestones` }
      return { stage: 1, signal: 'awaiting routing evidence' }
    },
  },
  {
    name: 'Foundry Console',
    tagline: 'Routing control plane — human intent to technical execution',
    declared: 2,
    hue: '#4796e3',
    glyph: '▲',
    derive: (s) => {
      const confirmed = count(s.route_status_counts, 'confirmed')
      const verifiedEvidence = count(s.evidence_status_counts, 'verified')
      const pending = count(s.evidence_status_counts, 'pending')
      if (verifiedEvidence > 0) return { stage: 3, signal: `${verifiedEvidence} evidence verified` }
      if (confirmed > 0) return { stage: 2, signal: `${confirmed} route confirmed · ${pending} evidence pending` }
      return { stage: 0, signal: 'no confirmed routes' }
    },
  },
  {
    name: 'Control Panel',
    tagline: 'Mission control for agents, routes and evidence',
    declared: 1,
    hue: '#21a4c4',
    glyph: '●',
    derive: (s) => {
      const todo = count(s.action_status_counts, 'TODO')
      const done = count(s.action_status_counts, 'DONE')
      if (done > 0) return { stage: 2, signal: `${done} actions done` }
      return { stage: 1, signal: `${todo} actions queued` }
    },
  },
  { name: 'System Atlas', tagline: 'Knowledge graph as constellation — relationships are first-class', declared: 3, hue: '#d96570', glyph: '✦' },
  { name: 'PocketForge', tagline: 'iOS client — the bridge in your pocket', declared: 0, hue: '#e8934a', glyph: '■' },
  { name: 'Goose Cookbook', tagline: 'Canonical doctrine for every mind building the bridge', declared: 3, hue: '#c9a227', glyph: '🪿' },
  { name: 'LLM Wiki', tagline: 'Agent layer — origin sessions and inheritance evidence', declared: 3, hue: '#34a853', glyph: '◇' },
]

const CHIPS = [
  'Catch the fucking boomerang',
  'Verify before claiming Live',
  'What did this teach the system?',
  'Route a task to the flock',
]

const DOCTRINES = [
  { quote: 'Don’t preserve every experience. Preserve what the experience taught the system.', name: 'The Goose Principle' },
  { quote: 'The human reverse-engineered the vision into machinery. The AI reverse-engineered the machinery back into the vision.', name: 'The Recursion' },
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

function TruthLadder({ stage }: { stage: TruthStage }) {
  return (
    <div className="flex items-center gap-1.5" title={`Truth ladder: ${TRUTH_LADDER[stage]}`}>
      {TRUTH_LADDER.map((label, i) => {
        const reached = i <= stage
        const isLive = stage === 3 && i === 3
        return (
          <div key={label} className="flex items-center gap-1.5">
            <div
              className={`h-1.5 w-1.5 rounded-full ${isLive ? 'live-pulse' : ''}`}
              style={{ backgroundColor: reached ? (isLive ? '#34a853' : 'var(--ladder-reached)') : 'var(--line)' }}
            />
            <span className="text-[10px] font-medium tracking-wide" style={{ color: reached ? 'var(--text-2)' : 'var(--text-3)' }}>
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
  const [status, setStatus] = useState<ConstellationStatus | null>(null)
  const [live, setLive] = useState<'syncing' | 'live' | 'error'>('syncing')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('flock-theme', theme)
  }, [theme])

  useEffect(() => {
    let cancelled = false
    async function pull() {
      setLive('syncing')
      const { data, error } = await supabase.rpc('constellation_status')
      if (cancelled) return
      if (error) {
        console.error('constellation_status failed', error)
        setLive('error')
      } else {
        setStatus(data as ConstellationStatus)
        setLive('live')
      }
    }
    pull()
    const t = setInterval(pull, 60000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  const derived = useMemo(() => {
    const map = new Map<string, { stage: TruthStage; signal: string }>()
    for (const p of PROJECTS) {
      if (p.derive && status) map.set(p.name, p.derive(status))
      else map.set(p.name, { stage: p.declared, signal: '' })
    }
    return map
  }, [status])

  const liveCount = useMemo(
    () => PROJECTS.filter((p) => (derived.get(p.name)?.stage ?? p.declared) === 3).length,
    [derived],
  )

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
          {/* Live sync pill */}
          <div
            className="hidden items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium sm:flex"
            style={{ background: 'var(--surface-2)', backdropFilter: 'blur(8px)', color: live === 'error' ? '#d96570' : '#34a853' }}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${live === 'syncing' ? 'sync-pulse' : 'live-pulse'}`}
              style={{ background: live === 'error' ? '#d96570' : '#34a853' }}
            />
            {live === 'syncing' && 'syncing control plane…'}
            {live === 'live' && `${liveCount} Live · ladder moving · ${status ? timeAgo(status.generated_at) : ''}`}
            {live === 'error' && 'control plane unreachable'}
          </div>

          {/* Theme toggle */}
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

          <div
            className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white"
            style={{ background: 'linear-gradient(135deg,#4796e3,#9177c7)' }}
          >
            E
          </div>
        </div>
      </header>

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
            placeholder="Ask the flock anything…"
            className="w-full bg-transparent text-base outline-none"
            style={{ color: 'var(--text)' }}
          />
          <button
            className="shrink-0 rounded-full px-4 py-2 text-sm font-medium text-white transition-transform hover:scale-[1.03]"
            style={{ background: 'linear-gradient(90deg,#4796e3,#9177c7,#d96570)', backgroundSize: '200% auto' }}
          >
            Send
          </button>
        </div>

        {/* Chips */}
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
      </section>

      {/* Constellation */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pt-24">
        <div className="mb-8">
          <h2 className="text-xl font-semibold tracking-tight">The Constellation</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-2)' }}>
            Seven territories. One truth ladder:{' '}
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
              Merged ≠ Deployed ≠ Verified ≠ Live
            </span>
            {status && (
              <span className="ml-2" style={{ color: 'var(--text-3)', fontSize: 12 }}>
                — reading foundry-console · {timeAgo(status.generated_at)}
              </span>
            )}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROJECTS.map((p) => {
            const d = derived.get(p.name)
            const stage = d?.stage ?? p.declared
            return (
              <article
                key={p.name}
                className="project-card rounded-3xl p-6"
                style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-base"
                    style={{ background: `${p.hue}18`, color: p.hue }}
                  >
                    {p.glyph}
                  </div>
                  <TruthLadder stage={stage} />
                </div>
                <h3 className="mt-4 text-base font-semibold tracking-tight">{p.name}</h3>
                <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
                  {p.tagline}
                </p>
                {d?.signal && (
                  <p
                    className="mt-4 flex items-center gap-1.5 text-xs"
                    style={{ color: '#34a853', fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    <span className="live-pulse inline-block h-1 w-1 rounded-full" style={{ background: '#34a853' }} />
                    {d.signal}
                  </p>
                )}
              </article>
            )
          })}

          {/* Wildcard card */}
          <article
            className="project-card rounded-3xl p-6"
            style={{
              background: 'linear-gradient(135deg, rgba(71,150,227,0.09), rgba(145,119,199,0.11), rgba(217,101,112,0.09))',
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
        {status && status.recent_event_kinds.length > 0 && (
          <div
            className="mt-6 rounded-3xl p-6"
            style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
          >
            <h3 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--text-2)' }}>
              Control plane pulse
            </h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {status.recent_event_kinds.map((e, i) => (
                <span
                  key={`${e.at}-${i}`}
                  className="rounded-full px-3 py-1.5 text-xs"
                  style={{
                    background: 'var(--surface-2)',
                    color: 'var(--text-2)',
                    fontFamily: "'JetBrains Mono', monospace",
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
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
            reading the cookbook makes you a diner — catching the boomerang makes you a chef
          </span>
        </p>
      </section>
    </div>
  )
}
