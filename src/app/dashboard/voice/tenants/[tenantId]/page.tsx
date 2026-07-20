/** Tenant admin — configure client mapping, agents, phone routes, knowledge (no SQL). */
import Link from 'next/link'
import { getVoiceStore } from '@/lib/voice/store'
import { MePanel, MePanelHeader, MeChip } from '@/components/ui/me-primitives'
import { AddRouteForm, AgentEditor, KnowledgeManager, TenantClientMap } from '../../_components/admin-forms'

export const dynamic = 'force-dynamic'

export default async function TenantAdminPage({ params }: { params: { tenantId: string } }) {
  let tenant, agents, routes, docs
  try {
    const store = await getVoiceStore()
    tenant = await store.getTenantById(params.tenantId)
    if (!tenant) return <div className="font-sans px-8 py-7 text-black/60">Tenant not found.</div>
    agents = await store.listAgentsByTenant(tenant.id)
    routes = await store.listRoutesByTenant(tenant.id)
    docs = (await store.listKnowledgeByTenant(tenant.id))
      .filter((d) => d.index_status !== 'disabled')
      .map((d) => ({ id: d.id, title: d.title, chars: String((d.attributes as { content?: string })?.content ?? '').length }))
  } catch (e) {
    return <div className="font-sans px-8 py-7 text-[#C4912E]">Voice tables unavailable: {(e as Error).message}</div>
  }

  return (
    <div className="font-sans">
      <header className="sticky top-0 z-20 border-b border-black/10 bg-[#FBF8F3]/80 px-8 py-5 backdrop-blur-md">
        <Link href="/dashboard/voice/manage" className="text-[13px] text-black/50 hover:text-me-charcoal">← 配置</Link>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-me-charcoal">{tenant.name} <span className="text-base text-black/40">/{tenant.slug}</span></h1>
      </header>

      <div className="px-8 py-7 space-y-6 max-w-4xl">
        <MePanel>
          <MePanelHeader title="Client 映射（脑子来源）" />
          <TenantClientMap tenant={{ id: tenant.id, name: tenant.name, client_id: tenant.client_id, openai_vector_store_id: tenant.openai_vector_store_id }} />
        </MePanel>

        <section className="space-y-3">
          <div className="flex items-center gap-2"><h2 className="font-display text-lg font-semibold text-me-charcoal">Agents</h2><MeChip>{agents.length}</MeChip></div>
          {agents.map((a) => (
            <AgentEditor key={a.id} tenantId={tenant!.id} agent={{
              id: a.id, name: a.name, role: a.role, status: a.status, greeting: a.greeting,
              system_instructions: a.system_instructions, human_transfer_uri: a.human_transfer_uri,
              enabled_tools: a.enabled_tools, primary_language: a.primary_language,
            }} />
          ))}
          <AgentEditor tenantId={tenant.id} />
        </section>

        <MePanel>
          <MePanelHeader title="号码路由" />
          <div className="mb-3 space-y-2">
            {routes.map((r) => (
              <div key={r.id} className="flex justify-between rounded-xl border border-black/[.06] px-3 py-2 text-sm">
                <span className="font-mono text-me-charcoal">{r.phone_number_e164}</span>
                <span className="text-black/50">{r.provider} · {r.direction} · {r.status}</span>
              </div>
            ))}
            {routes.length === 0 && <div className="text-sm text-black/45">还没有路由。</div>}
          </div>
          <AddRouteForm tenantId={tenant.id} agents={agents.map((a) => ({ id: a.id, name: a.name }))} />
        </MePanel>

        <MePanel>
          <MePanelHeader title="知识库" />
          <KnowledgeManager tenantId={tenant.id} docs={docs} />
        </MePanel>
      </div>
    </div>
  )
}
