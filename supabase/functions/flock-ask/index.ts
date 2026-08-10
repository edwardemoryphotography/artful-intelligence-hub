/**
 * flock-ask — the command bar's brain.
 *
 * WHY AN EDGE FUNCTION AND NOT A DIRECT CLIENT CALL
 * The hub is a static SPA. Two things it cannot do from the browser:
 *   1. Hold an ANTHROPIC_API_KEY (it would ship to every visitor).
 *   2. Call persist_route_atomic — that RPC is granted to service_role ONLY
 *      and explicitly revoked from anon and authenticated
 *      (legacy-codex 20260804020000_routing_control_plane_hardening.sql:447).
 *      An authenticated browser session genuinely cannot write a route, no
 *      matter how the UI is written. The wiring brief's phrasing — "persistence
 *      MUST go through persist_route_owner / persist_route_atomic" — is honored
 *      here, but note persist_route_owner does not exist in any migration in
 *      the ecosystem; persist_route_atomic is the real single write path.
 *
 * SAFETY POSTURE
 *   * Owner session required. The user's JWT is verified server-side; when
 *     FLOCK_OWNER_EMAIL is set, the email must match too.
 *   * mode='ask' NEVER writes. It answers and may PROPOSE a route.
 *   * mode='persist' requires the caller to echo back the proposal AND set
 *     confirm=true. The model cannot self-confirm: confirmation is a separate
 *     request carrying a human decision, which is the doctrine's
 *     Question -> Options -> Decision -> Draft -> Approval loop expressed in
 *     an API boundary rather than in prose.
 *   * Grounding is fetched before answering, never invented.
 */
import Anthropic from 'npm:@anthropic-ai/sdk@0.72.0'
import { createClient } from 'npm:@supabase/supabase-js@2.109.0'

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('FLOCK_ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/**
 * Doctrine floor. Used when the canonical GOOSE-COOKBOOK.md is unreachable.
 * The response always reports which grounding was actually used, so a
 * degraded answer is never presented as a fully-grounded one.
 */
const DOCTRINE_FALLBACK = `
The Goose Principle: Don't preserve every experience. Preserve what the
experience taught the system.

CATCH THE FUCKING BOOMERANG: when different analogies, artifacts, corrections,
or implementations keep returning to the same latent structure, infer the shared
architecture instead of treating them as unrelated topics.

The truth ladder is law: Merged != Deployed != Runtime Verified != Live. Never
mark anything Live without runtime evidence. Preserve honest pending/unknown
states.

Fear-Based DevOps: the deployment is innocent only after verification.
Green build != working integration.

The build can become the explanation. New implementation evidence may make a
pre-existing end-state newly legible; do not narrate that as a newly expanded
vision.
`.trim()

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'confidence', 'required_evidence', 'proposed_route'],
  properties: {
    answer: {
      type: 'string',
      description: 'The grounded answer. Cite the aggregate you relied on when you use one.',
    },
    confidence: {
      type: 'integer',
      description: '0-100. Low when the control plane could not substantiate the claim.',
    },
    required_evidence: {
      type: 'string',
      description:
        'What would have to be observed to raise this from assertion to evidence. Never empty — if the answer is fully grounded, say what already substantiates it.',
    },
    proposed_route: {
      description: 'A route proposal, or null when the ask is a question rather than work.',
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: [
            'intent',
            'repository',
            'task_type',
            'execution_lane',
            'selected_agent',
            'risk',
            'sensitivity',
            'required_evidence',
            'rationale',
            'confidence',
            'evidence_kind',
          ],
          properties: {
            intent: { type: 'string' },
            repository: { type: 'string', description: 'owner/repo' },
            task_type: {
              type: 'string',
              enum: ['review', 'implement', 'research', 'design', 'document', 'operate', 'triage'],
            },
            execution_lane: {
              type: 'string',
              enum: [
                'execution',
                'research',
                'architecture',
                'deployment',
                'documentation',
                'system_state',
                'override',
              ],
            },
            selected_agent: { type: 'string' },
            risk: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            sensitivity: {
              type: 'string',
              enum: ['public', 'internal', 'private', 'restricted'],
            },
            required_evidence: { type: 'string' },
            rationale: { type: 'string' },
            confidence: { type: 'integer' },
            evidence_kind: {
              type: 'string',
              enum: [
                'merged_pr',
                'live_deployment',
                'published_artifact',
                'confirmed_action',
                'test_run',
                'custom',
              ],
            },
          },
        },
      ],
    },
  },
}

const SYSTEM_PROMPT = `
You are the command bar of Artful Intelligence — the unified hub for Eddie's
Legacy Codex ecosystem. You answer questions about the state of the flock and
propose routes for work.

You are given, below, the canonical doctrine and a live snapshot of the
foundry-console control plane. Ground every claim in one of them.

Hard rules:
- The truth ladder is law: Merged != Deployed != Runtime Verified != Live.
  Never describe anything as Live unless the snapshot carries evidence for it.
  "The migration exists in the repo" is Merged, not Deployed.
- Distinguish measurement from assertion. A territory whose ladder basis is
  'declared' has NO live signal — say so plainly rather than repeating the
  declared stage as though it were observed.
- When the snapshot cannot substantiate an answer, say what is unknown and put
  what would settle it in required_evidence. An honest unknown outranks a
  confident guess.
- The snapshot is deliberately coarse: counts, lanes, repositories, timestamps.
  It contains no task titles or intent text. Do not pretend to know specifics
  it does not carry.
- Propose a route only when the ask is work to be done. A question about state
  gets proposed_route: null.
- You never persist anything. A proposal is a draft for the owner to approve.
`.trim()

interface Grounding {
  doctrine: string
  doctrineSource: 'canonical' | 'embedded'
  status: unknown
  ladder: unknown
  statusError: string | null
  ladderError: string | null
}

let doctrineCache: { text: string; source: 'canonical' | 'embedded'; at: number } | null = null
const DOCTRINE_TTL_MS = 10 * 60 * 1000

async function loadDoctrine(): Promise<{ text: string; source: 'canonical' | 'embedded' }> {
  if (doctrineCache && Date.now() - doctrineCache.at < DOCTRINE_TTL_MS) {
    return { text: doctrineCache.text, source: doctrineCache.source }
  }
  const url = Deno.env.get('GOOSE_COOKBOOK_URL')
  if (url) {
    try {
      const res = await fetch(url, {
        headers: Deno.env.get('GOOSE_COOKBOOK_TOKEN')
          ? { authorization: `Bearer ${Deno.env.get('GOOSE_COOKBOOK_TOKEN')}` }
          : {},
      })
      if (res.ok) {
        const text = await res.text()
        doctrineCache = { text, source: 'canonical', at: Date.now() }
        return { text, source: 'canonical' }
      }
    } catch {
      // Fall through to the embedded floor — reported honestly below.
    }
  }
  doctrineCache = { text: DOCTRINE_FALLBACK, source: 'embedded', at: Date.now() }
  return { text: DOCTRINE_FALLBACK, source: 'embedded' }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey) {
    return json({ error: 'Function is misconfigured: SUPABASE_URL / SUPABASE_ANON_KEY missing.' }, 503)
  }

  // ---- Owner gate -------------------------------------------------------
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : ''
  if (!jwt) return json({ error: 'Owner session required.' }, 401)

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  })
  const { data: userData, error: userError } = await authClient.auth.getUser()
  if (userError || !userData?.user) {
    return json({ error: 'Owner session required.' }, 401)
  }
  const ownerEmail = Deno.env.get('FLOCK_OWNER_EMAIL')?.trim().toLowerCase()
  if (ownerEmail && userData.user.email?.trim().toLowerCase() !== ownerEmail) {
    return json({ error: 'This session is authenticated but is not the owner.' }, 403)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body must be JSON.' }, 400)
  }

  const mode = typeof body.mode === 'string' ? body.mode : 'ask'

  // ---- Grounding --------------------------------------------------------
  // Read through the caller's session; both functions are anon-safe and the
  // owner session is at least as privileged as anon.
  const [doctrine, statusRes, ladderRes] = await Promise.all([
    loadDoctrine(),
    authClient.rpc('constellation_status'),
    authClient.rpc('constellation_ladder'),
  ])

  const grounding: Grounding = {
    doctrine: doctrine.text,
    doctrineSource: doctrine.source,
    status: statusRes.data ?? null,
    ladder: ladderRes.data ?? null,
    statusError: statusRes.error?.message ?? null,
    ladderError: ladderRes.error?.message ?? null,
  }

  // ---- mode: persist ----------------------------------------------------
  if (mode === 'persist') {
    if (body.confirm !== true) {
      return json(
        { error: 'Persistence requires an explicit confirm:true from the owner.' },
        400,
      )
    }
    if (!serviceKey) {
      return json(
        {
          error:
            'Route persistence is unavailable: SUPABASE_SERVICE_ROLE_KEY is not set on this function. ' +
            'persist_route_atomic is granted to service_role only, so there is no browser-side path.',
        },
        503,
      )
    }
    const workspaceId = Deno.env.get('FOUNDRY_WORKSPACE_ID')
    if (!workspaceId) {
      return json({ error: 'Route persistence is unavailable: FOUNDRY_WORKSPACE_ID is not set.' }, 503)
    }
    const route = body.route as Record<string, unknown> | undefined
    if (!route || typeof route !== 'object') {
      return json({ error: 'mode=persist requires the route object being confirmed.' }, 400)
    }

    const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    const payload = {
      workspace_id: workspaceId,
      idempotency_key: typeof body.idempotency_key === 'string' ? body.idempotency_key : crypto.randomUUID(),
      supersedes_request_id: null,
      correction_reason: null,
      intent: route.intent,
      task_type: route.task_type,
      execution_lane: route.execution_lane,
      selected_agent: route.selected_agent,
      repository: route.repository,
      repository_path: null,
      risk: route.risk,
      sensitivity: route.sensitivity,
      required_evidence: route.required_evidence,
      rationale: route.rationale,
      confidence: route.confidence,
      // The model proposed it and a human confirmed it — that is 'model',
      // not 'user'. Mislabeling provenance would corrupt the audit trail.
      route_source: 'model',
      evidence_kind: route.evidence_kind ?? 'custom',
      confirmations: {
        destructive: false,
        protectedOperation: false,
        publicExposure: false,
      },
    }

    const { data, error } = await service.rpc('persist_route_atomic', { p_proposal: payload })
    if (error) {
      return json({ error: `persist_route_atomic rejected the route: ${error.message}` }, 422)
    }
    return json({ persisted: true, result: data })
  }

  // ---- mode: ask --------------------------------------------------------
  const question = typeof body.question === 'string' ? body.question.trim() : ''
  if (!question) return json({ error: 'question is required.' }, 400)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return json(
      { error: 'The command bar is not wired: ANTHROPIC_API_KEY is not set on this function.' },
      503,
    )
  }

  const anthropic = new Anthropic({ apiKey })

  const groundingBlock = [
    '<doctrine>',
    grounding.doctrine,
    '</doctrine>',
    '<control_plane_snapshot>',
    grounding.statusError
      ? `constellation_status UNAVAILABLE: ${grounding.statusError}`
      : JSON.stringify(grounding.status),
    '</control_plane_snapshot>',
    '<truth_ladder_snapshot>',
    grounding.ladderError
      ? `constellation_ladder UNAVAILABLE: ${grounding.ladderError}`
      : JSON.stringify(grounding.ladder),
    '</truth_ladder_snapshot>',
  ].join('\n')

  let message
  try {
    message = await anthropic.messages.create({
      model: Deno.env.get('FLOCK_ASK_MODEL') ?? 'claude-opus-5',
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
      messages: [{ role: 'user', content: `${groundingBlock}\n\nOwner asks: ${question}` }],
    })
  } catch (err) {
    return json({ error: `Model call failed: ${err instanceof Error ? err.message : String(err)}` }, 502)
  }

  // Check the stop reason before reading content — a refusal carries no answer.
  if (message.stop_reason === 'refusal') {
    return json(
      {
        error: 'The model declined this request.',
        stop_details: message.stop_details ?? null,
      },
      422,
    )
  }

  const textBlock = message.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    return json({ error: 'Model returned no text content.' }, 502)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(textBlock.text)
  } catch {
    return json({ error: 'Model returned unparseable JSON.', raw: textBlock.text }, 502)
  }

  return json({
    ...(parsed as Record<string, unknown>),
    grounding: {
      doctrine_source: grounding.doctrineSource,
      status_available: grounding.statusError === null,
      ladder_available: grounding.ladderError === null,
      status_error: grounding.statusError,
      ladder_error: grounding.ladderError,
    },
  })
})
