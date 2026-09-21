'use client'
import { useEffect,useState,useCallback } from 'react'
type Connection={ id:string;status:string;token_expiry:string }
type Grant={ id:string;ad_account_id:string;connection_id:string }
type LegacyConnection={ id:string;account_id?:string;expires_at?:string }
type Account={ id:string;name?:string;currency?:string }
type Analysis={ id:string;status:'running'|'completed'|'no_data'|'failed';ad_account_id:string;window_since:string;window_until:string;report_markdown:string|null;error_code:string|null;created_at:string;completed_at:string|null }
type Pilot={ invited:boolean;new_actions_allowed:boolean;reason:'ready'|'service_paused'|'invitation_required'|'invitation_inactive'|'invitation_expired' }
type Status={ pilot:Pilot;connections:Connection[];grants:Grant[];keys:LegacyConnection[];analyses:Analysis[] }
const initial: Status={ pilot:{ invited:false,new_actions_allowed:false,reason:'invitation_required' },connections:[],grants:[],keys:[],analyses:[] }
const messages: Record<string,string>={ account_unavailable:'该广告账户已绑定到其他客户，或当前无法连接。请联系 Magic Engine 支持。',
  reconnect_required:'Facebook 授权已取消、已过期或未完成，请重新连接 Facebook。',rate_limited:'请求过于频繁，请等待一分钟后重试。',
  permission_required:'Meta 未授予广告数据读取权限，请重新连接并允许读取广告数据。',not_available:'邀请测试暂未开放。',
  provider_unavailable:'暂时无法连接 Meta，请稍后重试。',request_failed:'操作失败，请重试。',
  service_paused:'测试服务目前已暂停。你仍可查看状态、断开连接和停止旧版外部访问。',pilot_required:'该客户尚未获得邀请测试资格。',
  invitation_required:'该客户尚未获得邀请测试资格。',invitation_inactive:'邀请测试资格目前未启用。',invitation_expired:'邀请测试资格已到期。',
  invitation_changed:'本次邀请已经结束。重新受邀后，请重新连接 Facebook 并选择广告账户。',
  connection_owner_required:'请使用最初完成 Facebook 授权的 Magic Engine 账号操作。',disconnect_not_found:'该连接不存在、已被撤销，或不属于当前账号。',
  sponsored_analysis_unavailable:'当前邀请尚未开通免费分析额度，请联系 Magic Engine 支持。',sponsored_budget_exhausted:'本月免费分析额度已用完。',
  analysis_too_large:'当前广告数据量超过邀请测试版上限，请联系 Magic Engine 支持。',analysis_failed:'分析暂时失败，请稍后重试。',
  analysis_incomplete:'本次报告未完整生成，请稍后重试。',authorization_changed:'Facebook 授权或广告账户权限已经变化，请刷新后重试。' }
const pilotMessages: Record<Pilot['reason'],string>={ ready:'',service_paused:'测试服务目前已暂停。你仍可查看状态、断开连接和停止旧版外部访问。',
  invitation_required:'该客户尚未获得邀请测试资格。',invitation_inactive:'邀请测试资格目前未启用。',invitation_expired:'邀请测试资格已到期。' }
function useConnector({ clientId,outcome }: { clientId:string;outcome?:string }) {
  const initialError=outcome && outcome!=='authorised' ? (messages[outcome] ?? (outcome==='reconnect_required' ? 'Facebook 授权已取消或未能完成，请重新连接 Facebook。' : '授权流程未能完成，请返回当前页面检查连接状态。')) : ''
  const [state,setState]=useState(initial),[busy,setBusy]=useState(false),[busyMessage,setBusyMessage]=useState(''),[error,setError]=useState(initialError)
  const [accounts,setAccounts]=useState<Account[]>([]),[connection,setConnection]=useState(''),[selected,setSelected]=useState('')
  const [partial,setPartial]=useState(false),[discovered,setDiscovered]=useState(false)
  const endpoint=`/api/clients/${clientId}/meta-ads-ai`
  const load=useCallback(async()=>{
    const response=await fetch(endpoint,{ cache:'no-store' })
    const body=await response.json()
    if(!response.ok) throw new Error(body.error)
    setState(body as Status)
  },[endpoint])
  useEffect(()=>{ void load().catch(()=>setError('无法加载连接状态，请刷新页面后重试。')) },[load])
  async function run(action:()=>Promise<void>,message='正在处理，请稍候…') {
    setBusy(true);setBusyMessage(message);setError('')
    try { await action();await load() } catch(e) {
      const code=e instanceof Error ? e.message : ''
      if(code==='audit_completion_failed') {
        setError('操作可能已经完成，系统正在重新检查连接状态。')
        await load().catch(()=>undefined)
      } else setError(messages[code] ?? '无法完成此步骤，请重试或重新连接 Facebook。')
    }
    finally { setBusy(false);setBusyMessage('') }
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
  return { state,busy,busyMessage,error,accounts,setAccounts,connection,setConnection,selected,setSelected,partial,setPartial,discovered,setDiscovered,run,post,connect,load,live,activeGrants }
}
export default function MetaAdsScreen(props: { clientId:string;outcome?:string }) {
  const { state,busy,busyMessage,error,accounts,setAccounts,connection,setConnection,selected,setSelected,partial,setPartial,discovered,setDiscovered,run,post,connect,load,live,activeGrants }=useConnector(props)
  const button='rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-40'
  const canStart=state.pilot.new_actions_allowed
  return <main className="mx-auto max-w-3xl space-y-8 p-6">
    <header><p className="text-sm text-slate-500">Magic Engine · 免费广告分析邀请测试</p><h1 className="text-3xl font-semibold">Meta 广告 → AI</h1>
      <p className="mt-3">连接 Facebook 和 Instagram 广告账户后，点击按钮即可生成中文分析报告。系统只能读取数据，不能修改、暂停、发布或删除任何广告。</p></header>
    {error && <p role="alert" className="rounded bg-red-50 p-4 text-red-800">{error}</p>}
    {busy && busyMessage && <p role="status" className="rounded bg-blue-50 p-4 text-blue-900">{busyMessage}</p>}
    {!canStart && <p role="status" className="rounded bg-amber-50 p-4 text-amber-900">{pilotMessages[state.pilot.reason]}</p>}
    <section className="space-y-3"><h2 className="text-xl font-semibold">1. 连接 Facebook</h2>
      <p>请使用有权访问广告账户的 Facebook 个人账号登录。系统只申请广告数据读取权限，不会读取潜在客户联系方式或消息。</p>
      <button disabled={busy || !canStart} className={button} onClick={()=>void run(connect)}>连接 Facebook</button>
      {state.connections.map(c=><div key={c.id} className="flex flex-wrap items-center gap-3 rounded border p-3"><span>{c.status==='active' && Date.parse(c.token_expiry)>Date.now() ? `授权有效期至 ${new Date(c.token_expiry).toLocaleDateString('zh-CN')}` : '需要重新授权'}</span>
        <button disabled={busy} className="underline" onClick={()=>void run(async()=>{ await post({ action:'revoke',type:'connection',id:c.id });setAccounts([]) })}>断开 Meta 连接</button></div>)}
    </section>
    <section className="space-y-3"><h2 className="text-xl font-semibold">2. 选择广告账户</h2>
      <p>请选择允许 Magic Engine 读取的广告账户。</p>
      {live.map((c,index)=><button key={c.id} disabled={busy || !canStart} className={button} onClick={()=>void run(async()=>{
        setConnection('');setAccounts([]);setDiscovered(false);setSelected('');setPartial(false);
        const result=await post({ action:'discover',connection_id:c.id });setConnection(c.id);setAccounts(result.accounts);setPartial(!result.complete);setDiscovered(true)
      })}>查找广告账户{live.length>1 ? `（连接 ${index+1}）` : ''}</button>)}
      {partial && <p role="status">Meta 返回的账户数量超过当前测试版的显示上限。如未找到目标账户，请联系 Magic Engine 支持。</p>}
      {discovered && connection && accounts.length===0 && !busy && <p>没有找到可访问的广告账户。请检查 Facebook 账户权限并重新连接。</p>}
      {accounts.length>0 && <><label className="block">广告账户 <select aria-label="广告账户" className="ml-2 rounded border p-2" value={selected} onChange={e=>setSelected(e.target.value)}>
        <option value="">请选择账户</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name ?? a.id} · {a.id} · {a.currency}</option>)}</select></label>
        <button disabled={busy || !canStart || !selected} className={button} onClick={()=>void run(async()=>{ await post({ action:'bind',connection_id:connection,account_id:selected });setAccounts([]);setConnection('') })}>连接所选账户</button></>}
      {activeGrants.map(g=><div key={g.id} className="rounded border p-3"><p>已连接广告账户：{g.ad_account_id}</p><button disabled={busy} className="underline" onClick={()=>void run(async()=>{ await post({ action:'revoke',type:'grant',id:g.id }) })}>移除账户访问权限</button></div>)}
    </section>
    <section className="space-y-3"><h2 className="text-xl font-semibold">3. 生成广告分析</h2>
      <p>Magic Engine 会读取最近 7 个完整自然日的数据，并生成中文报告。只分析，不会修改任何广告。</p>
      {activeGrants.map(g=><button key={g.id} disabled={busy || !canStart} className={button} onClick={()=>void run(async()=>{
        await post({ action:'generate_analysis',grant_id:g.id })
      },'正在读取最近 7 天广告数据并生成中文报告，请不要关闭页面…')}>生成 {g.ad_account_id} 的近 7 天分析</button>)}
      {activeGrants.length===0 && <p className="rounded bg-slate-50 p-3 text-slate-700">请先完成上面的 Facebook 连接和广告账户选择。</p>}
      {state.analyses.map(a=><article key={a.id} className="space-y-3 rounded border p-4">
        <div><p className="font-medium">广告账户：{a.ad_account_id}</p><p className="text-sm text-slate-600">分析期间：{a.window_since} 至 {a.window_until}</p></div>
        {a.status==='completed' && <div className="whitespace-pre-wrap leading-7">{a.report_markdown}</div>}
        {a.status==='no_data' && <p role="status">这个期间没有可分析的广告数据，因此没有产生 AI 分析费用。</p>}
        {a.status==='running' && <p role="status">报告正在生成，请稍后刷新页面。</p>}
        {a.status==='failed' && <p role="alert" className="text-red-700">本次分析没有完成。请稍后重试；如持续失败，请联系 Magic Engine 支持。</p>}
      </article>)}
      <button disabled={busy} className="underline" onClick={()=>void run(load)}>刷新报告状态</button>
    </section>
    <section className="space-y-3 border-t pt-6"><h2 className="text-xl font-semibold">退出测试与数据处理</h2>
      <p>“断开 Meta 连接”会立即阻止 Magic Engine 继续读取广告数据，但不会自动撤销你在 Facebook 中授予 Magic Engine 应用的授权，也不会自动删除此前生成的分析报告。</p>
      {state.keys.length>0 && <div className="space-y-2 rounded border p-3"><p className="font-medium">旧版外部连接</p>
        <p>这个账户曾在早期测试中连接过外部 AI 应用。你可以在这里停止旧版访问，不影响已经生成的报告。</p>
        {state.keys.map(item=><button key={item.id} disabled={busy} className="mr-3 underline" onClick={()=>void run(async()=>{
          await post({ action:'revoke',type:'key',id:item.id })
        })}>停止 {item.account_id ? `${item.account_id} 的` : ''}旧版连接{item.expires_at ? `（有效期至 ${new Date(item.expires_at).toLocaleDateString('zh-CN')}）` : ''}</button>)}
      </div>}
      <p>如需彻底撤销应用授权，请同时前往 Facebook 的“业务集成”设置移除 Magic Engine。若要申请查询或删除 Magic Engine 保存的测试数据，请联系 <a className="underline" href="mailto:hello@magicengine.cloud?subject=Meta%20Ads%20AI%20数据请求">hello@magicengine.cloud</a>。</p>
    </section>
    <footer className="border-t pt-4 text-sm text-slate-600">需要持续监控 Meta、Google、TikTok、GA4 和 CRM？Magic Engine 可以把各渠道数据与业务背景统一起来分析。</footer>
  </main>
}
