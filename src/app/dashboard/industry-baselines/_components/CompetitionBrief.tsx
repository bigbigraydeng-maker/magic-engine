import type { BriefDimension, BriefStatus, CompetitionBrief as Brief } from '@/lib/web-intelligence/competition-brief'

const statusLabel: Record<BriefStatus, string> = {
  ready: '可直接比较', limited: '仅有单方数据', stale: '需要更新', unconfigured: '尚未配置',
  no_observation: '暂无记录', failed: '读取失败', not_connected: '尚未接入',
}
const statusStyle: Record<BriefStatus, string> = {
  ready: 'bg-green-50 text-green-800', limited: 'bg-amber-50 text-amber-800', stale: 'bg-amber-50 text-amber-800',
  unconfigured: 'bg-black/5 text-me-charcoal/60', no_observation: 'bg-black/5 text-me-charcoal/60',
  failed: 'bg-red-50 text-red-800', not_connected: 'bg-black/5 text-me-charcoal/60',
}
const observed = (value: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Pacific/Auckland', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value)) : '尚无观测日期'
const generated = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Pacific/Auckland', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))

function DimensionCard({ item }: { item: BriefDimension }) {
  return <article className="rounded-xl border border-black/10 bg-white p-4">
    <div className="flex items-start justify-between gap-2">
      <h3 className="font-bold">{item.label}</h3>
      <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${statusStyle[item.status]}`}>{statusLabel[item.status]}</span>
    </div>
    <p className="mt-3 text-sm font-bold leading-6">{item.headline}</p>
    <p className="mt-2 text-sm leading-6 text-me-charcoal/75">{item.detail}</p>
    {item.items && item.items.length > 0 && <ul className="mt-3 divide-y divide-black/5 rounded-lg bg-me-ivory px-3">{item.items.map(value => <li key={value} className="py-2 text-sm leading-6">{value}</li>)}</ul>}
    <div className="mt-4 border-t border-black/5 pt-3 text-xs leading-5 text-me-charcoal/55">
      <p>{item.source} · {observed(item.observed_at)}</p>
      <p>{item.coverage}</p>
    </div>
  </article>
}

export function CompetitionBrief({ brief }: { brief: Brief }) {
  const product = brief.dimensions.find(item => item.key === 'product')
  const supporting = brief.dimensions.filter(item => item.key !== 'product')
  return <section className="space-y-4" aria-label="竞争简报">
    <div>
      <p className="text-xs font-bold tracking-wide text-me-charcoal/55">竞争盘面 · {generated(brief.as_of)} NZ</p>
      <h2 className="mt-1 text-xl font-bold">{brief.subject} 竞争盘面</h2>
      <p className="mt-1 text-sm text-me-charcoal/60">先看竞品在卖什么；只有与客户同类{brief.subject}对位后，才能判断价格和产品竞争力。</p>
    </div>
    {product && <DimensionCard item={product} />}
    <details className="rounded-xl border border-black/10 bg-white p-4">
      <summary className="cursor-pointer text-sm font-bold">查看其他判断依据与数据缺口</summary>
      <p className="mt-3 text-sm text-me-charcoal/65">{brief.summary}</p>
      {brief.warnings.length > 0 && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm" role="status"><strong>数据限制</strong><ul className="mt-2 space-y-1">{brief.warnings.map(item => <li key={item}>• {item}</li>)}</ul></div>}
      <div className="mt-3 grid gap-3 lg:grid-cols-3">{supporting.map(item => <DimensionCard key={item.key} item={item} />)}</div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{brief.gaps.map(gap => <div key={gap.label} className="rounded-lg bg-black/[0.03] p-3 text-sm"><strong>{gap.label}</strong><p className="mt-1 text-me-charcoal/60">{gap.reason}</p></div>)}</div>
    </details>
  </section>
}
