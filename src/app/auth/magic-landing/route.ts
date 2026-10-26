import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { randomUUID, timingSafeEqual } from 'crypto'
import { getPublicOrigin } from '@/lib/auth/public-origin'
import { resolveRedirectForSession } from '@/lib/auth/resolve-redirect'
import { safeInternalPath } from '@/lib/auth/safe-internal-path'

export const dynamic = 'force-dynamic'

const ALLOWED_TYPES = new Set(['magiclink', 'signup', 'email'])
const NONCE_COOKIE = 'me-magic-login-nonce'

function safeNext(value: unknown): string {
  return safeInternalPath(value, '/dashboard')
}

function equal(a: string, b: string): boolean {
  const aa = Buffer.from(a)
  const bb = Buffer.from(b)
  return aa.length === bb.length && timingSafeEqual(aa, bb)
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))
}

function page(tokenHash: string, type: string, next: string, nonce: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>确认登录 Magic Engine</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#f7f7f8;margin:0}.card{background:#fff;border-radius:14px;padding:32px;box-shadow:0 1px 4px rgba(0,0,0,.12);max-width:380px;text-align:center}p{color:#333;line-height:1.6}button{margin-top:14px;padding:12px 24px;border:0;border-radius:8px;background:#111827;color:#fff;font-size:16px;cursor:pointer}</style></head><body><div class="card"><h1>确认登录</h1><p>点击下方按钮后，系统才会完成登录。此页面可防止邮箱安全扫描提前使用登录链接。</p><form method="POST"><input type="hidden" name="token_hash" value="${escapeHtml(tokenHash)}"><input type="hidden" name="type" value="${escapeHtml(type)}"><input type="hidden" name="next" value="${escapeHtml(next)}"><input type="hidden" name="nonce" value="${escapeHtml(nonce)}"><button type="submit">确认登录</button></form></div></body></html>`
}

export async function GET(request: NextRequest) {
  const origin = getPublicOrigin(request)
  const params = new URL(request.url).searchParams
  const tokenHash = params.get('token_hash')
  const type = params.get('type')
  const next = safeNext(params.get('next'))
  if (!tokenHash || !type || !ALLOWED_TYPES.has(type)) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed&next=${encodeURIComponent(next)}`)
  }

  const nonce = randomUUID()
  const response = new NextResponse(page(tokenHash, type, next, nonce), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
  response.cookies.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: 'strict',
    secure: origin.startsWith('https://'),
    path: '/auth/magic-landing',
    maxAge: 600,
  })
  return response
}

export async function POST(request: NextRequest) {
  const origin = getPublicOrigin(request).replace(/\/$/, '')
  const form = await request.formData()
  const tokenHash = form.get('token_hash')
  const type = form.get('type')
  const next = safeNext(form.get('next'))
  const nonce = form.get('nonce')
  const cookieStore = cookies()
  const cookieNonce = cookieStore.get(NONCE_COOKIE)?.value
  const fail = () => {
    const response = NextResponse.redirect(`${origin}/login?error=auth_failed&next=${encodeURIComponent(next)}`, 303)
    response.cookies.delete({ name: NONCE_COOKIE, path: '/auth/magic-landing' })
    return response
  }

  if (request.headers.get('origin')?.replace(/\/$/, '') !== origin) return fail()
  if (typeof nonce !== 'string' || !cookieNonce || !equal(nonce, cookieNonce)) return fail()
  if (typeof tokenHash !== 'string' || !tokenHash || typeof type !== 'string' || !ALLOWED_TYPES.has(type)) return fail()

  const pending: Array<{ name: string; value: string; options?: Record<string, unknown> }> = []
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: list => list.forEach(({ name, value, options }) => pending.push({ name, value, options: options as Record<string, unknown> })) } },
  )
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as 'magiclink' | 'signup' | 'email' })
  if (error) return fail()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return fail()

  const destination = await resolveRedirectForSession(supabase, next)
  const response = NextResponse.redirect(`${origin}${destination}`, 303)
  pending.forEach(({ name, value, options }) => response.cookies.set(name, value, options as never))
  response.cookies.delete({ name: NONCE_COOKIE, path: '/auth/magic-landing' })
  return response
}
