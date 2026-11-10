'use client'

import React from 'react'
import Link from 'next/link'
import { MePill, MeTable } from '@/components/ui/me-primitives'

type Verdict = 'healthy' | 'watch' | 'alert' | 'insufficient_history' | 'paused'

const ROW_META: Record<Verdict, { label: string; tone: 'rej' | 'exec' | 'track' | 'attn' }> = {
  alert: { label: '该动手', tone: 'rej' },
  watch: { label: '留意', tone: 'exec' },
  healthy: { label: '健康', tone: 'track' },
  insufficient_history: { label: '数据积累中', tone: 'attn' },
  paused: { label: '已停投', tone: 'attn' },
}

export interface CampaignTableRow {
  campaign_id: string
  campaign_name: string
  verdict: Verdict
  headline: string
  latest_spend_7d: number
  latest_results_7d: number
  frequency_7d: number | null
  hasConfirmCard?: boolean
}

function oneLine(row: CampaignTableRow, costLabel: string): string {
  const cpl = row.latest_results_7d > 0 ? row.latest_spend_7d / row.latest_results_7d : null
  if (row.headline.trim()) return row.headline
  if (cpl != null) return `${costLabel} $${cpl.toFixed(1)}`
  return '—'
}

export function AdsHealthCampaignTable({
  clientId,
  rows,
  costPerResultLabel,
  linkToDetail = true,
}: {
  clientId: string
  rows: readonly CampaignTableRow[]
  costPerResultLabel: string
  linkToDetail?: boolean
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-me-charcoal/55">现在没有在投的广告系列。</p>
  }

  return (
    <section className="mb-6 rounded-[24px] border border-black/10 bg-white p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-me-charcoal">每条广告 · 最紧要的排最前</h2>
        {linkToDetail && (
          <Link
            href={`/dashboard/clients/${clientId}/ads-health?tab=ads`}
            className="text-sm font-medium text-me-ochre hover:text-me-charcoal"
          >
            看每条的细节 →
          </Link>
        )}
      </div>
      <div className="overflow-x-auto">
        <MeTable>
          <thead>
            <tr className="border-b border-me-stone text-left text-xs text-me-charcoal/55">
              <th className="py-2 pr-3 font-medium">广告</th>
              <th className="py-2 pr-3 font-medium">状态</th>
              <th className="py-2 pr-3 font-medium text-right">近 7 天花费</th>
              <th className="py-2 pr-3 font-medium text-right">留资</th>
              <th className="py-2 pr-3 font-medium text-right">每个留资</th>
              <th className="py-2 pr-3 font-medium text-right">看腻程度</th>
              <th className="py-2 font-medium">一句话</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const meta = ROW_META[row.verdict]
              const cpl = row.latest_results_7d > 0 ? row.latest_spend_7d / row.latest_results_7d : null
              return (
                <tr key={row.campaign_id} className="border-b border-me-stone/60 text-sm text-me-charcoal">
                  <td className="py-2.5 pr-3 align-top">
                    <p className="font-medium">{row.campaign_name}</p>
                    {row.hasConfirmCard && (
                      <p className="mt-0.5 text-xs text-me-ochre">↑ 上面有确认卡</p>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 align-top">
                    <MePill tone={meta.tone}>{meta.label}</MePill>
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums align-top">${row.latest_spend_7d.toFixed(0)}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums align-top">{row.latest_results_7d}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums align-top">
                    {cpl === null ? '—' : `$${cpl.toFixed(1)}`}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums align-top">
                    {row.frequency_7d == null ? '—' : row.frequency_7d.toFixed(2)}
                  </td>
                  <td className="py-2.5 align-top text-sm text-me-charcoal/75">{oneLine(row, costPerResultLabel)}</td>
                </tr>
              )
            })}
          </tbody>
        </MeTable>
      </div>
    </section>
  )
}
