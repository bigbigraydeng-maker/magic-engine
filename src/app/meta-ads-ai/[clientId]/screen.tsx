'use client'
import { useEffect,useState,useCallback } from 'react'
type Connection={ id:string;status:string;token_expiry:string }
type Grant={ id:string;ad_account_id:string;connection_id:string }
type Key={ id:string;key_prefix:string;expires_at:string;last_used_at:string|null;account_id:string|null;access_active:boolean }
type Account={ id:string;name?:string;currency?:string }
type Status={ connections:Connection[];grants:Grant[];keys:Key[] }
const initial: Status={ connections:[],grants:[],keys:[] }
const messages: Record<string,string>={ account_unavailable:'This account is already assigned or cannot be connected here. Contact Magic Engine support.',
  reconnect_required:'Your Meta connection has expired or was disconnected. Connect Facebook again.',rate_limited:'Too many requests. Please wait one minute and try again.',
  permission_required:'Meta did not grant ads_read. Reconnect and allow read access.',not_available:'This pilot is not available yet.',
  provider_unavailable:'Meta could not be reached. Please try again.',request_failed:'The request failed. Please try again.' }
function useConnector({ clientId,outcome }: { clientId:string;outcome?:string }) {
  const [state,setState]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState(outcome==='reconnect_required' ? 'Facebook authorisation was cancelled or could not be completed. Connect Facebook again to retry.' : '')
  const [accounts,setAccounts]=useState<Account[]>([]),[connection,setConnection]=useState(''),[selected,setSelected]=useState('')
  const [key,setKey]=useState(''),[partial,setPartial]=useState(false),[discovered,setDiscovered]=useState(false)
  const endpoint=`/api/clients/${clientId}/meta-ads-ai`
  const load=useCallback(async()=>{
    const response=await fetch(endpoint,{ cache:'no-store' })
    const body=await response.json()
    if(!response.ok) throw new Error(body.error)
    setState(body as Status)
  },[endpoint])
  useEffect(()=>{ void load().catch(()=>setError('Unable to load your connections. Please reload.')) },[load])
  async function run(action:()=>Promise<void>) {
    setBusy(true);setError('')
    try { await action();await load() } catch(e) { setError(messages[e instanceof Error ? e.message : ''] ?? 'Unable to complete this step. Please retry or reconnect Facebook.') }
    finally { setBusy(false) }
  }
  async function post(body:Record<string,string>) {
    const response=await fetch(endpoint,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(body) })
    const result=await response.json()
    if(!response.ok) throw new Error(result.error)
    return result
  }
  async function connect() {
    const response=await fetch(`/api/auth/facebook/ads/connect?client_id=${clientId}`,{ method:'POST' })
    const result=await response.json()
    if(!response.ok) throw new Error(result.error)
    window.location.assign(result.url)
  }
  const live=state.connections.filter(c=>c.status==='active' && Date.parse(c.token_expiry)>Date.now())
  const activeGrants=state.grants.filter(g=>live.some(c=>c.id===g.connection_id))
  return { state,busy,error,setError,accounts,setAccounts,connection,setConnection,selected,setSelected,key,setKey,partial,setPartial,discovered,setDiscovered,run,post,connect,live,activeGrants }
}
export default function MetaAdsScreen(props: { clientId:string;outcome?:string }) {
  const { state,busy,error,setError,accounts,setAccounts,connection,setConnection,selected,setSelected,key,setKey,partial,setPartial,discovered,setDiscovered,run,post,connect,live,activeGrants }=useConnector(props)
  const [origin,setOrigin]=useState('')
  useEffect(()=>setOrigin(window.location.origin),[])
  const button='rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-40'
  return <main className="mx-auto max-w-3xl space-y-8 p-6">
    <header><p className="text-sm text-slate-500">Magic Engine · Free connector pilot</p><h1 className="text-3xl font-semibold">Meta Ads → AI</h1>
      <p className="mt-3">Connect Facebook and Instagram advertising data to your preferred AI. This connector only reads data. It cannot edit, pause, publish or delete ads.</p></header>
    {error && <p role="alert" className="rounded bg-red-50 p-4 text-red-800">{error}</p>}
    <section className="space-y-3"><h2 className="text-xl font-semibold">1. Connect Facebook</h2>
      <p>Use the Facebook profile that has access to your ad account. Read-only advertising access is requested. We do not request access to lead contact details or messages.</p>
      <button disabled={busy} className={button} onClick={()=>void run(connect)}>Connect Facebook</button>
      {state.connections.map(c=><div key={c.id} className="flex flex-wrap items-center gap-3 rounded border p-3"><span>{c.status==='active' && Date.parse(c.token_expiry)>Date.now() ? `Authorised until ${new Date(c.token_expiry).toLocaleDateString()}` : 'Reconnect required'}</span>
        <button disabled={busy} className="underline" onClick={()=>void run(async()=>{ await post({ action:'revoke',type:'connection',id:c.id });setKey('');setAccounts([]) })}>Disconnect Meta</button></div>)}
    </section>
    <section className="space-y-3"><h2 className="text-xl font-semibold">2. Choose an ad account</h2>
      <p>Select only the account you want this AI connection to read.</p>
      {live.map((c,index)=><button key={c.id} disabled={busy} className={button} onClick={()=>void run(async()=>{
        setConnection('');setAccounts([]);setDiscovered(false);setSelected('');setPartial(false);
        const result=await post({ action:'discover',connection_id:c.id });setConnection(c.id);setAccounts(result.accounts);setPartial(!result.complete);setDiscovered(true)
      })}>Find accounts{live.length>1 ? ` (${index+1})` : ''}</button>)}
      {partial && <p role="status">Meta returned more accounts than this pilot can list. Contact support to connect an account that is missing.</p>}
      {discovered && connection && accounts.length===0 && !busy && <p>No accessible ad accounts found. Check your Facebook account permissions and reconnect.</p>}
      {accounts.length>0 && <><label className="block">Ad account <select aria-label="Ad account" className="ml-2 rounded border p-2" value={selected} onChange={e=>setSelected(e.target.value)}>
        <option value="">Choose an account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name ?? a.id} · {a.id} · {a.currency}</option>)}</select></label>
        <button disabled={busy || !selected} className={button} onClick={()=>void run(async()=>{ await post({ action:'bind',connection_id:connection,account_id:selected });setAccounts([]);setConnection('') })}>Connect selected account</button></>}
      {activeGrants.map(g=><div key={g.id} className="rounded border p-3"><p>Account connected: {g.ad_account_id}</p><button disabled={busy} className="underline" onClick={()=>void run(async()=>{ await post({ action:'revoke',type:'grant',id:g.id });setKey('') })}>Remove account access</button></div>)}
    </section>
    <section className="space-y-3"><h2 className="text-xl font-semibold">3. Connect your AI</h2>
      <p>Your ad account and your AI app are separate connections. Choose an app that supports remote MCP with a Bearer token, or the HTTPS tools interface. App compatibility is still being verified in this pilot.</p>
      {activeGrants.map(g=><button key={g.id} disabled={busy} className={button} onClick={()=>void run(async()=>{ const result=await post({ action:'issue_key',grant_id:g.id });setKey(result.key) })}>Create AI access key for {g.ad_account_id}</button>)}
      {key && <div className="space-y-2 rounded bg-amber-50 p-4"><p>This key is shown once and expires in 30 days. Save it in your AI app’s connection settings. Anyone with it can read the selected account. Do not paste it into a chat message.</p>
        <input aria-label="AI access key" type="password" readOnly value={key} className="w-full rounded border p-2" />
        <button className="underline" onClick={()=>void navigator.clipboard.writeText(key).catch(()=>setError('Copy failed. Select the key field and copy it manually.'))}>Copy key</button>
        <button className="ml-4 underline" onClick={()=>setKey('')}>Hide key</button></div>}
      <p>MCP server: <code className="break-all">{origin ? `${origin}/api/mcp/mcp` : '/api/mcp/mcp'}</code></p>
      <p>HTTPS manifest: <code>/api/ai-tools/meta/manifest</code> · Invocation: <code>/api/ai-tools/meta/invoke</code></p>
      {state.keys.map(k=><div key={k.id} className="rounded border p-3"><p>{k.key_prefix}… · {k.account_id ?? 'Account access removed'} · {Date.parse(k.expires_at)>Date.now() ? 'Key created' : 'Key expired'} · {!k.access_active ? 'Account access is no longer active. Reconnect Facebook, select the account and create a new key.' : k.last_used_at ? 'Authentication received; this does not confirm analysis succeeded.' : 'Waiting for your AI app to connect.'}</p>
        <button disabled={busy} className="underline" onClick={()=>void run(async()=>{ await post({ action:'revoke',type:'key',id:k.id });setKey('') })}>Revoke AI key</button></div>)}
      <p>Once connected, ask: “Analyse my Facebook ads for the last 7 complete days. Compare campaigns, CPL, CTR, CPC, CPM, video retention and age/gender performance with the previous 7 days. Only analyse; do not change any ads.”</p>
    </section>
    <footer className="border-t pt-4 text-sm text-slate-600">Need ongoing monitoring across Meta, Google, TikTok, GA4 and CRM? Magic Engine brings your channels and business context together.</footer>
  </main>
}
