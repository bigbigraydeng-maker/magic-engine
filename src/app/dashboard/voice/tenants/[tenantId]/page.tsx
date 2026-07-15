/** Tenant admin — configure client mapping, agents, phone routes, knowledge (no SQL). */
import Link from 'next/link'
import { getVoiceStore } from '@/lib/voice/store'
import { AddRouteForm, AgentEditor, KnowledgeManager, TenantClientMap } from '../../_components/admin-forms'

export const dynamic = 'force-dynamic'

export default async function TenantAdminPage({ params }: { params: { tenantId: string } }) {
  let tenant, agents, routes, docs
  try {
    const store = await getVoiceStore()
    tenant = await store.getTenantById(params.tenantId)
    if (!tenant) return <div className="p-6 text-slate-300">Tenant not found.</div>
    agents = await store.listAgentsByTenant(tenant.id)
    routes = await store.listRoutesByTenant(tenant.id)
    docs = (await store.listKnowledgeByTenant(tenant.id))
      .filter((d) => d.index_status !== 'disabled')
      .map((d) => ({ id: d.id, title: d.title, chars: String((d.attributes as { content?: string })?.content ?? '').length }))
  } catch (e) {
    return <div className="p-6 text-amber-300">Voice tables unavailable: {(e as Error).message}</div>
  }

  return (
    <div className="p-6 max-w-4xl mx-auto text-slate-100 space-y-6">
      <div>
        <Link href="/dashboard/voice/manage" className="text-sm text-slate-400 hover:text-slate-200">← manage</Link>
        <h1 className="text-2xl font-semibold mt-1">{tenant.name} <span className="text-slate-500 text-base">/{tenant.slug}</span></h1>
      </div>

      <section>
        <h2 className="text-lg font-medium mb-2">Client mapping（脑子来源）</h2>
        <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
          <TenantClientMap tenant={{ id: tenant.id, name: tenant.name, client_id: tenant.client_id, openai_vector_store_id: tenant.openai_vector_store_id }} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium mb-2">Agents</h2>
        <div className="space-y-3">
          {agents.map((a) => (
            <AgentEditor key={a.id} tenantId={tenant!.id} agent={{
              id: a.id, name: a.name, role: a.role, status: a.status, greeting: a.greeting,
              system_instructions: a.system_instructions, human_transfer_uri: a.human_transfer_uri,
              enabled_tools: a.enabled_tools, primary_language: a.primary_language,
            }} />
          ))}
          <AgentEditor tenantId={tenant.id} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium mb-2">Phone routes</h2>
        <div className="space-y-2 mb-3">
          {routes.map((r) => (
            <div key={r.id} className="rounded border border-slate-800 px-3 py-1.5 text-sm flex justify-between">
              <span className="font-mono">{r.phone_number_e164}</span>
              <span className="text-slate-400">{r.provider} · {r.direction} · {r.status}</span>
            </div>
          ))}
          {routes.length === 0 && <div className="text-slate-500 text-sm">No routes yet.</div>}
        </div>
        <AddRouteForm tenantId={tenant.id} agents={agents.map((a) => ({ id: a.id, name: a.name }))} />
      </section>

      <section>
        <h2 className="text-lg font-medium mb-2">Knowledge base</h2>
        <KnowledgeManager tenantId={tenant.id} docs={docs} />
      </section>
    </div>
  )
}
