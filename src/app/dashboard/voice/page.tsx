/**
 * Voice Agent dashboard — overview (spec §16). Integration status, tenants, recent
 * calls (promises_made surfaced per 板桥 #3), and leads. Reads the configured store;
 * degrades gracefully with a setup notice when the migration is not yet applied.
 */
import Link from 'next/link'
import { getVoiceStore } from '@/lib/voice/store'
import { getVoiceConfig } from '@/lib/voice/config'
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

function StatusDot({ mode }: { mode: string }) {
  const color = mode === 'real' ? 'bg-green-500' : 'bg-amber-500'
  return <span className={`inline-block h-2 w-2 rounded-full ${color} mr-1`} />
}

export default async function VoiceDashboardPage() {
  const cfg = getVoiceConfig()
  const data = await loadOverview()
  const allCalls = data.tenants.flatMap((t) => t.calls.map((c) => ({ c, tenant: t.tenant })))
    .sort((a, b) => b.c.created_at.localeCompare(a.c.created_at)).slice(0, 25)

  return (
    <div className="p-6 max-w-6xl mx-auto text-slate-100">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">Voice Agent</h1>
        <a href="/dashboard/voice/manage" className="rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600">⚙ Manage / 配置</a>
      </div>
      <p className="text-slate-400 mb-6 text-sm">AI phone sales &amp; support · P0 (mock closed loop)</p>

      {/* Integration status */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {Object.entries(cfg.providers).map(([k, v]) => (
          <div key={k} className="rounded-lg border border-slate-700 bg-slate-800/40 p-3">
            <div className="text-xs uppercase text-slate-400">{k}</div>
            <div className="text-sm mt-1"><StatusDot mode={v} />{v}</div>
          </div>
        ))}
        <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-3">
          <div className="text-xs uppercase text-slate-400">store</div>
          <div className="text-sm mt-1">{cfg.storeKind}</div>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-3">
          <div className="text-xs uppercase text-slate-400">outbound</div>
          <div className="text-sm mt-1">{cfg.outboundEnabled ? 'enabled' : 'sandbox (test numbers only)'}</div>
        </div>
      </div>

      {!data.ok && (
        <div className="rounded-lg border border-amber-600/50 bg-amber-900/20 p-4 mb-6 text-sm">
          <div className="font-medium text-amber-300 mb-1">Voice tables not available yet</div>
          <p className="text-slate-300">Apply migration <code>20260715000001_voice_agent_p0.sql</code>, then run{' '}
          <code>npx tsx --env-file=.env.local scripts/voice/create-demo-tenant.ts</code>. ({data.error})</p>
        </div>
      )}

      {data.ok && data.tenants.length === 0 && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-4 mb-6 text-sm text-slate-300">
          No voice tenants yet. Run <code>scripts/voice/create-demo-tenant.ts</code> to seed the demo.
        </div>
      )}

      {/* Recent calls */}
      {allCalls.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-medium mb-3">Recent calls</h2>
          <div className="space-y-2">
            {allCalls.map(({ c, tenant }) => {
              const so = (c.structured_outcome ?? {}) as { promises_made?: string[]; risk_flags?: string[] }
              return (
                <Link key={c.id} href={`/dashboard/voice/calls/${c.id}`}
                  className="block rounded-lg border border-slate-700 bg-slate-800/40 p-4 hover:bg-slate-800">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{tenant.name}</span>
                    <span className="text-slate-400">{c.direction} · {c.status}{c.is_simulated ? ' · sim' : ''}</span>
                  </div>
                  <div className="text-sm text-slate-300 mt-1">{c.summary ?? '(no summary)'}</div>
                  <div className="flex gap-3 mt-2 text-xs">
                    {c.outcome && <span className="px-2 py-0.5 rounded bg-slate-700">{c.outcome}</span>}
                    {so.promises_made?.length ? (
                      <span className="px-2 py-0.5 rounded bg-emerald-800/60 text-emerald-200">
                        ✓ promised: {so.promises_made.length}
                      </span>
                    ) : null}
                    {so.risk_flags?.length ? (
                      <span className="px-2 py-0.5 rounded bg-red-800/60 text-red-200">⚠ {so.risk_flags.length}</span>
                    ) : null}
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* Leads */}
      {data.tenants.some((t) => t.leads.length > 0) && (
        <section>
          <h2 className="text-lg font-medium mb-3">Leads</h2>
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/60 text-slate-400 text-left">
                <tr><th className="p-2">Tenant</th><th className="p-2">Interest</th><th className="p-2">Intent</th><th className="p-2">Budget</th><th className="p-2">Area</th><th className="p-2">Next action</th></tr>
              </thead>
              <tbody>
                {data.tenants.flatMap((t) => t.leads.map((l) => (
                  <tr key={l.id} className="border-t border-slate-800">
                    <td className="p-2">{t.tenant.name}</td>
                    <td className="p-2">{l.service_interest ?? '—'}</td>
                    <td className="p-2">{l.intent_level ?? '—'}</td>
                    <td className="p-2">{l.budget_min != null ? `${l.budget_min}-${l.budget_max ?? ''} ${l.currency ?? ''}` : '—'}</td>
                    <td className="p-2">{l.preferred_area ?? '—'}</td>
                    <td className="p-2">{l.next_action ?? '—'}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
