'use client'

/**
 * 名单顶上那一行：已报价的客人今天有几位在等，点一下只看这批（就是把阶段筛选设成客户自己定的合格阶段）。
 * 数字和阶段都来自服务端（lib/crm/qualified-summary.ts）；这里不改名单顺序，不动任何人。
 */

export interface QualifiedEntryData {
  stageKeys: string[]
  waiting: number
  moved: number
  quiet: number
}

export function sameStages(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((k) => b.includes(k))
}

export function qualifiedParts(q: QualifiedEntryData): string[] {
  const parts: string[] = []
  if (q.waiting > 0) parts.push(`${q.waiting} 位说了话或到了回电时间，还没人回`)
  if (q.moved > 0) parts.push(`${q.moved} 位点了我们的邮件或在看官网，还没人跟`)
  if (q.quiet > 0) parts.push(`${q.quiet} 位聊过之后没了下文`)
  return parts
}

export function QualifiedEntry({ data, stageFilter, onStageFilterChange }: {
  data: QualifiedEntryData | null
  stageFilter: string[]
  onStageFilterChange: (next: string[]) => void
}) {
  if (data === null) return null
  const active = sameStages(stageFilter, data.stageKeys)
  if (active) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-me-charcoal/15 bg-me-ivory px-4 py-3 text-sm text-me-charcoal">
        <span className="font-semibold">正在只看已报价的客人。</span>
        <span className="text-me-charcoal/70">名单现在只剩已报价及以后阶段的客人，「今天要联系」里的先打。</span>
        <button type="button" onClick={() => onStageFilterChange([])} className="ml-auto rounded-lg border border-me-charcoal/30 px-3 py-1.5 text-sm font-semibold">
          看回全部客人
        </button>
      </div>
    )
  }
  const parts = qualifiedParts(data)
  if (parts.length === 0 || stageFilter.length > 0) return null
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-me-charcoal/15 bg-me-ivory px-4 py-3 text-sm text-me-charcoal">
      <span><span className="font-semibold">已报价的客人：</span>{parts.join('；')}。</span>
      <button type="button" onClick={() => onStageFilterChange(data.stageKeys)} className="ml-auto rounded-lg bg-me-charcoal px-3 py-1.5 text-sm font-semibold text-white">
        只看这批
      </button>
    </div>
  )
}
