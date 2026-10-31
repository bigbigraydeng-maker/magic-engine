/**
 * POST /api/admin/conversions/nal-mark-won
 *
 * Staff can record one pending purchase when they move a contact onto the
 * stage this client configured as a deal (`leads_config.capi_deal_stage_key`).
 * The drawer does not call this. Paying the configured milestone is the
 * primary trigger. This route stays for a direct call, and it refuses to
 * advance the stage when the purchase cannot be stored.
 */

import { NextResponse } from 'next/server'
import { guardAdmin } from '@/lib/auth/require-admin'
import { advanceContactStage } from '@/lib/crm/advance-contact-stage'
import { guardConversionRoute } from '@/lib/conversions/route-guard'
import { recordStageDeal, type DealRecordResult } from '@/lib/conversions/crm-deal-record'
import { supabaseDealIo } from '@/lib/conversions/crm-deal-supabase'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STAGE_RE = /^[a-z0-9_]{1,64}$/

type StageBody = {
  clientId: string
  contactId: string
  stageKey: string
  bookingId: string | null
  occurredAt: string | null
  note: string | null
  staffAmount: string | null
  staffCurrency: string | null
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  const parsed = parseStageBody(await readJson(request))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const g = await guardConversionRoute(request, parsed.value.clientId)
  if (!g.ok) return g.response

  const result = await recordStageDeal(supabaseDealIo(supabaseAdmin), {
    ...parsed.value,
    actor: g.ctx.actor,
  }, new Date())
  return respond(result, parsed.value, g.ctx.actor)
}

async function respond(result: DealRecordResult, body: StageBody, actor: string | null): Promise<NextResponse> {
  const blocked = blockStatus(result)
  if (blocked != null) {
    const error = result.attempted ? result.message : '这个阶段没有被设成成交，阶段没有改。'
    return NextResponse.json({ error }, { status: blocked })
  }
  const stage = await advanceContactStage(supabaseAdmin, body.clientId, body.contactId, body.stageKey, body.note, actor)
  if (!stage.ok) {
    return NextResponse.json({
      error: stage.error,
      outcomeId: result.outcomeId,
      alreadyRecorded: result.alreadyRecorded,
      message: result.recorded ? `钱已经记下了，但阶段没能改：${stage.error}` : stage.error,
    }, { status: stage.status })
  }
  return NextResponse.json({
    outcomeId: result.outcomeId,
    stageChanged: stage.changed,
    alreadyRecorded: result.alreadyRecorded,
    doNotContact: result.doNotContact,
    message: result.message,
  })
}

function blockStatus(result: DealRecordResult): number | null {
  if (!result.attempted) return 400
  if (result.reason === 'record_failed') return 500
  if (!result.advanceStage && !result.recorded) return 400
  return null
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

function parseStageBody(body: unknown): { ok: true; value: StageBody } | { ok: false; error: string } {
  const raw = asRecord(body)
  if (!raw) return { ok: false, error: 'Invalid JSON body' }
  const clientId = str(raw.clientId)
  const contactId = str(raw.contactId)
  const stageKey = str(raw.stageKey)
  if (!clientId || !UUID_RE.test(clientId)) return { ok: false, error: '缺少 clientId' }
  if (!contactId || !UUID_RE.test(contactId)) return { ok: false, error: '缺少 contactId' }
  if (!stageKey || !STAGE_RE.test(stageKey)) return { ok: false, error: '缺少 stageKey' }
  const bookingId = str(raw.bookingId)
  if (bookingId && !UUID_RE.test(bookingId)) return { ok: false, error: 'bookingId 必须是 uuid' }
  const amount = readAmount(raw.amountMajor, raw.currency)
  if (!amount.ok) return amount
  return {
    ok: true,
    value: {
      clientId,
      contactId,
      stageKey,
      bookingId: bookingId || null,
      occurredAt: str(raw.occurredAt),
      note: str(raw.note),
      staffAmount: amount.amount,
      staffCurrency: amount.currency,
    },
  }
}

function readAmount(amount: unknown, currency: unknown): { ok: true; amount: string | null; currency: string | null } | { ok: false; error: string } {
  if (amount == null || amount === '') return { ok: true, amount: null, currency: null }
  const n = typeof amount === 'number' ? amount : typeof amount === 'string' ? Number(amount) : Number.NaN
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'amountMajor 必须是大于 0 的数字' }
  if (typeof currency !== 'string' || !/^[A-Za-z]{3}$/.test(currency.trim())) {
    return { ok: false, error: '有金额时必须带币种' }
  }
  return { ok: true, amount: String(n), currency: currency.trim().toUpperCase() }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}
