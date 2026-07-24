'use client'

/**
 * Ads Health dashboard — P21.K.3
 *
 * The PM-facing face of the Ad Strategy Engine. Built for a non-technical
 * reader (板桥 review): one-line conclusion first, worst campaign first, every
 * verdict backed by the last 7 days of raw numbers so the PM can see the decay
 * with their own eyes rather than trust a black box. All judgement is done by
 * the daily cron; this page only reads ad_health_narratives.
 */

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

type Verdict = 'healthy' | 'watch' | 'alert' | 'insufficient_history' | 'paused'

interface MetricVerdict {
  metric: 'ctr' | 'cost_per_result'
  verdict: Verdict
  baseline: number | null
  recent: number | null
  ratio: number | null
  reason: string
}

interface CampaignNarrative {
  campaign_id: string
  campaign_name: string
  verdict: Verdict
  headline: string
  metrics: MetricVerdict[]
  ctr_series: Array<{ date: string; ctr: number | null }>
  latest_spend_7d: number
  latest_results_7d: number
  frequency_7d: number | null
}

interface Payload {
  overall_verdict: Verdict
  headline: string
  campaigns: CampaignNarrative[]
  evaluated: number
  generated_for: string
}

interface AdHealthResponse {
  success: boolean
  latest: {
    insight_date: string
    overall_verdict: Verdict
    headline: string
    payload: Payload
  } | null
  history: Array<{ insight_date: string; overall_verdict: Verdict }>
}

// ─── Verdict styling (colour = conclusion, per 板桥) ───────────────────────────

const VERDICT_META: Record<Verdict, { label: string; dot: string; tint: string; text: string }> = {
  alert:                { label: '该动手了', dot: 'bg-red-500',    tint: 'bg-red-50 border-red-200',       text: 'text-red-700' },
  watch:                { label: '留意',     dot: 'bg-amber-500',  tint: 'bg-amber-50 border-amber-200',   text: 'text-amber-700' },
  healthy:              { label: '健康',     dot: 'bg-emerald-500', tint: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' },
  insufficient_history: { label: '数据积累中', dot: 'bg-gray-400',  tint: 'bg-gray-50 border-gray-200',     text: 'text-gray-500' },
  paused:               { label: '已停投',   dot: 'bg-gray-300',  tint: 'bg-gray-50 border-gray-200 opacity-70', text: 'text-gray-400' },
}

function fmtPct(fraction: number | null): string {
  return fraction == null ? '—' : `${(fraction * 100).toFixed(1)}%`
}

const VERDICT_RANK: Record<Verdict, number> = {
  alert: 3, watch: 2, healthy: 1, insufficient_history: 0, paused: -1,
}

/** Short date like "7/14" for the mobile-friendly strip endpoints. */
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`
}

// ─── Raw 7-day CTR strip — the "see it yourself" trust element ─────────────────
//
// 板桥 P0: without the campaign's OWN best-week anchor and a plain-language note,
// this strip reads as a flat, contradictory jumble ("you said 4.2%→3.0% but I
// see 2.5%→…→2.5%"). We lead with the best-week baseline, then the recent days,
// then one sentence that reconciles "bumpy but down vs its own peak".

function CtrStrip({ series, ctr }: { series: Array<{ date: string; ctr: number | null }>; ctr?: MetricVerdict }) {
  const points = series.filter(p => p.ctr != null)
  if (points.length < 2) return null

  const baseline = ctr?.baseline ?? null
  const downPct = ctr?.ratio != null ? Math.round((1 - ctr.ratio) * 100) : null
  const worrying = ctr?.verdict === 'alert' || ctr?.verdict === 'watch'

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {baseline != null && (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-500 mr-1">
            最好的一周 <span className="tabular-nums font-medium text-gray-700">{fmtPct(baseline)}</span>
          </span>
        )}
        <span className="text-gray-400 mr-0.5">近 7 天:</span>
        {points.map((p, i) => {
          const prev = i > 0 ? points[i - 1].ctr : null
          const down = prev != null && p.ctr != null && p.ctr < prev
          return (
            <span key={p.date} className="inline-flex items-center" title={p.date}>
              <span className={`tabular-nums ${down ? 'text-red-600' : 'text-gray-600'}`}>
                {down && <span aria-hidden className="mr-0.5">↓</span>}
                {fmtPct(p.ctr)}
              </span>
              {i < points.length - 1 && <span className="text-gray-300 mx-0.5">→</span>}
            </span>
          )
        })}
      </div>
      <div className="mt-1 text-[11px] text-gray-400">
        {shortDate(points[0].date)} → {shortDate(points[points.length - 1].date)}
      </div>
      {worrying && baseline != null && downPct != null && (
        <p className="mt-2 text-xs text-gray-500 leading-relaxed">
          这一周点击率忽高忽低是正常波动;但跟它自己<span className="font-medium text-gray-700">最好的一周（{fmtPct(baseline)}）</span>比,整体低了约 {downPct}% —— 这是被同一批人看腻、创意开始失效的信号。
        </p>
      )}
    </div>
  )
}

// ─── Campaign card ─────────────────────────────────────────────────────────────

function CampaignCard({ c }: { c: CampaignNarrative }) {
  const meta = VERDICT_META[c.verdict]
  const ctrMetric = c.metrics.find(m => m.metric === 'ctr')
  // Cost per lead is always derivable from the 7-day aggregates when there are
  // results — show it directly so the PM doesn't have to divide in their head.
  const cpl = c.latest_results_7d > 0 ? c.latest_spend_7d / c.latest_results_7d : null

  return (
    <div className={`rounded-xl border p-4 ${meta.tint}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${meta.dot}`} />
          <span className="font-medium text-gray-800 truncate" title={c.campaign_name}>
            {c.campaign_name}
          </span>
        </div>
        <span className={`text-sm font-semibold shrink-0 ${meta.text}`}>{meta.label}</span>
      </div>

      <p className="mt-2 text-sm text-gray-600">{c.headline}</p>

      <CtrStrip series={c.ctr_series} ctr={ctrMetric} />

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-400">
        <span>近 7 天花费 <span className="text-gray-600 tabular-nums">${c.latest_spend_7d.toFixed(0)}</span></span>
        <span>近 7 天询盘 <span className="text-gray-600 tabular-nums">{c.latest_results_7d}</span></span>
        {cpl != null && (
          <span>每个询盘成本 <span className="text-gray-600 tabular-nums">${cpl.toFixed(1)}</span></span>
        )}
        {c.frequency_7d != null && (
          <span>看腻程度 <span className="text-gray-600 tabular-nums">{c.frequency_7d.toFixed(2)}</span>（1 以下算正常，越高越腻）</span>
        )}
      </div>

      {(c.verdict === 'alert' || c.verdict === 'watch') && (
        <p className="mt-3 text-xs text-gray-400 border-t border-gray-200/60 pt-2">
          → 具体怎么处理（换素材 / 调整），下一步的处方会给到，无需你手动操作。
        </p>
      )}
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function AdsHealthPage() {
  const params = useParams()
  const clientId = params.id as string

  const [data, setData] = useState<AdHealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(`/api/clients/${clientId}/ad-health`)
      .then(r => r.json())
      .then((json: AdHealthResponse & { error?: string }) => {
        if (!alive) return
        if (json.error) setError(json.error)
        else setData(json)
      })
      .catch(() => alive && setError('加载失败'))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [clientId])

  const latest = data?.latest
  const overall = latest?.overall_verdict ?? 'insufficient_history'
  const overallMeta = VERDICT_META[overall]

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-6">
        <Link href={`/dashboard/clients/${clientId}`} className="text-sm text-gray-400 hover:text-gray-600">
          ← 返回客户
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-gray-800">广告健康</h1>
        <p className="text-sm text-gray-400">每天自动体检 · 把每条广告跟它自己最好的一周比</p>
      </div>

      {loading && <div className="text-gray-400 text-sm py-12 text-center">加载中…</div>}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          加载出错:{error}
        </div>
      )}

      {!loading && !error && !latest && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center text-gray-500">
          <p className="text-sm">广告数据还在积累中,暂时没有健康报告。</p>
          <p className="text-xs mt-2 text-gray-400">系统每天凌晨自动体检,数据够了这里就会出现。</p>
        </div>
      )}

      {!loading && !error && latest && (
        <>
          {/* One-line conclusion first (板桥: 颜色即结论) */}
          <div className={`rounded-xl border p-5 mb-6 ${overallMeta.tint}`}>
            <div className="flex items-center gap-2.5">
              <span className={`inline-block w-3 h-3 rounded-full ${overallMeta.dot}`} />
              <span className={`text-lg font-semibold ${overallMeta.text}`}>{latest.headline}</span>
            </div>
            <p className="mt-1.5 text-xs text-gray-400">
              体检日期 {latest.insight_date} · 共 {latest.payload.evaluated} 条广告
            </p>
          </div>

          {/* Worst first — the engine already sorts, but re-sort as a fallback
              so a bad cron day can't silently bury an alert below healthy cards. */}
          <div className="space-y-3">
            {[...latest.payload.campaigns]
              .sort((a, b) => VERDICT_RANK[b.verdict] - VERDICT_RANK[a.verdict])
              .map(c => (
                <CampaignCard key={c.campaign_id} c={c} />
              ))}
          </div>

          <p className="mt-8 text-xs text-gray-300 text-center">
            所有判断由系统每天自动生成 · 数字直接来自广告平台,可自行核对
          </p>
        </>
      )}
    </div>
  )
}
