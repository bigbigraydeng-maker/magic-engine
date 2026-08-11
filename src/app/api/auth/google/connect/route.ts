/**
 * GET /api/auth/google/connect?client_id=<uuid>&flow=<admin|connect>
 *
 * Initiates the Google OAuth 2.0 flow for a client. Builds a signed state
 * token (HMAC-SHA256, 10-min TTL), then redirects to Google's consent screen.
 *
 * flow (default 'admin') rides along in the signed state so the callback
 * knows where to return the user: 'admin' → dashboard, 'connect' → the
 * public customer-facing /connect page.
 *
 * On success Google redirects to /api/auth/google/callback with code + state.
 *
 * Scopes requested (COMBINED_GOOGLE_SCOPES):
 *   - webmasters.readonly  (Google Search Console)
 *   - analytics.readonly   (Google Analytics 4)
 *   - indexing             (Google Indexing API)
 *   - email                (display only)
 *
 * A single consent covers GSC + GA4 + Indexing — clients only auth once.
 */

import { NextRequest, NextResponse } from 'next/server'
import { buildState, buildAuthUrl, COMBINED_GOOGLE_SCOPES } from '@/lib/google-oauth/client'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const clientId = req.nextUrl.searchParams.get('client_id')
  if (!clientId) {
    return NextResponse.json({ error: 'client_id is required' }, { status: 400 })
  }

  const rawFlow = req.nextUrl.searchParams.get('flow')
  const flow = rawFlow === 'connect' ? 'connect' : rawFlow === 'wizard' ? 'wizard' : 'admin'

  // 狄仁杰 2026-08-11 攻击验证：'admin'/'wizard' 这两条 flow 之前完全没鉴权——
  // 任何人知道一个 client 的 UUID（团队内部从不当机密）就能替换成自己的
  // Google 账号，把自己的 token 冒充成这个客户的连接写进库。'wizard' 这次还
  // 被接到了客户能看到的引导向导按钮上，暴露面比原来大得多，必须堵。
  // 'connect' 保持现状——那是刻意设计成无登录的公网客户自助页，它自己的
  // 鉴权模型是另一个独立问题，不在本次改动范围（见 spec §2.1 B1，已知留待
  // 专门处理，不能顺手在这里改，否则会破坏现有靠这条链接工作的客户）。
  if (flow !== 'connect') {
    const access = await requireDashboardClientAccess(clientId)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
  }

  const redirectUri = `${appUrl()}/api/auth/google/callback`
  const state       = buildState(clientId, flow)
  const authUrl     = buildAuthUrl(state, redirectUri, COMBINED_GOOGLE_SCOPES)

  return NextResponse.redirect(authUrl)
}
