import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { insertBindingAudit,finishBindingAudit } from '@/lib/clients/binding-audit'
import { MetaReadError } from '../graph-read'
import type { MetaPrincipal } from './store'
export async function auditedControl<T>(clientId:string,email:string,event:string,target:string|null,run:()=>Promise<T>):Promise<T> {
  const receipt=await insertBindingAudit({ client_id:clientId,binding_kind:'meta_ads_read',actor_email:email,
    action:event.startsWith('revoke') ? 'clear' : 'bind',outcome:'authorized',requested_value:target,detail:event })
  if('error' in receipt) throw new MetaReadError('audit_unavailable',503)
  let result:T
  try {
    result=await run()
  } catch(error) {
    await finishBindingAudit(receipt.id,'write_failed',`${event}:${error instanceof MetaReadError ? error.code : 'request_failed'}`)
    throw error
  }
  // An applied operation is not a failed write when only the audit tail fails.
  if(!await finishBindingAudit(receipt.id,'applied',event)) throw new MetaReadError('audit_completion_failed',503)
  return result
}
export async function startReadAudit(principal:MetaPrincipal,tool:string,accountId?:string):Promise<string> {
  const id=randomUUID()
  const { error }=await supabaseAdmin.from('mcp_access_log').insert({ id,key_kind:'client',client_key_id:principal.keyId,
    client_id:principal.clientId,tool,ok:false,error_code:'in_progress',resource_id:accountId ?? null })
  if(error) throw new MetaReadError('audit_unavailable',503)
  return id
}
export async function finishReadAudit(id:string,errorCode:string|null) {
  const { error }=await supabaseAdmin.from('mcp_access_log').update({ ok:errorCode===null,error_code:errorCode }).eq('id',id)
  if(error) throw new MetaReadError('audit_unavailable',503)
}
