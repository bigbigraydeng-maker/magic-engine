'use client'

/**
 * 三态来源标记 —— 这一页的核心设计(PM 认可的那个)。
 *
 * 每一栏旁边都挂一个小标:
 *   有出处   绿  —— 从房源页 / 某个网页读到的,点得开
 *   AI 判断  黄  —— 模型推的,没有直接出处。**人要重点看这一档**
 *   缺       灰  —— 查不到。这是一个正经结论,不是失败
 *
 * 为什么必须显示而不是只存着:不显示的话,一份档案看上去每一栏都同样确定,
 * 人就会把「AI 猜的」当成「查到的」拿去跟卖家谈。这一排小标就是防这件事的。
 */

import {
  briefSourceKindLabel,
  type BriefSourceKind,
} from '@/lib/listings/brief-constants'
import type { BriefSourceEntry } from '@/lib/listings/brief-schema'

const KIND_CLS: Record<BriefSourceKind, string> = {
  cited:    'bg-[#5C8A4A]/12 text-[#5C8A4A] border-[#5C8A4A]/30',
  inferred: 'bg-me-ochre/15 text-me-ochre border-me-ochre/35',
  missing:  'bg-me-ivory text-me-charcoal/40 border-black/10',
}

/** 没有对应标记时按「缺」显示 —— 没人标过 = 没有出处,不是「大概有吧」。 */
export function findSource(
  sources: BriefSourceEntry[],
  field: string,
): BriefSourceEntry | null {
  return sources.find(s => s.field === field) ?? null
}

export function SourceChip({
  sources,
  field,
}: {
  sources: BriefSourceEntry[]
  field: string
}) {
  const entry = findSource(sources, field)
  const kind: BriefSourceKind = entry?.kind ?? 'missing'
  const label = briefSourceKindLabel(kind)
  const title = entry?.note || (kind === 'missing' ? '这一条没有来源标记' : '')

  const chip = (
    <span
      title={title}
      className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold leading-none ${KIND_CLS[kind]}`}
    >
      {label}
    </span>
  )

  if (kind === 'cited' && entry?.url) {
    return (
      <a
        href={entry.url}
        target="_blank"
        rel="noreferrer noopener"
        className="hover:opacity-75"
        title={entry.url}
      >
        {chip}
      </a>
    )
  }
  return chip
}

/** 一栏的标题 + 三态标,整页反复用到。 */
export function FieldLabel({
  text,
  sources,
  field,
}: {
  text: string
  sources: BriefSourceEntry[]
  field: string
}) {
  return (
    <div className="mb-1 flex items-center gap-2">
      <span className="text-[11px] font-black uppercase tracking-[.1em] text-me-charcoal/45">
        {text}
      </span>
      <SourceChip sources={sources} field={field} />
    </div>
  )
}
