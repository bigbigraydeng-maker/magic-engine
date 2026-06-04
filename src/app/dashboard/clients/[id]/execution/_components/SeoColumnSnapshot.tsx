'use client'

/**
 * SeoColumnSnapshot — Phase 22.E.S4ext
 *
 * Sticky row injected between the SEO column header and its items, showing the
 * client's SEO baseline at a glance:
 *
 *   📊 月点击 155 · 总曝光 7,006 · Page-1 词数 0 · 平均排名 18.3
 *
 * Purpose: PM 反馈 "FDE 不知道 action 带来的价值和希望达到的目标是什么".
 * Showing the baseline lets the FDE feel the lift each action produces over
 * the next 90 days, without having to navigate to SEO Intelligence.
 *
 * Data sources (no new schema):
 *   - `metrics` endpoint  → gsc_clicks / gsc_impressions / gsc_avg_position
 *   - `page-1-count` endpoint → keyword_snapshots rank ≤ 10 count
 */

import { useEffect, useState } from 'react'

interface Props {
  clientId: string
}

interface SnapshotData {
  monthlyClicks: number | null
  impressions: number | null
  avgPosition: number | null
  page1Keywords: number | null
}

type Status = 'loading' | 'no_data' | 'ready' | 'error'

export function SeoColumnSnapshot({ clientId }: Props) {
  const [status, setStatus] = useState<Status>('loading')
  const [data, setData]     = useState<SnapshotData | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [metricsRes, page1Res] = await Promise.all([
          fetch(`/api/clients/${clientId}/seo-intelligence/metrics`),
          fetch(`/api/clients/${clientId}/seo-intelligence/page-1-count`),
        ])

        if (cancelled) return

        if (!metricsRes.ok || !page1Res.ok) {
          setStatus('error')
          return
        }

        const metrics = await metricsRes.json()
        const page1   = await page1Res.json()

        const snap: SnapshotData = {
          monthlyClicks: typeof metrics.gsc_clicks       === 'number' ? metrics.gsc_clicks       : null,
          impressions:   typeof metrics.gsc_impressions  === 'number' ? metrics.gsc_impressions  : null,
          avgPosition:   typeof metrics.gsc_avg_position === 'number' ? metrics.gsc_avg_position : null,
          page1Keywords: typeof page1.page_1_keywords    === 'number' ? page1.page_1_keywords    : null,
        }

        // No data = every GSC field is null AND keyword count is 0/null with no snapshot.
        const hasGsc = snap.monthlyClicks !== null || snap.impressions !== null || snap.avgPosition !== null
        const hasKw  = snap.page1Keywords !== null && (page1.snapshot_date != null)

        if (!hasGsc && !hasKw) {
          setStatus('no_data')
        } else {
          setData(snap)
          setStatus('ready')
        }
      } catch {
        if (!cancelled) setStatus('error')
      }
    }

    void load()
    return () => { cancelled = true }
  }, [clientId])

  if (status === 'loading') {
    return (
      <div className="bg-amber-50/40 border-b border-amber-100 px-5 py-2 text-[11px] font-bold text-amber-900/50">
        📊 加载客户 SEO 基础…
      </div>
    )
  }

  if (status === 'no_data') {
    return (
      <div className="bg-amber-50/40 border-b border-amber-100 px-5 py-2 text-[11px] font-bold text-amber-900/70">
        📊 暂无 GSC 数据 — 请先连接 Google Search Console 或等待每日采集 cron
      </div>
    )
  }

  if (status === 'error' || !data) {
    return (
      <div className="bg-amber-50/40 border-b border-amber-100 px-5 py-2 text-[11px] font-bold text-amber-900/70">
        📊 客户 SEO 基础加载失败
      </div>
    )
  }

  return (
    <div className="bg-amber-50/40 border-b border-amber-100 px-5 py-2 text-[11px] font-bold text-amber-900">
      <span>📊 客户 SEO 基础：</span>
      <span className="ml-2">月点击 <span className="font-black">{formatNumber(data.monthlyClicks)}</span></span>
      <span className="mx-2 text-amber-900/40">·</span>
      <span>总曝光 <span className="font-black">{formatNumber(data.impressions)}</span></span>
      <span className="mx-2 text-amber-900/40">·</span>
      <span>Page-1 词数 <span className="font-black">{formatNumber(data.page1Keywords)}</span></span>
      <span className="mx-2 text-amber-900/40">·</span>
      <span>平均排名 <span className="font-black">{formatAvgPosition(data.avgPosition)}</span></span>
    </div>
  )
}

function formatNumber(n: number | null): string {
  if (n === null) return '—'
  // 28-day clicks / impressions are integers in GSC; safe to round.
  return Math.round(n).toLocaleString('en-AU')
}

function formatAvgPosition(n: number | null): string {
  if (n === null) return '—'
  return n.toFixed(1)
}
