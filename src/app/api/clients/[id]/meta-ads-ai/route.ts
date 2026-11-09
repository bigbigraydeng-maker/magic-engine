import { z } from 'zod'
import { activeDashboardAccess,pilotDashboardAccess,checkOrigin,json,failure,boundedBody } from '@/lib/meta/ai/http'
import { status,discover,bind,issueKey,revoke } from '@/lib/meta/ai/manage'
import { auditedControl } from '@/lib/meta/ai/audit'
import { MetaReadError } from '@/lib/meta/graph-read'
import { generateAnalysis } from '@/lib/meta/ai/analysis'
import { publicConnectOpen,selfServeActivate } from '@/lib/meta/ai/entitlement'
const uuid=z.string().uuid()
const actionSchema=z.discriminatedUnion('action',[
  z.object({ action:z.literal('activate') }).strict(),
  z.object({ action:z.literal('discover'),connection_id:uuid }).strict(),
  z.object({ action:z.literal('bind'),connection_id:uuid,account_id:z.string().regex(/^act_[1-9]\d{9,24}$/) }).strict(),
  z.object({ action:z.literal('issue_key'),grant_id:uuid }).strict(),
  z.object({ action:z.literal('generate_analysis'),grant_id:uuid }).strict(),
  z.object({ action:z.literal('revoke'),type:z.enum(['key','grant','connection']),id:uuid }).strict(),
])
type Context={ params:{ id:string } }
export async function GET(_request: Request,{ params }: Context) {
  try {
    const access=await pilotDashboardAccess(params.id)
    return json(await status(params.id,access.user.id))
  } catch(error) { return failure(error) }
}
export async function POST(request: Request,{ params }: Context) {
  try {
    checkOrigin(request)
    const access=await pilotDashboardAccess(params.id)
    const parsed=actionSchema.safeParse(await boundedBody(request))
    if (!parsed.success) throw new MetaReadError('invalid_arguments')
    const action=parsed.data
    const audit=<T,>(event:string,target:string|null,run:()=>Promise<T>)=>auditedControl(params.id,access.user.email ?? '',event,target,run)
    if(action.action==='activate') {
      // Only a self-serve member; the database function re-checks client source and membership.
      if(access.tier!=='self_serve') throw new MetaReadError('activation_not_allowed',403)
      // Opening before Facebook can be connected would start the 90 days for nothing (魏征 2026-09-27).
      if(!publicConnectOpen()) throw new MetaReadError('connect_waiting_review',403)
      const result=await audit('self_serve_activate',null,()=>selfServeActivate(params.id,access.user.email ?? ''))
      return json({ ok:true,result })
    }
    if(action.action==='revoke') {
      await audit(`revoke_${action.type}`,action.id,()=>revoke(params.id,access.user.id,action.type,action.id))
      return json({ ok:true })
    }
    await activeDashboardAccess(params.id)
    if(action.action==='discover') return json(await discover(params.id,access.user.id,action.connection_id))
    if(action.action==='bind') return json(await audit('bind',action.account_id,()=>bind(params.id,access.user.id,action.connection_id,action.account_id)))
    if(action.action==='issue_key') return json(await audit('issue_key',action.grant_id,()=>issueKey(params.id,access.user.id,action.grant_id,access.user.email ?? '')))
    if(action.action==='generate_analysis') return json(await generateAnalysis(params.id,access.user.id,action.grant_id))
    throw new MetaReadError('invalid_arguments')
  } catch(error) { return failure(error) }
}
export const dynamic='force-dynamic'
export const maxDuration=120
