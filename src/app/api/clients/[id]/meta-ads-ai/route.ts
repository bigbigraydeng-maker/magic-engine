import { z } from 'zod'
import { dashboardAccess,checkOrigin,json,failure,boundedBody } from '@/lib/meta/ai/http'
import { status,discover,bind,issueKey,revoke } from '@/lib/meta/ai/manage'
import { auditedControl } from '@/lib/meta/ai/audit'
import { MetaReadError } from '@/lib/meta/graph-read'
const uuid=z.string().uuid()
const actionSchema=z.discriminatedUnion('action',[
  z.object({ action:z.literal('discover'),connection_id:uuid }).strict(),
  z.object({ action:z.literal('bind'),connection_id:uuid,account_id:z.string().regex(/^act_[1-9]\d{9,24}$/) }).strict(),
  z.object({ action:z.literal('issue_key'),grant_id:uuid }).strict(),
  z.object({ action:z.literal('revoke'),type:z.enum(['key','grant','connection']),id:uuid }).strict(),
])
type Context={ params:{ id:string } }
export async function GET(_request: Request,{ params }: Context) {
  try { await dashboardAccess(params.id); return json(await status(params.id)) } catch(error) { return failure(error) }
}
export async function POST(request: Request,{ params }: Context) {
  try {
    checkOrigin(request)
    const access=await dashboardAccess(params.id)
    const parsed=actionSchema.safeParse(await boundedBody(request))
    if (!parsed.success) throw new MetaReadError('invalid_arguments')
    const action=parsed.data
    const audit=<T,>(event:string,target:string|null,run:()=>Promise<T>)=>auditedControl(params.id,access.user.email ?? '',event,target,run)
    if(action.action==='discover') return json(await discover(params.id,action.connection_id))
    if(action.action==='bind') return json(await audit('bind',action.account_id,()=>bind(params.id,access.user.id,action.connection_id,action.account_id)))
    if(action.action==='issue_key') return json(await audit('issue_key',action.grant_id,()=>issueKey(params.id,action.grant_id,access.user.email ?? '')))
    await audit(`revoke_${action.type}`,action.id,()=>revoke(params.id,action.type,action.id))
    return json({ ok:true })
  } catch(error) { return failure(error) }
}
export const dynamic='force-dynamic'
export const maxDuration=60
