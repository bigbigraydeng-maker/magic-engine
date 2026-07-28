'use client'

import type { ReviewItem } from '@/lib/tailor-made/extract'

/**
 * 人工校对清单 —— AI 抽取之后唯一必须由人过一遍的地方。
 *
 * 只列三类：原文没写的关键信息、AI 的推断、原文自相矛盾之处。
 * 照抄无误的字段不进来 —— 清单一长顾问就不看了，那就等于没有校对。
 */

const KIND_STYLE: Record<ReviewItem['kind'], { label: string; cls: string }> = {
  missing: { label: '缺失', cls: 'bg-[#C2453A]/12 text-[#C2453A] border-[#C2453A]/25' },
  inferred: { label: 'AI 推断', cls: 'bg-me-ochre/15 text-me-ochre border-me-ochre/30' },
  ambiguous: { label: '原文矛盾', cls: 'bg-me-gold/25 text-me-ochre border-me-ochre/25' },
}

/** 字段路径 → 校对面板里的锚点 */
export function sectionIdForPath(path: string): string {
  if (path.startsWith('days')) return 'tm-days'
  if (path.startsWith('pricing')) return 'tm-pricing'
  if (path.startsWith('trip')) return 'tm-trip'
  if (path.startsWith('client') || path.startsWith('meta')) return 'tm-client'
  return 'tm-terms'
}

export default function ReviewPanel({
  items,
  onJump,
  onDismiss,
}: {
  items: ReviewItem[]
  onJump: (path: string) => void
  onDismiss: (index: number) => void
}) {
  if (items.length === 0) return null

  const missing = items.filter(i => i.kind === 'missing').length

  return (
    <section className="rounded-xl border border-me-ochre/30 bg-me-ochre/[.06] p-5">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-sm font-black text-me-charcoal">待确认 {items.length} 项</h2>
        {missing > 0 && (
          <span className="rounded-full border border-[#C2453A]/25 bg-[#C2453A]/12 px-2 py-0.5 text-[10px] font-bold text-[#C2453A]">
            其中 {missing} 项原文没写
          </span>
        )}
      </div>
      <p className="mb-3 text-[11px] text-me-charcoal/50">
        发给客户前请逐条过一遍。确认无误后点「已确认」划掉。
      </p>

      <ul className="space-y-2">
        {items.map((item, i) => {
          const k = KIND_STYLE[item.kind] ?? KIND_STYLE.inferred
          return (
            <li key={`${item.path}-${i}`} className="flex items-start gap-3 rounded-lg bg-white p-3">
              <span className={`mt-0.5 flex-none rounded-full border px-1.5 py-0.5 text-[10px] font-bold leading-none ${k.cls}`}>
                {k.label}
              </span>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onJump(item.path)}
                  className="block text-left text-[13px] font-bold text-me-charcoal hover:text-me-ochre"
                >
                  {item.label} <span className="font-normal text-me-charcoal/30">↗</span>
                </button>
                <p className="mt-0.5 text-[11px] leading-relaxed text-me-charcoal/55">{item.note}</p>
              </div>
              <button
                type="button"
                onClick={() => onDismiss(i)}
                className="flex-none rounded-md border border-black/10 px-2 py-1 text-[11px] font-medium text-me-charcoal/50 hover:bg-black/[.03]"
              >
                已确认
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
