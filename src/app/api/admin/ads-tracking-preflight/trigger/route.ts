import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { listTrackingClientIds } from '@/lib/ads-tracking-preflight/client-config'
import { buildTriggerEvent } from '@/lib/ads-tracking-preflight/trigger'
import { sanitizeError } from '@/lib/ads-tracking-preflight/sanitize'
import { ADS_TRACKING_POSTLAUNCH_REQUESTED } from '@/lib/inngest/ads-events'

/**
 * POST /api/admin/ads-tracking-preflight/trigger —— 开投前追踪检查 / 开投后读回的手动触发入口。
 *
 * 只读：这里最多发一个事件（演练时一个都不发），被叫醒的检查本身只读不写 ——
 * 不碰投放平台 / 分析平台 / 网站，不发布、不扣费。
 *
 * 两种调用方：全局管理员会话，或带正确 CRON_SECRET 的 Bearer。
 * 默认只演练（dry_run 为 true）：只回「会发什么」，不真发；要真发必须在请求里写 "dry_run": false。
 *
 * 请求体：{ kind: 'preflight' | 'postlaunch', client_id, dry_run?, reason?, phase?, launched_at? }
 *   - preflight：reason 可选（限 40 字，只进日志）
 *   - postlaunch：phase（t1h / t24h）和 launched_at 必填
 */

export const dynamic = 'force-dynamic'

const MIN_CRON_SECRET_CHARS = 16

function isCronSecretCall(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < MIN_CRON_SECRET_CHARS) return false
  const provided = req.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isCronSecretCall(req)) {
    const guard = await guardGlobalAdmin()
    if (guard) return guard
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: '请求内容不是合法的 JSON' }, { status: 400 })
  }

  const built = buildTriggerEvent(body, listTrackingClientIds(), new Date())
  if (!built.ok) return NextResponse.json({ ok: false, error: built.error }, { status: built.status })

  if (built.dry_run) {
    return NextResponse.json({
      ok: true,
      dry_run: true,
      no_publish: true,
      would_send: built.event,
      hint: '这是演练：没有发出任何事件。要真发请在请求里写 "dry_run": false。',
    })
  }

  const kind = built.event.name === ADS_TRACKING_POSTLAUNCH_REQUESTED ? 'postlaunch' : 'preflight'
  const clientId = String(built.event.data.client_id)
  const id = `manual-${kind}-${clientId}-${Date.now()}`

  try {
    const result = await sendInngestEvent({ id, name: built.event.name, data: built.event.data })
    return NextResponse.json({ ok: true, dry_run: false, no_publish: true, event_ids: result.event_ids })
  } catch (err) {
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 502 })
  }
}
