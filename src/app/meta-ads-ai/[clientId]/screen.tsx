'use client'
import { useEffect,useState,useCallback } from 'react'
type Connection={ id:string;status:string;token_expiry:string }
type Grant={ id:string;ad_account_id:string;connection_id:string }
type LastRead={ tool:string;account_id:string|null;at:string }
type Key={ id:string;key_prefix:string;expires_at:string;last_used_at:string|null;account_id:string|null;access_active:boolean;last_successful_read:LastRead|null }
type Account={ id:string;name?:string;currency?:string }
type Pilot={ invited:boolean;new_actions_allowed:boolean;reason:'ready'|'service_paused'|'invitation_required'|'invitation_inactive'|'invitation_expired' }
type Status={ pilot:Pilot;connections:Connection[];grants:Grant[];keys:Key[] }
const initial: Status={ pilot:{ invited:false,new_actions_allowed:false,reason:'invitation_required' },connections:[],grants:[],keys:[] }
const messages: Record<string,string>={ account_unavailable:'该广告账户已绑定到其他客户，或当前无法连接。请联系 Magic Engine 支持。',
  reconnect_required:'Facebook 授权已取消、已过期或未完成，请重新连接 Facebook。',rate_limited:'请求过于频繁，请等待一分钟后重试。',
  permission_required:'Meta 未授予 ads_read 只读广告权限，请重新连接并允许读取广告数据。',not_available:'邀请测试暂未开放。',
  provider_unavailable:'暂时无法连接 Meta，请稍后重试。',request_failed:'操作失败，请重试。',
  service_paused:'测试服务目前已暂停。你仍可查看状态、断开连接和撤销密钥。',pilot_required:'该客户尚未获得邀请测试资格。',
  invitation_required:'该客户尚未获得邀请测试资格。',invitation_inactive:'邀请测试资格目前未启用。',invitation_expired:'邀请测试资格已到期。',
  invitation_changed:'本次邀请已经结束。重新受邀后，请重新连接 Facebook 并创建新的 AI 密钥。',
  connection_owner_required:'请使用最初完成 Facebook 授权的 Magic Engine 账号操作。',disconnect_not_found:'该连接不存在、已被撤销，或不属于当前账号。' }
const pilotMessages: Record<Pilot['reason'],string>={ ready:'',service_paused:'测试服务目前已暂停。你仍可查看状态、断开连接和撤销密钥。',
  invitation_required:'该客户尚未获得邀请测试资格。',invitation_inactive:'邀请测试资格目前未启用。',invitation_expired:'邀请测试资格已到期。' }
function useConnector({ clientId,outcome }: { clientId:string;outcome?:string }) {
  const initialError=outcome && outcome!=='authorised' ? (messages[outcome] ?? (outcome==='reconnect_required' ? 'Facebook 授权已取消或未能完成，请重新连接 Facebook。' : '授权流程未能完成，请返回当前页面检查连接状态。')) : ''
  const [state,setState]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState(initialError)
  const [accounts,setAccounts]=useState<Account[]>([]),[connection,setConnection]=useState(''),[selected,setSelected]=useState('')
  const [key,setKey]=useState(''),[partial,setPartial]=useState(false),[discovered,setDiscovered]=useState(false)
  const endpoint=`/api/clients/${clientId}/meta-ads-ai`
  const load=useCallback(async()=>{
    const response=await fetch(endpoint,{ cache:'no-store' })
    const body=await response.json()
    if(!response.ok) throw new Error(body.error)
    setState(body as Status)
  },[endpoint])
  useEffect(()=>{ void load().catch(()=>setError('无法加载连接状态，请刷新页面后重试。')) },[load])
  async function run(action:()=>Promise<void>) {
    setBusy(true);setError('')
    try { await action();await load() } catch(e) {
      const code=e instanceof Error ? e.message : ''
      if(code==='audit_completion_failed') {
        setError('操作可能已经完成，系统正在重新检查连接状态。')
        await load().catch(()=>undefined)
      } else setError(messages[code] ?? '无法完成此步骤，请重试或重新连接 Facebook。')
    }
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
  return { state,busy,error,setError,accounts,setAccounts,connection,setConnection,selected,setSelected,key,setKey,partial,setPartial,discovered,setDiscovered,run,post,connect,load,live,activeGrants }
}
function readLabel(tool:string) {
  return tool==='meta_list_accounts' ? '已成功读取账户信息' : '已成功读取广告数据'
}
export default function MetaAdsScreen(props: { clientId:string;outcome?:string }) {
  const { state,busy,error,setError,accounts,setAccounts,connection,setConnection,selected,setSelected,key,setKey,partial,setPartial,discovered,setDiscovered,run,post,connect,load,live,activeGrants }=useConnector(props)
  const [origin,setOrigin]=useState('')
  useEffect(()=>setOrigin(window.location.origin),[])
  const button='rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-40'
  const canStart=state.pilot.new_actions_allowed
  return <main className="mx-auto max-w-3xl space-y-8 p-6">
    <header><p className="text-sm text-slate-500">Magic Engine · 免费连接器邀请测试</p><h1 className="text-3xl font-semibold">Meta 广告 → AI</h1>
      <p className="mt-3">把 Facebook 和 Instagram 广告数据连接到你选择的 AI。本连接器只能读取数据，不能修改、暂停、发布或删除任何广告。</p></header>
    {error && <p role="alert" className="rounded bg-red-50 p-4 text-red-800">{error}</p>}
    {!canStart && <p role="status" className="rounded bg-amber-50 p-4 text-amber-900">{pilotMessages[state.pilot.reason]}</p>}
    <section className="space-y-3"><h2 className="text-xl font-semibold">1. 连接 Facebook</h2>
      <p>请使用有权访问广告账户的 Facebook 个人账号登录。系统只申请广告数据读取权限，不会读取潜在客户联系方式或消息。</p>
      <button disabled={busy || !canStart} className={button} onClick={()=>void run(connect)}>连接 Facebook</button>
      {state.connections.map(c=><div key={c.id} className="flex flex-wrap items-center gap-3 rounded border p-3"><span>{c.status==='active' && Date.parse(c.token_expiry)>Date.now() ? `授权有效期至 ${new Date(c.token_expiry).toLocaleDateString('zh-CN')}` : '需要重新授权'}</span>
        <button disabled={busy} className="underline" onClick={()=>void run(async()=>{ await post({ action:'revoke',type:'connection',id:c.id });setKey('');setAccounts([]) })}>断开 Meta 连接</button></div>)}
    </section>
    <section className="space-y-3"><h2 className="text-xl font-semibold">2. 选择广告账户</h2>
      <p>请选择允许这个 AI 连接读取的广告账户。</p>
      {live.map((c,index)=><button key={c.id} disabled={busy || !canStart} className={button} onClick={()=>void run(async()=>{
        setConnection('');setAccounts([]);setDiscovered(false);setSelected('');setPartial(false);
        const result=await post({ action:'discover',connection_id:c.id });setConnection(c.id);setAccounts(result.accounts);setPartial(!result.complete);setDiscovered(true)
      })}>查找广告账户{live.length>1 ? `（连接 ${index+1}）` : ''}</button>)}
      {partial && <p role="status">Meta 返回的账户数量超过当前测试版的显示上限。如未找到目标账户，请联系 Magic Engine 支持。</p>}
      {discovered && connection && accounts.length===0 && !busy && <p>没有找到可访问的广告账户。请检查 Facebook 账户权限并重新连接。</p>}
      {accounts.length>0 && <><label className="block">广告账户 <select aria-label="广告账户" className="ml-2 rounded border p-2" value={selected} onChange={e=>setSelected(e.target.value)}>
        <option value="">请选择账户</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name ?? a.id} · {a.id} · {a.currency}</option>)}</select></label>
        <button disabled={busy || !canStart || !selected} className={button} onClick={()=>void run(async()=>{ await post({ action:'bind',connection_id:connection,account_id:selected });setAccounts([]);setConnection('') })}>连接所选账户</button></>}
      {activeGrants.map(g=><div key={g.id} className="rounded border p-3"><p>已连接广告账户：{g.ad_account_id}</p><button disabled={busy} className="underline" onClick={()=>void run(async()=>{ await post({ action:'revoke',type:'grant',id:g.id });setKey('') })}>移除账户访问权限</button></div>)}
    </section>
    <section className="space-y-3"><h2 className="text-xl font-semibold">3. 连接你的 AI</h2>
      <p>广告账户授权与 AI 应用连接是两个独立步骤。请选择支持 Bearer Token 的远程 MCP 应用，或使用 HTTPS 工具接口。邀请测试期间，我们会继续验证各 AI 应用的兼容性。</p>
      {activeGrants.map(g=><button key={g.id} disabled={busy || !canStart} className={button} onClick={()=>void run(async()=>{ const result=await post({ action:'issue_key',grant_id:g.id });setKey(result.key) })}>为 {g.ad_account_id} 创建 AI 访问密钥</button>)}
      {key && <div className="space-y-2 rounded bg-amber-50 p-4"><p>密钥只显示一次，有效期为 30 天。请保存到 AI 应用的连接设置中。任何获得密钥的人都可以读取所选广告账户，请勿把密钥粘贴到聊天消息中。</p>
        <input aria-label="AI 访问密钥" type="password" readOnly value={key} className="w-full rounded border p-2" />
        <button className="underline" onClick={()=>void navigator.clipboard.writeText(key).catch(()=>setError('复制失败，请选中密钥并手动复制。'))}>复制密钥</button>
        <button className="ml-4 underline" onClick={()=>setKey('')}>隐藏密钥</button></div>}
      <p>MCP 服务器：<code className="break-all">{origin ? `${origin}/api/mcp/mcp` : '/api/mcp/mcp'}</code></p>
      <p>HTTPS 工具清单：<code>/api/ai-tools/meta/manifest</code> · 调用地址：<code>/api/ai-tools/meta/invoke</code></p>
      <div className="flex flex-wrap items-center gap-3"><button disabled={busy} className={button} onClick={()=>void run(load)}>刷新连接状态</button><p className="text-sm text-slate-600">在 AI 中完成一次调用后，请点击这里检查是否真正读到了数据。</p></div>
      {state.keys.map(k=><div key={k.id} className="space-y-2 rounded border p-3"><p>{k.key_prefix}… · {k.account_id ?? '广告账户访问权限已移除'} · {Date.parse(k.expires_at)>Date.now() ? '密钥已创建' : '密钥已过期'} · {!k.access_active ? '广告账户授权已失效。请重新连接 Facebook、选择账户并创建新密钥。' : k.last_successful_read ? `${readLabel(k.last_successful_read.tool)}。` : k.last_used_at ? 'AI 已通过身份验证，但还没有成功读取广告数据。' : '正在等待 AI 应用连接。'}</p>
        {k.last_successful_read && <div role="status" className="rounded bg-green-50 p-3 text-green-900"><p className="font-medium">{readLabel(k.last_successful_read.tool)}</p><p>广告账户：{k.last_successful_read.account_id ?? k.account_id ?? '已授权账户'} · 工具：{k.last_successful_read.tool} · 时间：{new Date(k.last_successful_read.at).toLocaleString('zh-CN')}</p><p>这只表示本次工具调用成功，不代表整份广告分析已经完成。{!k.access_active ? '这是历史记录，当前授权已失效。' : ''}</p></div>}
        <button disabled={busy} className="underline" onClick={()=>void run(async()=>{ await post({ action:'revoke',type:'key',id:k.id });setKey('') })}>撤销 AI 密钥</button></div>)}
      <p>连接成功后，你可以这样问：“分析我过去 7 个完整自然日的 Facebook 广告。比较各 Campaign 的 CPL、CTR、CPC、CPM、视频留存以及年龄和性别表现，并与此前 7 天对比。只分析，不修改任何广告。”</p>
    </section>
    <section className="space-y-3 border-t pt-6"><h2 className="text-xl font-semibold">退出测试与数据处理</h2>
      <p>“断开 Meta 连接”会立即阻止 Magic Engine 继续读取广告数据，但不会自动撤销你在 Facebook 中授予 Magic Engine 应用的授权，也不会删除已经进入第三方 AI 聊天记录的内容。</p>
      <p>如需彻底撤销应用授权，请同时前往 Facebook 的“业务集成”设置移除 Magic Engine。若要申请查询或删除 Magic Engine 保存的测试数据，请联系 <a className="underline" href="mailto:hello@magicengine.cloud?subject=Meta%20Ads%20AI%20数据请求">hello@magicengine.cloud</a>。</p>
    </section>
    <footer className="border-t pt-4 text-sm text-slate-600">需要持续监控 Meta、Google、TikTok、GA4 和 CRM？Magic Engine 可以把各渠道数据与业务背景统一起来分析。</footer>
  </main>
}
