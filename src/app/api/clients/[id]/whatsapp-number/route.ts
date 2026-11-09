/**
 * WhatsApp number binding — the single write entry for
 * clients.whatsapp_phone_number_id.
 *
 * Setting this is what turns the WhatsApp pipeline on for a client. It is read
 * in two places and both of them matter:
 *   · inbound  — /api/webhooks/whatsapp routes an incoming message to a client
 *                by matching Meta's phone_number_id against this column
 *   · outbound — lib/whatsapp/send.ts refuses to send unless this column agrees
 *                with the number the deployment holds a token for, so one
 *                client can never send from another client's number
 *
 * It exists because CLAUDE.md 铁律 8 forbids "let the PM edit it in Supabase
 * Studio" for FDE/PM configuration. That is not a style rule here: a value typed
 * straight into the database is exactly how the two sides above end up
 * disagreeing, and the outbound guard would then silently block every send with
 * nothing on screen explaining why. Shaped after
 * api/clients/[id]/facebook-page/route.ts, which closed the same gap for
 * Messenger.
 *
 * GET   → { phone_number_id, configured_number_id, matches_configured }
 * PATCH → { phone_number_id: string | null } replaces the binding; null clears.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

/**
 * Phone Number IDs are long numeric strings ("109876543210987"). Digits only:
 * people paste the phone number itself ("+64 21 123 4567") or the WABA id by
 * mistake, and storing either would leave inbound silently unrouted while
 * looking correctly configured.
 */
function normalisePhoneNumberId(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'string') throw new Error('phone_number_id 必须是字符串或 null')

  const trimmed = raw.trim()
  if (trimmed.length === 0) return null

  if (!/^\d{8,}$/.test(trimmed)) {
    throw new Error(
      '电话号码 ID 只能是数字（至少 8 位），比如 109876543210987。' +
        '这不是客人拨打的那个手机号 —— 在 Meta 商务管理平台 → WhatsApp 账户 → 电话号码里，' +
        '每个号码下面标着的「电话号码 ID」才是。',
    )
  }
  return trimmed
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('whatsapp_phone_number_id')
    .eq('id', clientId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const raw = (data as { whatsapp_phone_number_id: unknown }).whatsapp_phone_number_id
  const phone_number_id = typeof raw === 'string' && raw.trim().length > 0 ? raw : null

  // Which number this deployment actually holds a token for. Surfaced so a
  // mismatch is visible on the settings screen instead of only appearing later
  // as an unexplained refusal to send.
  const configured_number_id = process.env.WHATSAPP_PHONE_NUMBER_ID ?? null

  return NextResponse.json({
    phone_number_id,
    configured_number_id,
    matches_configured:
      phone_number_id === null || configured_number_id === null
        ? null
        : phone_number_id === configured_number_id,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: { phone_number_id?: unknown }
  try {
    body = (await req.json()) as { phone_number_id?: unknown }
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  let next: string | null
  try {
    next = normalisePhoneNumberId(body.phone_number_id)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    )
  }

  const { error: updateErr } = await supabaseAdmin
    .from('clients')
    .update({ whatsapp_phone_number_id: next })
    .eq('id', clientId)

  if (updateErr) {
    // The column has a partial unique index: two clients cannot claim the same
    // number. Say which case this is instead of surfacing a Postgres string.
    const duplicate = /duplicate key|unique/i.test(updateErr.message)
    return NextResponse.json(
      {
        error: duplicate
          ? '这个电话号码 ID 已经绑给另一个客户了。一个号码只能属于一个客户 —— 请先在那边解绑。'
          : `保存失败：${updateErr.message}`,
      },
      { status: duplicate ? 409 : 500 },
    )
  }

  try {
    revalidatePath(`/dashboard/clients/${clientId}/settings`)
  } catch {
    // best-effort outside a Next request context
  }

  const configured_number_id = process.env.WHATSAPP_PHONE_NUMBER_ID ?? null

  // Saving succeeds either way — binding a number before the credentials are in
  // place is legitimate — but the caller must be able to say "saved, but sending
  // is not live yet" rather than implying it works.
  return NextResponse.json({
    success: true,
    phone_number_id: next,
    configured_number_id,
    matches_configured:
      next === null || configured_number_id === null ? null : next === configured_number_id,
  })
}
