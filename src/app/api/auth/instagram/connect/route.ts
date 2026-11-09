import { NextRequest, NextResponse } from 'next/server'
import { requireOnboardingClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeInstagramHandle } from '@/lib/instagram-oauth/identity'
import { buildInstagramState, getInstagramConfig, instagramAuthUrl, instagramReturnUrl,
  INSTAGRAM_STATE_COOKIE, INSTAGRAM_STATE_PATH, INSTAGRAM_STATE_TTL_SECS } from '@/lib/instagram-oauth/client'

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('client_id')
  if (!clientId || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(clientId)) {
    return NextResponse.json({ error: 'Valid client_id required' }, { status: 400 })
  }
  const access = await requireOnboardingClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const config = getInstagramConfig()
  if (!config) return NextResponse.redirect(instagramReturnUrl(clientId, 'unavailable'))
  try {
    const { data, error } = await supabaseAdmin.from('clients').select('instagram_handle').eq('id', clientId).maybeSingle()
    if (error || !data) return NextResponse.redirect(instagramReturnUrl(clientId, 'verify_failed'))
    const handle = normalizeInstagramHandle(data.instagram_handle)
    if (!handle) return NextResponse.redirect(instagramReturnUrl(clientId, 'target_missing'))
    const state = buildInstagramState({ clientId, userId: access.user.id, handle }, config.secret)
    const response = NextResponse.redirect(instagramAuthUrl(config, state))
    response.cookies.set(INSTAGRAM_STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: 'lax',
      path: INSTAGRAM_STATE_PATH, maxAge: INSTAGRAM_STATE_TTL_SECS })
    return response
  } catch { return NextResponse.redirect(instagramReturnUrl(clientId, 'verify_failed')) }
}
