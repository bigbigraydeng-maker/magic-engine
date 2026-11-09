// POST /api/factory/work-orders/[id]/promote — Reel 授权后单条转公开(受控动作,风险级 A)。
// 设计稿:docs/specs/2026-10-18-reel-promote-to-public-design-v0.2.md
//
// 权限:requireGlobalAdmin(排除演示/受限管理员)再叠加 isGlobalAdminEmail(只认 ADMIN_EMAILS 精确名单,
// 不认公司域名)。请求体只许 {confirm, preview_token};video_id / page_id / client_id 一律从库里取。
// 不用 guardAdmin。流程:confirm=false 预览(拿一次性令牌)→ confirm=true 带令牌确认。

import { NextResponse } from 'next/server'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { isGlobalAdminEmail } from '@/lib/auth/whitelist'
import { createProductionPromoteDeps } from '@/lib/factory/publish/promote/deps'
import { runPromote } from '@/lib/factory/publish/promote/action'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ALLOWED_KEYS = new Set(['confirm', 'preview_token'])

type ParsedBody = { ok: true; confirm: boolean; previewToken?: string } | { ok: false; error: string }

function parseBody(raw: unknown): ParsedBody {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: '请求体必须是对象' }
  const body = raw as Record<string, unknown>
  if (Object.keys(body).some((k) => !ALLOWED_KEYS.has(k))) return { ok: false, error: '请求体只允许 confirm 和 preview_token' }
  if (typeof body.confirm !== 'boolean') return { ok: false, error: 'confirm 必须是 true 或 false' }
  if (body.preview_token !== undefined && typeof body.preview_token !== 'string') return { ok: false, error: 'preview_token 必须是字符串' }
  return { ok: true, confirm: body.confirm, previewToken: body.preview_token as string | undefined }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireGlobalAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })
  const email = admin.user.email ?? ''
  if (!isGlobalAdminEmail(email)) return NextResponse.json({ error: 'Forbidden — 只有管理员名单内的账号能转公开' }, { status: 403 })

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: '工单 id 格式不对' }, { status: 400 })

  const parsed = parseBody(await req.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const result = await runPromote(createProductionPromoteDeps(), {
    orderId: id, adminEmail: email, confirm: parsed.confirm, previewToken: parsed.previewToken,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, kind: result.kind, ...result.data })
}
