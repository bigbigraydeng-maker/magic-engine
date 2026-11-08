'use client'

import type { ReactNode } from 'react'
import type { MonthlyAdsSection } from '@/lib/reports/monthly-ads-section'
import { ReportSectionHeader } from './Shared'

function money(amount: number | null, currency: string | null): string {
  if (amount == null) return '—'
  const sym = currency === 'NZD' ? 'NZ$' : currency === 'AUD' ? 'A$' : currency ? `${currency} ` : ''
  return `${sym}${amount.toFixed(2)}`
}

function vsTargetText(vs: MonthlyAdsSection['vsTarget'], target: number | null): string {
  if (vs === 'no_target' || target == null) return '未设置目标成本'
  if (vs === 'not_comparable') return '进线成本算不出，无法对比目标'
  if (vs === 'at_or_below') return `达目标（≤ ${target.toFixed(2)}）`
  if (vs === 'above') return `高于目标（> ${target.toFixed(2)}）`
  return '—'
}

function fmtDate(iso: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function SubBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-black/5 bg-me-ivory/40 p-4">
      <p className="text-xs font-bold text-me-charcoal/70 mb-2">{title}</p>
      {children}
    </div>
  )
}

function EntityTable({
  title,
  rows,
  empty,
}: {
  title: string
  rows: MonthlyAdsSection['topAdSets']
  empty: string
}) {
  if (rows.length === 0) {
    return (
      <SubBlock title={title}>
        <p className="text-sm text-me-charcoal/55">{empty}</p>
      </SubBlock>
    )
  }
  return (
    <SubBlock title={title}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-me-charcoal/55">
            <th className="pb-2 font-semibold">名称</th>
            <th className="pb-2 font-semibold text-right">花费</th>
            <th className="pb-2 font-semibold text-right">结果数</th>
            <th className="pb-2 font-semibold text-right">单次成本</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.name} className="border-t border-black/5">
              <td className="py-2 pr-2">{row.name}</td>
              <td className="py-2 text-right tabular-nums">{row.spend.toFixed(2)}</td>
              <td className="py-2 text-right tabular-nums">{row.results}</td>
              <td className="py-2 text-right tabular-nums">
                {row.costPerResult != null ? row.costPerResult.toFixed(2) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </SubBlock>
  )
}

export function AdsMonthlyPanel({ ads }: { ads: MonthlyAdsSection | null }) {
  if (!ads) {
    return (
      <section className="rounded-xl border border-me-border bg-white p-5 shadow-sm">
        <ReportSectionHeader title="付费广告" />
        <p className="text-sm text-me-charcoal/60">广告板块暂时没加载出来。</p>
      </section>
    )
  }

  const noun = ads.primaryResultLabel ?? '主结果'

  return (
    <section className="rounded-xl border border-me-border bg-white p-5 shadow-sm space-y-4">
      <ReportSectionHeader title="付费广告" />
      <p className="text-xs text-me-charcoal/50">口径：按客户设置的主结果（{noun}）汇总；金额单位 {ads.currency ?? '未读到'}。</p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="本月花费" value={money(ads.spend, ads.currency)} />
        <Kpi
          label={`本月${noun}数`}
          value={ads.results != null ? String(ads.results) : '—'}
        />
        <Kpi
          label={`单次${noun}成本`}
          value={money(ads.costPerResult, ads.currency)}
          sub={vsTargetText(ads.vsTarget, ads.targetCostPerResult)}
        />
        <Kpi
          label="合格询盘（CRM）"
          value={ads.qualifiedLeads != null ? String(ads.qualifiedLeads) : '—'}
          sub={ads.qualifiedStagesLabel ? `阶段：${ads.qualifiedStagesLabel}` : undefined}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <EntityTable
          title="表现最好的广告组（单次成本低）"
          rows={ads.topAdSets}
          empty="这个月没有可排名的广告组数据。"
        />
        <EntityTable
          title="表现偏弱的广告组"
          rows={ads.bottomAdSets}
          empty="这个月没有可排名的广告组数据。"
        />
        <EntityTable
          title="表现最好的素材"
          rows={ads.topCreatives}
          empty="这个月没有可排名的素材数据。"
        />
        <EntityTable
          title="表现偏弱的素材"
          rows={ads.bottomCreatives}
          empty="这个月没有可排名的素材数据。"
        />
      </div>

      <div>
        <p className="text-sm font-bold text-me-charcoal mb-2">本月执行过的广告调整</p>
        {ads.ledger.length === 0 ? (
          <p className="text-sm text-me-charcoal/55">本月没有记录到已落地的广告操作。</p>
        ) : (
          <ul className="space-y-3">
            {ads.ledger.map((line, idx) => (
              <li key={`${line.executedAt}-${idx}`} className="rounded-lg border border-black/5 p-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-semibold">{line.actionLabel}</span>
                  <span className="text-xs text-me-charcoal/50">{fmtDate(line.executedAt)}</span>
                </div>
                {line.entityName && (
                  <p className="mt-1 text-me-charcoal/80">{line.entityName}</p>
                )}
                {(line.beforeText || line.afterText) && (
                  <p className="mt-1 text-xs text-me-charcoal/65">
                    {[line.beforeText, line.afterText].filter(Boolean).join(' → ')}
                  </p>
                )}
                <p className="mt-1 text-xs text-me-charcoal/55">
                  观察：{line.observedResult ?? '—'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {ads.gaps.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3">
          <p className="text-xs font-bold text-amber-900 mb-1">数据缺口</p>
          <ul className="list-disc pl-4 text-xs text-amber-950 space-y-0.5">
            {ads.gaps.map(g => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-black/5 bg-me-ivory/50 p-3">
      <p className="text-xs text-me-charcoal/55">{label}</p>
      <p className="text-xl font-bold text-me-charcoal mt-1 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-me-charcoal/50 mt-1">{sub}</p>}
    </div>
  )
}
