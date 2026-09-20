import { NextRequest,NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/require-session'
import { browserCookie,consumeAdsState,finishAdsConsent } from '@/lib/meta-oauth/ads-read'
import { checkEnabled,dashboardAccess,failure } from '@/lib/meta/ai/http'
import { auditedControl } from '@/lib/meta/ai/audit'
import { MetaReadError } from '@/lib/meta/graph-read'
export async function GET(request: NextRequest) {
  try {
    checkEnabled()
    const session = await requireSession()
    if (!session.ok) throw new MetaReadError('sign_in_required',401)
    const clientId = await consumeAdsState(request.nextUrl.searchParams.get('state') ?? '',request.cookies.get(browserCookie)?.value ?? '',session.user.id)
    await dashboardAccess(clientId)
    let outcome = 'authorised'
    try {
      const code = request.nextUrl.searchParams.get('code')
      if (request.nextUrl.searchParams.has('error') || !code) throw new MetaReadError('consent_cancelled')
      await auditedControl(clientId,session.user.email ?? '', 'oauth_complete',null,()=>finishAdsConsent(code,clientId))
    } catch { outcome='reconnect_required' }
    const target = new URL(`/meta-ads-ai/${clientId}`,process.env.NEXT_PUBLIC_APP_URL)
    target.searchParams.set('outcome',outcome)
    const response = NextResponse.redirect(target)
    response.headers.set('Cache-Control','no-store')
    response.cookies.set(browserCookie,'',{ maxAge:0,path:'/api/auth/facebook/ads',httpOnly:true,secure:true,sameSite:'lax' })
    return response
  } catch {
    const base=process.env.NEXT_PUBLIC_APP_URL
    if(!base) return failure(new MetaReadError('configuration_required',503))
    return NextResponse.redirect(new URL('/meta-ads-ai?outcome=reconnect_required',base))
  }
}
export const dynamic = 'force-dynamic'
export const maxDuration = 60
