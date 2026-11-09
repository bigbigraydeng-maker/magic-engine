import { apiPrincipal,json,failure } from '@/lib/meta/ai/http'
import { metaManifest } from '@/lib/meta/ai/contract'
import { readGrant,activeConnection,reserveRead } from '@/lib/meta/ai/store'
export async function GET(request: Request) {
  try {
    const principal = await apiPrincipal(request)
    await reserveRead(principal.clientId)
    const grant = await readGrant(principal)
    await activeConnection(principal.clientId,grant.connection_id)
    return json({ version:'0.1',tools:metaManifest() })
  } catch (error) { return failure(error) }
}
export const dynamic = 'force-dynamic'
