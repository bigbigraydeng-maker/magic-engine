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
    if(!(error instanceof MetaReadError)) {
      // A non-MetaReadError here always means something unexpected — every caller was already
      // collapsing this to the generic 'request_failed' tag with the real cause never logged
      // anywhere (2026-09-22: a plain upsertConnection() Error hid this way during a real CTS
      // Tours NZ retry). No token/secret is in scope at this call boundary.
      console.warn('[audit] non-MetaReadError caught, mapped to request_failed',{ clientId,event,errorName:error instanceof Error ? error.name : typeof error,
        message:error instanceof Error ? error.message : String(error) })
    }
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
export async function finishReadAudit(id:string,errorCode:string|null,accountId?:string) {
  const update: { ok:boolean;error_code:string|null;resource_id?:string }={ ok:errorCode===null,error_code:errorCode }
  if(accountId) update.resource_id=accountId
  const { data,error }=await supabaseAdmin.from('mcp_access_log').update(update).eq('id',id).select('id')
  if(error || !Array.isArray(data) || data.length!==1 || data[0]?.id!==id) throw new MetaReadError('audit_unavailable',503)
}
