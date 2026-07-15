/** Voice Agent admin hub — tenants list + create. Configure agents end-to-end, no SQL. */
import Link from 'next/link'
import { getVoiceStore } from '@/lib/voice/store'
import { MePanel, MePanelHeader, MeButton, MeChip } from '@/components/ui/me-primitives'
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
    <div className="font-sans">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-5 border-b border-black/10 bg-[#FBF8F3]/80 px-8 py-5 backdrop-blur-md">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-me-charcoal">Voice Agent · 配置</h1>
          <p className="mt-0.5 text-[13px] text-black/55">配置语音租户 / agent / 号码路由 / 知识库 —— 全程后台，不碰 SQL。</p>
        </div>
        <MeButton href="/dashboard/voice" variant="ghost" size="sm">← 总览</MeButton>
      </header>

      <div className="px-8 py-7 space-y-6 max-w-5xl">
        {error && (
          <MePanel className="border-[#C4912E]/30 bg-[#C4912E]/[.06]">
            <div className="text-sm text-black/60">Voice tables unavailable: {error}</div>
          </MePanel>
        )}

        <CreateTenantForm />

        <MePanel>
          <MePanelHeader title="Tenants" right={<MeChip>{tenants.length}</MeChip>} />
          <div className="space-y-2">
            {tenants.map((t) => (
              <Link key={t.id} href={`/dashboard/voice/tenants/${t.id}`} className="block rounded-2xl border border-black/[.06] px-4 py-3.5 transition-colors hover:bg-[#FBF8F3]">
                <div className="flex items-center justify-between gap-3">
                  <div><span className="font-display font-semibold text-me-charcoal">{t.name}</span> <span className="text-[13px] text-black/40">/{t.slug}</span></div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <MeChip>{t.agents} agents</MeChip><MeChip>{t.routes} routes</MeChip><MeChip>{t.kb} docs</MeChip>
                    <MeChip gold={Boolean(t.client_id)}>{t.client_id ? '已映射' : '未映射'}</MeChip>
                  </div>
                </div>
              </Link>
            ))}
            {tenants.length === 0 && !error && <div className="text-sm text-black/45">还没有租户 — 上方新建一个。</div>}
          </div>
        </MePanel>
      </div>
    </div>
  )
}
