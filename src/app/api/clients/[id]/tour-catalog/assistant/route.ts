/**
 * POST /api/clients/[id]/tour-catalog/assistant
 *
 * Runs the tour catalog AI assistant (global admins and client editors on the access list).
 * Takes a natural-language message plus optional history, returns a reply and a list of
 * validated catalog proposals. Every call first reserves one unit of the daily allowance
 * (per person and per client); the cost is recorded server-side afterwards, never returned.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import { loadDraftCatalog } from '@/lib/tour-catalog/store'
import {
  ASSISTANT_CLIENT_DAILY_COST_LIMIT_USD,
  ASSISTANT_CLIENT_DAILY_LIMIT,
  ASSISTANT_USER_DAILY_LIMIT,
  AssistantRunError,
  runAssistant,
} from '@/lib/tour-catalog/assistant'
import type { AssistantMessage } from '@/lib/tour-catalog/assistant'
import { getSettings, recordAssistantCost, reserveAssistantCall } from '@/lib/tour-catalog/store-access'
import { todayIso } from '@/lib/tour-catalog/dates'

export const dynamic = 'force-dynamic'

const MAX_MESSAGE_LENGTH = 2000
const HISTORY_LIMIT = 10
/** A single remembered turn is never longer than this; the body as a whole never larger than 64KB. */
const MAX_HISTORY_ITEM_LENGTH = 4000
const MAX_BODY_BYTES = 64 * 1024

interface RouteContext {
  params: Promise<{ id: string }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Keep only well-formed history entries; cap to the most recent HISTORY_LIMIT. */
function parseHistory(raw: unknown): AssistantMessage[] {
  if (!Array.isArray(raw)) return []
  const valid: AssistantMessage[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const role = item.role
    const content = item.content
    if (role !== 'user' && role !== 'assistant') continue
    if (typeof content !== 'string') continue
    valid.push({ role, content: content.slice(0, MAX_HISTORY_ITEM_LENGTH) })
  }
  return valid.slice(-HISTORY_LIMIT)
}

/** Usage is counted per UTC calendar day. */
function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10)
}

interface AssistantRequest {
  message: string
  history: AssistantMessage[]
  /** Which tour the admin has open. Only a hint: runAssistant ignores ids that are not in the catalog. */
  focusTourId: string | null
}

type ParsedRequest = { ok: true; value: AssistantRequest } | { ok: false; response: NextResponse }

async function readAssistantRequest(request: Request): Promise<ParsedRequest> {
  let body: unknown
  try {
    const text = await request.text()
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
      return { ok: false, response: NextResponse.json({ error: 'request_too_large' }, { status: 413 }) }
    }
    body = JSON.parse(text) as unknown
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'message_required' }, { status: 400 }) }
  }

  const record = isRecord(body) ? body : {}
  const message = record.message
  if (typeof message !== 'string' || message.trim() === '' || message.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, response: NextResponse.json({ error: 'message_required' }, { status: 400 }) }
  }
  const focusTourId =
    typeof record.focusTourId === 'string' && record.focusTourId.length <= 64 ? record.focusTourId : null
  return { ok: true, value: { message, history: parseHistory(record.history), focusTourId } }
}

/** Unknown counts as "not connected": the assistant then promises nothing about what customers see. */
async function channelsConnectedFor(clientId: string): Promise<boolean> {
  try {
    return (await getSettings(supabaseAdmin, clientId)).channelsConnected === true
  } catch (error) {
    console.warn('[tour-catalog-assistant] settings unreadable, assuming channels not connected', error)
    return false
  }
}

/** Run the model for an already-reserved call; whatever it cost is recorded, success or failure. */
async function runReserved(
  clientId: string,
  actor: string,
  usageDay: string,
  input: AssistantRequest,
  viewerCanPublish: boolean,
): Promise<NextResponse> {
  let costUsd = 0
  try {
    const snapshot = await loadDraftCatalog(supabaseAdmin, clientId)
    const today = todayIso(new Date())
    const channelsConnected = await channelsConnectedFor(clientId)
    const result = await runAssistant({ snapshot, ...input, today, viewerCanPublish, channelsConnected })
    costUsd = result.costUsd

    console.info('[tour-catalog-assistant]', { clientId, costUsd: result.costUsd })

    return NextResponse.json({ reply: result.reply, proposals: result.proposals })
  } catch (error) {
    if (error instanceof AssistantRunError) costUsd = error.costUsd
    if (error instanceof Error && error.message === 'assistant_truncated') {
      return NextResponse.json({ error: 'assistant_truncated' }, { status: 502 })
    }
    console.error('[tour-catalog-assistant] failed', error)
    return NextResponse.json({ error: 'assistant_unavailable' }, { status: 502 })
  } finally {
    // recordAssistantCost never throws.
    await recordAssistantCost(supabaseAdmin, clientId, usageDay, actor, costUsd)
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { id: clientId } = await context.params

  const access = await requireCatalogAccess(clientId, 'assistant')
  if (!access.ok) return access.response

  const parsed = await readAssistantRequest(request)
  if (!parsed.ok) return parsed.response

  // Reserve before spending: over the limit → 429; cannot tell → refuse (never call the model unmetered).
  const usageDay = utcDay(new Date())
  const reservation = await reserveAssistantCall(supabaseAdmin, clientId, usageDay, access.actor, {
    userDaily: ASSISTANT_USER_DAILY_LIMIT,
    clientDaily: ASSISTANT_CLIENT_DAILY_LIMIT,
    clientDailyCostUsd: ASSISTANT_CLIENT_DAILY_COST_LIMIT_USD,
  })
  if (reservation === 'limit') {
    return NextResponse.json({ error: 'assistant_limit' }, { status: 429 })
  }
  if (reservation !== 'ok') {
    return NextResponse.json({ error: 'assistant_unavailable' }, { status: 502 })
  }

  return runReserved(clientId, access.actor, usageDay, parsed.value, access.permissions.publish)
}
