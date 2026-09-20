import { NextRequest } from 'next/server'
import { dashboardAccess,checkOrigin,json,failure } from '@/lib/meta/ai/http'
import { reserveRead } from '@/lib/meta/ai/store'
import { auditedControl } from '@/lib/meta/ai/audit'
import { startAdsConsent,browserCookie } from '@/lib/meta-oauth/ads-read'
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request)
    const clientId = request.nextUrl.searchParams.get('client_id') ?? ''
    const access = await dashboardAccess(clientId)
    await reserveRead(clientId)
    const result = await auditedControl(clientId,access.user.email ?? '', 'oauth_start',null,()=>startAdsConsent(clientId,access.user.id))
    const response = json({ url:result.url })
    response.cookies.set(browserCookie,result.browser,{ httpOnly:true,secure:true,sameSite:'lax',maxAge:600,path:'/api/auth/facebook/ads' })
    return response
  } catch (error) { return failure(error) }
}
export const dynamic = 'force-dynamic'
