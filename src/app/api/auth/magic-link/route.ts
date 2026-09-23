/**
 * POST /api/auth/magic-link
 *
 * Server-side magic link sender for admin / portal login.
 * Generates a hashed Supabase token, then emails a Magic Engine confirmation
 * page. GET never consumes the token; only the page's explicit POST does, so
 * mail-security link scanners cannot burn the login before the user clicks.
 *
 * Body: { email: string; redirectTo: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { supabaseAdmin } from '@/lib/supabase'
import { getUserPermissions } from '@/lib/auth/whitelist'
import { meMailFrom } from '@/lib/email/sender'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string
  ))
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let email: string, redirectTo: string

  try {
    const body = (await req.json()) as { email?: unknown; redirectTo?: unknown }
    if (!body.email || typeof body.email !== 'string') {
      return NextResponse.json({ error: 'email is required.' }, { status: 400 })
    }
    if (!body.redirectTo || typeof body.redirectTo !== 'string') {
      return NextResponse.json({ error: 'redirectTo is required.' }, { status: 400 })
    }
    email = body.email.trim().toLowerCase()
    redirectTo = body.redirectTo
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  // Validate redirectTo against known app origins (APP_URL takes priority over NEXT_PUBLIC_APP_URL)
  try {
    new URL(redirectTo) // must be a valid URL
    const appUrl = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
    if (appUrl && !redirectTo.startsWith(appUrl)) {
      return NextResponse.json({ error: 'Invalid redirectTo.' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid redirectTo URL.' }, { status: 400 })
  }

  const { data: portalUsers } = await supabaseAdmin
    .from('client_portal_users')
    .select('id')
    .eq('email', email)
    .limit(1)

  // Allow account creation for known admin / portal users so first-time logins work.
  // Unknown emails keep shouldCreateUser: false to prevent account farming.
  const isKnownUser = getUserPermissions(email) !== null || (portalUsers?.length ?? 0) > 0
  const shouldCreateUser = isKnownUser

  if (shouldCreateUser) {
    const appUrl = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
    const resendKey = process.env.RESEND_API_KEY
    const next = new URL(redirectTo).searchParams.get('next') ?? '/dashboard'
    const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: `${appUrl}/auth/callback` },
    })
    const tokenHash = data?.properties?.hashed_token
    const type = data?.properties?.verification_type ?? 'magiclink'

    if (error || !tokenHash || !resendKey || !appUrl) {
      console.error('[api/auth/magic-link] secure link error', error?.message ?? 'missing mail configuration')
    } else {
      const landing = new URL(`${appUrl}/auth/magic-landing`)
      landing.searchParams.set('token_hash', tokenHash)
      landing.searchParams.set('type', type)
      landing.searchParams.set('next', safeNext)
      const actionLink = landing.toString()
      const htmlLink = escapeHtml(actionLink)
      const { error: sendError } = await new Resend(resendKey).emails.send({
        from: meMailFrom('Magic Engine'),
        to: email,
        subject: 'Magic Engine 登录确认',
        text: `请打开下面的链接，并在确认页点击“确认登录”：\n\n${actionLink}\n\n链接一次性有效。`,
        html: `<p>请打开下面的链接，并在确认页点击“确认登录”：</p><p><a href="${htmlLink}">继续登录 Magic Engine</a></p><p>链接一次性有效。</p>`,
      })
      if (sendError) console.error('[api/auth/magic-link] email error', sendError.message)
    }
  }

  return NextResponse.json({ success: true })
}
