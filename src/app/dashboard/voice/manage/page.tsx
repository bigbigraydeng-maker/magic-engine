/** Voice Agent admin hub — tenants list + create. Configure agents end-to-end, no SQL. */
import Link from 'next/link'
import { getVoiceStore } from '@/lib/voice/store'
import { CreateTenantForm } from '../_components/admin-forms'

export const dynamic = 'force-dynamic'

export default async function VoiceManagePage() {
  let tenants: { id: string; slug: string; name: string; client_id: string | null; agents: number; routes: number; kb: number }[] = []
  let error: string | null = null
  try {
    const store = await getVoiceStore()
    const rows = await store.listTenants()
    tenants = await Promise.all(rows.map(async (t) => ({
      id: t.id, slug: t.slug, name: t.name, client_id: t.client_id,
      agents: (await store.listAgentsByTenant(t.id)).length,
      routes: (await store.listRoutesByTenant(t.id)).length,
      kb: (await store.listKnowledgeByTenant(t.id)).filter((d) => d.index_status !== 'disabled').length,
    })))
  } catch (e) { error = (e as Error).message }

  return (
    <div className="p-6 max-w-5xl mx-auto text-slate-100">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">Voice Agent — Manage</h1>
        <Link href="/dashboard/voice" className="text-sm text-slate-400 hover:text-slate-200">← overview</Link>
      </div>
      <p className="text-slate-400 mb-6 text-sm">配置语音租户 / agent / 号码路由 / 知识库 —— 全程后台，不碰 SQL。</p>

      {error && <div className="rounded border border-amber-600/50 bg-amber-900/20 p-3 mb-4 text-sm text-amber-200">Voice tables unavailable: {error}</div>}

      <div className="mb-6"><CreateTenantForm /></div>

      <h2 className="text-lg font-medium mb-2">Tenants</h2>
      <div className="space-y-2">
        {tenants.map((t) => (
          <Link key={t.id} href={`/dashboard/voice/tenants/${t.id}`} className="block rounded-lg border border-slate-700 bg-slate-800/40 p-4 hover:bg-slate-800">
            <div className="flex items-center justify-between">
              <div><span className="font-medium">{t.name}</span> <span className="text-slate-500 text-sm">/{t.slug}</span></div>
              <div className="text-xs text-slate-400">{t.agents} agents · {t.routes} routes · {t.kb} docs · {t.client_id ? 'mapped ✓' : 'no client map'}</div>
            </div>
          </Link>
        ))}
        {tenants.length === 0 && !error && <div className="text-slate-500 text-sm">No tenants yet — create one above.</div>}
      </div>
    </div>
  )
}
