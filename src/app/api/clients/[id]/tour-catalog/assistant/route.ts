/**
 * POST /api/clients/[id]/tour-catalog/assistant
 *
 * Admin-only endpoint that runs the tour catalog AI assistant. Takes a
 * natural-language message plus optional history, returns a reply and a list
 * of validated catalog proposals. Cost is logged server-side, never returned.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireCatalogAdmin } from '@/lib/tour-catalog/access'
import { loadCatalog } from '@/lib/tour-catalog/store'
import { runAssistant } from '@/lib/tour-catalog/assistant'
import type { AssistantMessage } from '@/lib/tour-catalog/assistant'
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

export async function POST(request: Request, context: RouteContext) {
  const { id: clientId } = await context.params

  const access = await requireCatalogAdmin(clientId)
  if (!access.ok) return access.response

  let body: unknown
  try {
    const text = await request.text()
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'request_too_large' }, { status: 413 })
    }
    body = JSON.parse(text) as unknown
  } catch {
    return NextResponse.json({ error: 'message_required' }, { status: 400 })
  }

  const record = isRecord(body) ? body : {}
  const message = record.message
  if (typeof message !== 'string' || message.trim() === '' || message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: 'message_required' }, { status: 400 })
  }

  const history = parseHistory(record.history)

  try {
    const snapshot = await loadCatalog(supabaseAdmin, clientId)
    const today = todayIso(new Date())
    const result = await runAssistant({ snapshot, history, message, today })

    console.info('[tour-catalog-assistant]', { clientId, costUsd: result.costUsd })

    return NextResponse.json({ reply: result.reply, proposals: result.proposals })
  } catch (error) {
    if (error instanceof Error && error.message === 'assistant_truncated') {
      return NextResponse.json({ error: 'assistant_truncated' }, { status: 502 })
    }
    console.error('[tour-catalog-assistant] failed', error)
    return NextResponse.json({ error: 'assistant_unavailable' }, { status: 502 })
  }
}
