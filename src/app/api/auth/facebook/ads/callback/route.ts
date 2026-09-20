import { NextRequest,NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/require-session'
import { browserCookie,consumeAdsState,finishAdsConsent } from '@/lib/meta-oauth/ads-read'
import { activeDashboardAccess,failure } from '@/lib/meta/ai/http'
import { auditedControl } from '@/lib/meta/ai/audit'
import { MetaReadError } from '@/lib/meta/graph-read'
export async function GET(request: NextRequest) {
  let clientId: string | null = null
  try {
    const session = await requireSession()
    if (!session.ok) throw new MetaReadError('sign_in_required',401)
    const consumedClientId = await consumeAdsState(request.nextUrl.searchParams.get('state') ?? '',request.cookies.get(browserCookie)?.value ?? '',session.user.id)
    clientId = consumedClientId
    await activeDashboardAccess(consumedClientId)
    let outcome = 'authorised'
    try {
      const code = request.nextUrl.searchParams.get('code')
      if (request.nextUrl.searchParams.has('error') || !code) throw new MetaReadError('consent_cancelled')
      await auditedControl(consumedClientId,session.user.email ?? '', 'oauth_complete',null,()=>finishAdsConsent(code,consumedClientId,session.user.id))
    } catch { outcome='reconnect_required' }
    const target = new URL(`/meta-ads-ai/${consumedClientId}`,process.env.NEXT_PUBLIC_APP_URL)
    target.searchParams.set('outcome',outcome)
    const response = NextResponse.redirect(target)
    response.headers.set('Cache-Control','no-store')
    response.cookies.set(browserCookie,'',{ maxAge:0,path:'/api/auth/facebook/ads',httpOnly:true,secure:true,sameSite:'lax' })
    return response
  } catch(error) {
    const base=process.env.NEXT_PUBLIC_APP_URL
    if(!base) return failure(new MetaReadError('configuration_required',503))
    const code=error instanceof MetaReadError ? error.code : 'reconnect_required'
    const target=new URL(clientId ? `/meta-ads-ai/${clientId}` : '/meta-ads-ai',base)
    target.searchParams.set('outcome',code)
    return NextResponse.redirect(target)
  }
}
export const dynamic = 'force-dynamic'
export const maxDuration = 60
