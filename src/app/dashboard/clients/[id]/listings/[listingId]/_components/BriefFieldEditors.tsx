'use client'

/**
 * 档案各栏的编辑器。拆出来只是为了别让主面板变成一个 600 行的组件 ——
 * 这些块之间没有共享状态,值和 onChange 全部由 ListingBriefClient 往下传。
 *
 * 一条贯穿的规矩:**下拉 / 勾选的取值一律来自 lib/listings/brief-constants**,
 * 这里不手写任何字符串字面量。前端能选、后端不认,是最难查的一类 bug。
 */

import {
  BUYER_SEGMENT_OPTIONS,
  LISTING_ANGLE_OPTIONS,
  LISTING_HESITATION_OPTIONS,
  listingAngleLabel,
  type BuyerSegment,
} from '@/lib/listings/brief-constants'
import type {
  AngleRankingItem,
  BriefSourceEntry,
  MarketSnapshot,
  SourcedNumber,
  UnitVariant,
} from '@/lib/listings/brief-schema'
import { FieldLabel } from './SourceChip'

const INPUT_CLS =
  'w-full rounded-lg border border-black/12 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal focus:border-me-ochre focus:outline-none focus:ring-2 focus:ring-me-ochre/20'

// ── 多选 chip 组(买家类型 / 犹豫点共用)───────────────────────────────────────

export function ChipMultiSelect({
  options,
  selected,
  onToggle,
}: {
  options: ReadonlyArray<{ value: string; label: string }>
  selected: readonly string[]
  onToggle: (value: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => {
        const on = selected.includes(opt.value)
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onToggle(opt.value)}
            className={
              on
                ? 'rounded-full border border-me-charcoal bg-me-charcoal px-3 py-1 text-xs font-black text-white'
                : 'rounded-full border border-black/12 bg-white px-3 py-1 text-xs font-bold text-me-charcoal/60 hover:border-me-ochre hover:text-me-ochre'
            }
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export function BuyerSegmentsEditor({
  value,
  sources,
  onChange,
}: {
  value: string[]
  sources: BriefSourceEntry[]
  onChange: (next: string[]) => void
}) {
  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v])
  return (
    <section>
      <FieldLabel text="谁会买这套房" sources={sources} field="buyer_segments" />
      <ChipMultiSelect options={BUYER_SEGMENT_OPTIONS} selected={value} onToggle={toggle} />
    </section>
  )
}

export function HesitationsEditor({
  value,
  sources,
  onChange,
}: {
  value: string[]
  sources: BriefSourceEntry[]
  onChange: (next: string[]) => void
}) {
  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v])
  return (
    <section>
      <FieldLabel text="买家会犹豫什么" sources={sources} field="hesitations" />
      <ChipMultiSelect options={LISTING_HESITATION_OPTIONS} selected={value} onToggle={toggle} />
      <p className="mt-2 text-xs font-semibold text-me-charcoal/40">
        广告文案就是逐条回应这些犹豫。挑错了,文案就在答不相干的问题。
      </p>
    </section>
  )
}

// ── 卖点排序 ──────────────────────────────────────────────────────────────────

/** rank 一律按当前顺序重排 —— 别让人手填数字,填出重复和空档的必然是人。 */
function renumber(items: AngleRankingItem[]): AngleRankingItem[] {
  return items.map((it, i) => ({ ...it, rank: i + 1 }))
}

export function AngleRankingEditor({
  value,
  sources,
  onChange,
}: {
  value: AngleRankingItem[]
  sources: BriefSourceEntry[]
  onChange: (next: AngleRankingItem[]) => void
}) {
  const used = new Set(value.map(v => v.angle))
  const available = LISTING_ANGLE_OPTIONS.filter(o => !used.has(o.value))

  const move = (idx: number, delta: number) => {
    const next = [...value]
    const to = idx + delta
    if (to < 0 || to >= next.length) return
    ;[next[idx], next[to]] = [next[to], next[idx]]
    onChange(renumber(next))
  }

  return (
    <section>
      <FieldLabel text="卖点排序（第 1 条就是主打）" sources={sources} field="angle_ranking" />
      <div className="space-y-2">
        {value.map((item, idx) => (
          <div key={item.angle} className="rounded-lg border border-black/10 bg-white p-3">
            <div className="flex items-center gap-2">
              <span className="rounded bg-me-charcoal px-2 py-0.5 text-[11px] font-black text-white">
                {item.rank}
              </span>
              <span className="font-black text-me-charcoal">{listingAngleLabel(item.angle)}</span>
              <div className="ml-auto flex gap-1 text-xs font-black text-me-charcoal/45">
                <button type="button" onClick={() => move(idx, -1)} className="px-1 hover:text-me-ochre">↑</button>
                <button type="button" onClick={() => move(idx, 1)} className="px-1 hover:text-me-ochre">↓</button>
                <button
                  type="button"
                  onClick={() => onChange(renumber(value.filter((_, i) => i !== idx)))}
                  className="px-1 hover:text-[#C2453A]"
                >
                  移除
                </button>
              </div>
            </div>
            <textarea
              rows={2}
              value={item.rationale ?? ''}
              placeholder="为什么排在这个位置"
              onChange={e =>
                onChange(value.map((v, i) => (i === idx ? { ...v, rationale: e.target.value } : v)))
              }
              className={`${INPUT_CLS} mt-2`}
            />
          </div>
        ))}
        {value.length === 0 && (
          <p className="text-xs font-semibold text-me-charcoal/40">还没有卖点。从下面加。</p>
        )}
      </div>

      {available.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {available.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() =>
                onChange(renumber([...value, { angle: o.value, rank: value.length + 1, rationale: null }]))
              }
              className="rounded-full border border-dashed border-black/15 px-3 py-1 text-xs font-bold text-me-charcoal/50 hover:border-me-ochre hover:text-me-ochre"
            >
              + {o.label}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

// ── 户型 ──────────────────────────────────────────────────────────────────────

export function UnitVariantsEditor({
  value,
  sources,
  onChange,
}: {
  value: UnitVariant[]
  sources: BriefSourceEntry[]
  onChange: (next: UnitVariant[]) => void
}) {
  const patch = (idx: number, part: Partial<UnitVariant>) =>
    onChange(value.map((v, i) => (i === idx ? { ...v, ...part } : v)))

  return (
    <section>
      <FieldLabel text="户型（同一个项目分开打）" sources={sources} field="unit_variants" />
      <div className="space-y-2">
        {value.map((v, idx) => (
          <div key={idx} className="rounded-lg border border-black/10 bg-white p-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <input
                value={v.label}
                placeholder="名称，如 5 号"
                onChange={e => patch(idx, { label: e.target.value })}
                className={INPUT_CLS}
              />
              <input
                value={v.size_sqm ?? ''}
                placeholder="面积 m²"
                inputMode="decimal"
                onChange={e =>
                  patch(idx, { size_sqm: e.target.value === '' ? null : Number(e.target.value) })
                }
                className={INPUT_CLS}
              />
              <input
                value={v.config ?? ''}
                placeholder="配置，如 3 房 + 书房"
                onChange={e => patch(idx, { config: e.target.value })}
                className={INPUT_CLS}
              />
            </div>
            <div className="mt-2">
              <ChipMultiSelect
                options={BUYER_SEGMENT_OPTIONS}
                selected={v.target_segments}
                onToggle={seg =>
                  patch(idx, {
                    target_segments: v.target_segments.includes(seg as BuyerSegment)
                      ? v.target_segments.filter(s => s !== seg)
                      : [...v.target_segments, seg as BuyerSegment],
                  })
                }
              />
            </div>
            <button
              type="button"
              onClick={() => onChange(value.filter((_, i) => i !== idx))}
              className="mt-2 text-xs font-black text-me-charcoal/40 hover:text-[#C2453A]"
            >
              移除这个户型
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...value, { label: '', size_sqm: null, config: null, target_segments: [] }])}
        className="mt-2 rounded-full border border-dashed border-black/15 px-3 py-1 text-xs font-bold text-me-charcoal/50 hover:border-me-ochre hover:text-me-ochre"
      >
        + 加一个户型
      </button>
    </section>
  )
}

// ── 市场快照(数字必须配出处)──────────────────────────────────────────────────

const METRIC_META: Array<{ key: keyof Omit<MarketSnapshot, 'comparables'>; label: string }> = [
  { key: 'median_price',   label: '中位成交价' },
  { key: 'yoy_change_pct', label: '同比涨跌 %' },
  { key: 'rental_yield',   label: '这套房的租金回报 %' },
  { key: 'area_avg_yield', label: '这个区平均回报 %' },
]

function MetricRow({
  label,
  field,
  sources,
  value,
  onChange,
}: {
  label: string
  field: string
  sources: BriefSourceEntry[]
  value: SourcedNumber | null
  onChange: (next: SourcedNumber | null) => void
}) {
  const num = value?.value ?? ''
  const src = value?.source ?? ''
  const update = (nextNum: string, nextSrc: string) => {
    if (nextNum === '' ) return onChange(null)
    onChange({ value: Number(nextNum), source: nextSrc })
  }
  return (
    <div className="rounded-lg border border-black/10 bg-white p-3">
      <FieldLabel text={label} sources={sources} field={field} />
      <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
        <input
          value={num}
          inputMode="decimal"
          placeholder="查不到就空着"
          onChange={e => update(e.target.value, src)}
          className={INPUT_CLS}
        />
        <input
          value={src}
          placeholder="这个数哪来的（网址）"
          onChange={e => update(String(num), e.target.value)}
          className={INPUT_CLS}
        />
      </div>
      {num !== '' && src.trim() === '' && (
        <p className="mt-1 text-xs font-bold text-[#C2453A]">
          填了数就必须填出处。查不到请把数清空，写进下面的「还缺什么」。
        </p>
      )}
    </div>
  )
}

export function MarketSnapshotEditor({
  value,
  sources,
  onChange,
}: {
  value: MarketSnapshot
  sources: BriefSourceEntry[]
  onChange: (next: MarketSnapshot) => void
}) {
  return (
    <section className="space-y-2">
      <p className="text-[11px] font-black uppercase tracking-[.1em] text-me-charcoal/45">市场行情</p>
      {METRIC_META.map(m => (
        <MetricRow
          key={m.key}
          label={m.label}
          field={`market_snapshot.${m.key}`}
          sources={sources}
          value={value[m.key]}
          onChange={next => onChange({ ...value, [m.key]: next })}
        />
      ))}
      {value.comparables.length > 0 && (
        <div className="rounded-lg border border-black/10 bg-white p-3">
          <p className="mb-2 text-[11px] font-black uppercase tracking-[.1em] text-me-charcoal/45">
            可比成交
          </p>
          <ul className="space-y-1 text-sm font-semibold text-me-charcoal/70">
            {value.comparables.map((c, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="font-black text-me-charcoal">{c.address}</span>
                {c.price != null && <span>{c.price.toLocaleString()}</span>}
                {c.sold_on && <span className="text-me-charcoal/45">{c.sold_on}</span>}
                <a
                  href={c.source}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-xs font-black text-[#5C8A4A] hover:underline"
                >
                  出处
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
