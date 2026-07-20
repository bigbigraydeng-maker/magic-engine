/**
 * Voice Agent dashboard — overview (spec §16). Integration status, tenants, recent
 * calls (promises_made surfaced per 板桥 #3), and leads. Magic Engine design system.
 */
import Link from 'next/link'
import { getVoiceStore } from '@/lib/voice/store'
import { getVoiceConfig } from '@/lib/voice/config'
import { MePanel, MePanelHeader, MeButton, MePill, MeStatCard, MeTable, MeTh, MeTd, MeTr, MeChip } from '@/components/ui/me-primitives'
import type { CallRow, LeadRow, TenantRow } from '@/lib/voice/store/types'

export const dynamic = 'force-dynamic'

interface Overview {
  ok: boolean
  error?: string
  tenants: { tenant: TenantRow; calls: CallRow[]; leads: LeadRow[] }[]
}

async function loadOverview(): Promise<Overview> {
  try {
    const store = await getVoiceStore()
    const tenants = await store.listTenants()
    const rows = await Promise.all(
      tenants.map(async (tenant) => ({
        tenant,
        calls: await store.listCallsByTenant(tenant.id, { limit: 20 }),
        leads: await store.listLeadsByTenant(tenant.id, 20),
      })),
    )
    return { ok: true, tenants: rows }
  } catch (e) {
    return { ok: false, error: (e as Error).message, tenants: [] }
  }
}

export default async function VoiceDashboardPage() {
  const cfg = getVoiceConfig()
  const data = await loadOverview()
  const allCalls = data.tenants.flatMap((t) => t.calls.map((c) => ({ c, tenant: t.tenant })))
    .sort((a, b) => b.c.created_at.localeCompare(a.c.created_at)).slice(0, 25)
  const leadRows = data.tenants.flatMap((t) => t.leads.map((l) => ({ l, tenant: t.tenant })))

  return (
    <div className="font-sans">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-5 border-b border-black/10 bg-[#FBF8F3]/80 px-8 py-5 backdrop-blur-md">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-me-charcoal">Voice Agent</h1>
          <p className="mt-0.5 text-[13px] text-black/55">AI 电话销售 &amp; 客服 · P0</p>
        </div>
        <MeButton href="/dashboard/voice/manage" variant="secondary" size="sm">⚙ 配置 / Manage</MeButton>
      </header>

      <div className="px-8 py-7 space-y-6">
        {/* Integration status */}
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {Object.entries(cfg.providers).map(([k, v]) => (
            <MeStatCard key={k} value={<span className="text-lg">{v}</span>} label={k.toUpperCase()}
              tone={v === 'real' ? 'track' : 'attn'} />
          ))}
          <MeStatCard value={<span className="text-lg">{cfg.storeKind}</span>} label="STORE" tone="stone" />
          <MeStatCard value={<span className="text-lg">{cfg.outboundEnabled ? 'on' : 'sandbox'}</span>} label="OUTBOUND" tone="stone" />
        </section>

        {!data.ok && (
          <MePanel className="border-[#C4912E]/30 bg-[#C4912E]/[.06]">
            <div className="font-display font-semibold text-me-charcoal mb-1">Voice tables 尚不可用</div>
            <p className="text-sm text-black/60">Apply migration <code>20260715000001_voice_agent_p0.sql</code>，再跑{' '}
            <code>scripts/voice/create-demo-tenant.ts</code>。（{data.error}）</p>
          </MePanel>
        )}

        {data.ok && data.tenants.length === 0 && (
          <MePanel><div className="text-sm text-black/55">还没有语音租户。到 <Link className="text-[#C4912E] font-semibold" href="/dashboard/voice/manage">配置</Link> 建一个。</div></MePanel>
        )}

        {/* Recent calls */}
        {allCalls.length > 0 && (
          <MePanel>
            <MePanelHeader title="最近通话" right={<MeChip>{allCalls.length}</MeChip>} />
            <div className="divide-y divide-black/[.06]">
              {allCalls.map(({ c, tenant }) => {
                const so = (c.structured_outcome ?? {}) as { promises_made?: string[]; risk_flags?: string[] }
                return (
                  <Link key={c.id} href={`/dashboard/voice/calls/${c.id}`} className="-mx-2 block rounded-xl px-2 py-3.5 transition-colors hover:bg-[#FBF8F3]">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-display text-[14.5px] font-semibold tracking-tight text-me-charcoal">{tenant.name}</div>
                        <div className="mt-1 line-clamp-1 text-[13px] text-black/60">{c.summary ?? '（无摘要）'}</div>
                      </div>
                      <div className="flex flex-none items-center gap-2">
                        {c.outcome && <MePill tone={c.outcome === 'qualified' ? 'track' : c.outcome === 'transferred' ? 'sched' : 'exec'}>{c.outcome}</MePill>}
                        <MeChip>{c.direction}{c.is_simulated ? '·sim' : ''}</MeChip>
                      </div>
                    </div>
                    {(so.promises_made?.length || so.risk_flags?.length) ? (
                      <div className="mt-2 flex gap-2 text-xs">
                        {so.promises_made?.length ? <MeChip gold>✓ 承诺 {so.promises_made.length}</MeChip> : null}
                        {so.risk_flags?.length ? <MePill tone="rej">⚠ {so.risk_flags.length}</MePill> : null}
                      </div>
                    ) : null}
                  </Link>
                )
              })}
            </div>
          </MePanel>
        )}

        {/* Leads */}
        {leadRows.length > 0 && (
          <MePanel>
            <MePanelHeader title="线索 Leads" />
            <div className="overflow-x-auto">
              <MeTable>
                <thead><MeTr><MeTh>客户</MeTh><MeTh>需求</MeTh><MeTh>意向</MeTh><MeTh>预算</MeTh><MeTh>地区</MeTh><MeTh>下一步</MeTh></MeTr></thead>
                <tbody>
                  {leadRows.map(({ l, tenant }) => (
                    <MeTr key={l.id}>
                      <MeTd>{tenant.name}</MeTd>
                      <MeTd>{l.service_interest ?? '—'}</MeTd>
                      <MeTd>{l.intent_level ? <MePill tone={l.intent_level === 'high' ? 'track' : l.intent_level === 'medium' ? 'exec' : 'attn'}>{l.intent_level}</MePill> : '—'}</MeTd>
                      <MeTd>{l.budget_min != null ? `${l.budget_min}-${l.budget_max ?? ''} ${l.currency ?? ''}` : '—'}</MeTd>
                      <MeTd>{l.preferred_area ?? '—'}</MeTd>
                      <MeTd>{l.next_action ?? '—'}</MeTd>
                    </MeTr>
                  ))}
                </tbody>
              </MeTable>
            </div>
          </MePanel>
        )}
      </div>
    </div>
  )
}
