/**
 * /partner/enter?t=<invite> — distributor portal login link.
 * GET shows a confirm button (mail scanners that pre-open links must not burn the one-time invite);
 * POST trades the invite for a portal session cookie and goes to /partner. Same-origin POST only.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { getPublicOrigin } from '@/lib/auth/public-origin'
import { isCrossOrigin } from '@/lib/distributor/admin-http'
import { isTokenShaped, redeemInvite, revokeSession, sessionCookie, sessionTokenFrom } from '@/lib/distributor/portal-auth'

export const dynamic = 'force-dynamic'

function page(token: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>进入经销商后台</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#f7f7f8;margin:0;padding:16px}.card{background:#fff;border-radius:14px;padding:32px;box-shadow:0 1px 4px rgba(0,0,0,.12);max-width:380px;text-align:center}p{color:#333;line-height:1.6}button{margin-top:14px;padding:12px 24px;border:0;border-radius:8px;background:#111827;color:#fff;font-size:16px;cursor:pointer}</style></head><body><div class="card"><h1>进入经销商后台</h1><p>点击下方按钮进入。这个链接只能用一次，24 小时内有效。</p><form method="POST"><input type="hidden" name="t" value="${token}"><button type="submit">进入</button></form></div></body></html>`
}

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get('t')
  const origin = getPublicOrigin(request)
  if (!isTokenShaped(token)) return NextResponse.redirect(`${origin}/partner?link=invalid`, 303)
  // Token shape is base64url only, so it is safe to place in the HTML attribute as-is.
  return new NextResponse(page(token), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', // same-origin (not no-referrer): no-referrer makes the form POST send `Origin: null`, which the
    // same-origin check must refuse; same-origin still keeps the token out of any third-party Referer.
    'referrer-policy': 'same-origin' },
  })
}

export async function POST(request: NextRequest) {
  const origin = getPublicOrigin(request)
  if (isCrossOrigin(request)) return NextResponse.redirect(`${origin}/partner?link=invalid`, 303)
  const form = await request.formData()
  const token = form.get('t')
  const session = isTokenShaped(token) ? await redeemInvite(token) : null
  if (!session) return NextResponse.redirect(`${origin}/partner?link=expired`, 303)
  // A browser that was signed in as someone else: end that older session instead of leaving it valid.
  const previous = sessionTokenFrom(request)
  if (previous) await revokeSession(previous).catch((err: unknown) => console.error('[partner-portal] revoke previous failed:', err))
  const response = NextResponse.redirect(`${origin}/partner`, 303)
  response.headers.append('set-cookie', sessionCookie(session.sessionToken, session.expiresAt, origin.startsWith('https://')))
  response.headers.set('cache-control', 'no-store')
  return response
}
