'use client'

/** Interactive admin forms for Voice Agent config (agents / routes / knowledge / tenant). Magic Engine style. */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MePanel, MePanelHeader, MeButton } from '@/components/ui/me-primitives'

const ALL_TOOLS = ['search_knowledge_base', 'get_contact_profile', 'create_or_update_lead', 'schedule_callback', 'transfer_to_human', 'end_call']

async function jsonFetch(url: string, method: string, body?: unknown): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(url, {
    method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.ok) return { ok: true }
  const data = await res.json().catch(() => ({}))
  return { ok: false, error: (data as { error?: string }).error ?? `HTTP ${res.status}` }
}

const input = 'w-full rounded-xl border border-black/10 bg-[#FBF8F3] px-3 py-2.5 text-sm text-me-charcoal focus:outline-none focus:ring-2 focus:ring-[#C4912E]/30'
const label = 'text-[11px] font-semibold uppercase tracking-[.1em] text-black/40'
const errCls = 'text-[13px] text-[#C2453A]'

function useSubmit() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setBusy(true); setErr(null)
    const r = await fn()
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'failed'); return false }
    after?.(); router.refresh(); return true
  }
  return { busy, err, run }
}

export function CreateTenantForm() {
  const { busy, err, run } = useSubmit()
  const [slug, setSlug] = useState(''); const [name, setName] = useState('')
  const [clientId, setClientId] = useState(''); const [country, setCountry] = useState('NZ')
  return (
    <MePanel>
      <MePanelHeader title="新建语音租户" />
      <div className="grid gap-3 md:grid-cols-4">
        <div><div className={label}>slug</div><input className={input} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="cts-voice" /></div>
        <div><div className={label}>name</div><input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="CTS Tours" /></div>
        <div><div className={label}>ME client_id（脑子）</div><input className={input} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="uuid（可选）" /></div>
        <div><div className={label}>country</div><select className={input} value={country} onChange={(e) => setCountry(e.target.value)}><option>NZ</option><option>AU</option></select></div>
      </div>
      {err && <div className={`${errCls} mt-2`}>{err}</div>}
      <div className="mt-3"><MeButton size="sm" disabled={busy} onClick={() => run(
        () => jsonFetch('/api/voice/tenants', 'POST', { slug, name, client_id: clientId || null, country }),
        () => { setSlug(''); setName(''); setClientId('') },
      )}>{busy ? 'Creating…' : '新建租户'}</MeButton></div>
    </MePanel>
  )
}

export function TenantClientMap({ tenant }: { tenant: { id: string; name: string; client_id: string | null; openai_vector_store_id: string | null } }) {
  const { busy, err, run } = useSubmit()
  const [name, setName] = useState(tenant.name)
  const [clientId, setClientId] = useState(tenant.client_id ?? '')
  const [vs, setVs] = useState(tenant.openai_vector_store_id ?? '')
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <div><div className={label}>name</div><input className={input} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><div className={label}>ME client_id（读 master_brief 当脑子）</div><input className={input} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="uuid or blank" /></div>
        <div><div className={label}>OpenAI vector store id（可选）</div><input className={input} value={vs} onChange={(e) => setVs(e.target.value)} placeholder="vs_..." /></div>
      </div>
      {err && <div className={errCls}>{err}</div>}
      <MeButton size="sm" disabled={busy} onClick={() => run(() => jsonFetch(`/api/voice/tenants/${tenant.id}`, 'PATCH', { name, client_id: clientId || null, openai_vector_store_id: vs || null }))}>{busy ? 'Saving…' : '保存映射'}</MeButton>
    </div>
  )
}

interface AgentLite {
  id: string; name: string; role: string; status: string; greeting: string; system_instructions: string
  human_transfer_uri: string | null; enabled_tools: string[]; primary_language: string
}
export function AgentEditor({ tenantId, agent }: { tenantId: string; agent?: AgentLite }) {
  const { busy, err, run } = useSubmit()
  const [name, setName] = useState(agent?.name ?? '')
  const [role, setRole] = useState(agent?.role ?? 'sales')
  const [greeting, setGreeting] = useState(agent?.greeting ?? '')
  const [instructions, setInstructions] = useState(agent?.system_instructions ?? '')
  const [transfer, setTransfer] = useState(agent?.human_transfer_uri ?? '')
  const [lang, setLang] = useState(agent?.primary_language ?? 'en-NZ')
  const [tools, setTools] = useState<string[]>(agent?.enabled_tools ?? ALL_TOOLS)
  const toggle = (t: string) => setTools((cur) => cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t])
  return (
    <MePanel>
      <MePanelHeader title={agent ? `编辑 agent · ${agent.name}` : '新建 agent'} />
      <div className="grid gap-3 md:grid-cols-3">
        <div><div className={label}>name</div><input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Mia" /></div>
        <div><div className={label}>role</div><select className={input} value={role} onChange={(e) => setRole(e.target.value)}><option>sales</option><option>support</option><option>hybrid</option></select></div>
        <div><div className={label}>primary language</div><input className={input} value={lang} onChange={(e) => setLang(e.target.value)} placeholder="en-NZ" /></div>
      </div>
      <div className="mt-3"><div className={label}>greeting（AI 必须自报身份 · 硬约束）</div><input className={input} value={greeting} onChange={(e) => setGreeting(e.target.value)} placeholder="Thanks for calling… This is Mia, our AI assistant…" /></div>
      <div className="mt-3"><div className={label}>system instructions</div><textarea className={`${input} h-20`} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Never quote prices or make promises you can't verify…" /></div>
      <div className="mt-3"><div className={label}>transfer-to-human URI（白名单 · 上真实客户前必填）</div><input className={input} value={transfer} onChange={(e) => setTransfer(e.target.value)} placeholder="tel:+64211234567" /></div>
      <div className="mt-3">
        <div className={label}>enabled tools</div>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {ALL_TOOLS.map((t) => (
            <label key={t} className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-semibold ${tools.includes(t) ? 'bg-[#5C8A4A]/12 text-[#5C8A4A]' : 'border border-black/10 bg-[#FBF8F3] text-black/40'}`}>
              <input type="checkbox" className="mr-1 align-middle" checked={tools.includes(t)} onChange={() => toggle(t)} />{t}
            </label>
          ))}
        </div>
      </div>
      <div className="mt-3 text-xs text-[#C4912E]">✓ AI 身份披露强制开启（不可关）· 三禁红线在 prompt compiler 内置</div>
      {err && <div className={`${errCls} mt-2`}>{err}</div>}
      <div className="mt-3"><MeButton size="sm" disabled={busy} onClick={() => run(() => jsonFetch(`/api/voice/tenants/${tenantId}/agents`, 'POST', {
        id: agent?.id, name, role, status: 'active', greeting, system_instructions: instructions,
        human_transfer_uri: transfer || null, primary_language: lang, enabled_tools: tools, ai_disclosure_required: true,
      }))}>{busy ? 'Saving…' : agent ? '保存 agent' : '新建 agent'}</MeButton></div>
    </MePanel>
  )
}

export function AddRouteForm({ tenantId, agents }: { tenantId: string; agents: { id: string; name: string }[] }) {
  const { busy, err, run } = useSubmit()
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '')
  const [number, setNumber] = useState(''); const [provider, setProvider] = useState('signalwire'); const [country, setCountry] = useState('NZ')
  return (
    <div className="rounded-2xl border border-black/[.06] bg-[#FBF8F3] p-4 space-y-3">
      <div className={label}>新增号码路由</div>
      <div className="grid gap-3 md:grid-cols-4">
        <div><div className={label}>number</div><input className={input} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="+64…" /></div>
        <div><div className={label}>agent</div><select className={input} value={agentId} onChange={(e) => setAgentId(e.target.value)}>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <div><div className={label}>provider</div><select className={input} value={provider} onChange={(e) => setProvider(e.target.value)}><option>signalwire</option><option>voipline</option><option>telnyx</option><option>twilio</option></select></div>
        <div><div className={label}>country</div><select className={input} value={country} onChange={(e) => setCountry(e.target.value)}><option>NZ</option><option>AU</option><option>US</option></select></div>
      </div>
      {err && <div className={errCls}>{err}</div>}
      <MeButton size="sm" disabled={busy || !agentId} onClick={() => run(() => jsonFetch(`/api/voice/tenants/${tenantId}/phone-routes`, 'POST', { agent_id: agentId, phone_number: number, provider, country }), () => setNumber(''))}>{busy ? 'Adding…' : '添加路由'}</MeButton>
    </div>
  )
}

export function KnowledgeManager({ tenantId, docs }: { tenantId: string; docs: { id: string; title: string; chars: number }[] }) {
  const { busy, err, run } = useSubmit()
  const [title, setTitle] = useState(''); const [content, setContent] = useState('')
  return (
    <div className="space-y-3">
      {docs.length === 0 && <div className="text-[13px] text-black/45">还没有资料。粘贴产品/FAQ/政策文本 →</div>}
      {docs.map((d) => (
        <div key={d.id} className="flex items-center justify-between rounded-xl border border-black/[.06] px-3 py-2 text-sm">
          <span className="text-me-charcoal">{d.title} <span className="text-xs text-black/40">({d.chars} chars)</span></span>
          <button className="text-xs font-semibold text-[#C2453A] hover:opacity-70" disabled={busy} onClick={() => run(() => jsonFetch(`/api/voice/tenants/${tenantId}/knowledge/${d.id}`, 'DELETE'))}>disable</button>
        </div>
      ))}
      <div className="space-y-2 border-t border-black/[.06] pt-3">
        <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="doc title, e.g. Product & Pricing Policy" />
        <textarea className={`${input} h-28`} value={content} onChange={(e) => setContent(e.target.value)} placeholder="粘贴产品 / FAQ / 政策文本…" />
        {err && <div className={errCls}>{err}</div>}
        <MeButton size="sm" disabled={busy || !title || !content} onClick={() => run(() => jsonFetch(`/api/voice/tenants/${tenantId}/knowledge`, 'POST', { title, content }), () => { setTitle(''); setContent('') })}>{busy ? 'Adding…' : '添加文档'}</MeButton>
      </div>
    </div>
  )
}
