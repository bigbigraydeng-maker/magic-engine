'use client'

import type { SourceCoverage } from './types'

function MetricStatus({ label, available }: { label: string; available: boolean }) {
  return <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm"><span>{label}</span><span className={available ? 'font-medium text-green-700' : 'font-medium text-amber-700'}>{available ? '已有数据' : '暂无 / 需授权'}</span></div>
}

export function SourceCoveragePanel({ coverage }: { coverage?: SourceCoverage }) {
  const sources: Array<[string, boolean]> = [
    ['品牌简报', coverage?.masterBrief ?? false], ['主页已登记', coverage?.facebookPage ?? false],
    ['社媒诊断记录', coverage?.socialSnapshot ?? false], ['Meta 广告快照', coverage?.adSnapshot ?? false],
    ['粉丝数', coverage?.followerCount ?? false], ['ThruPlay / 消息等目标明细', coverage?.objectiveBreakdown ?? false],
  ]
  return (
    <aside className="rounded-2xl border border-me-stone bg-[#FBF8F3] p-5">
      <h2 className="font-display text-lg font-bold">可用资料</h2>
      <div className="mt-3 space-y-2">{sources.map(([label, available]) => <MetricStatus key={label} label={label} available={available} />)}</div>
      {coverage?.adSnapshotStale && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">已有 Meta 广告快照超过 30 天，仅作为历史背景，不作为当前可用数据。</p>}
      <p className="mt-3 text-xs leading-5 text-me-charcoal/60">“暂无”表示 ME 保存的数据不含该指标。方案会列出缺口，不会推算或伪造结果。</p>
    </aside>
  )
}
