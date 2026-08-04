'use client'

/**
 * 事实层 + 「还缺什么」+ 来源总览。
 *
 * 「还缺什么」不是备注栏,是**功能性**的一栏:AI 查不到就该往这里写,人看到才
 * 知道下一步去补什么。把它做得显眼,是为了让「不知道」有地方待着 ——
 * 否则「不知道」就会以一个编出来的数字的形式待在上面那些格子里。
 */

import {
  briefSourceKindLabel,
  type BriefSourceKind,
} from '@/lib/listings/brief-constants'
import type { BriefFacts, BriefSourceEntry } from '@/lib/listings/brief-schema'
import { FieldLabel } from './SourceChip'

const INPUT_CLS =
  'w-full rounded-lg border border-black/12 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal focus:border-me-ochre focus:outline-none focus:ring-2 focus:ring-me-ochre/20'

const FACT_FIELDS: Array<{ key: keyof Omit<BriefFacts, 'nearby'>; label: string; placeholder: string }> = [
  { key: 'price_method',      label: '定价方式',   placeholder: '如 议价 / 拍卖 / 标价' },
  { key: 'completion_status', label: '房子状态',   placeholder: '如 已交房 / 在建' },
  { key: 'school_zone',       label: '学区',       placeholder: '写清楚是哪一所' },
  { key: 'vendor_motivation', label: '卖家什么心态', placeholder: '急不急、为什么卖' },
]

export function BriefFactsEditor({
  value,
  sources,
  onChange,
}: {
  value: BriefFacts
  sources: BriefSourceEntry[]
  onChange: (next: BriefFacts) => void
}) {
  return (
    <section className="space-y-3">
      {FACT_FIELDS.map(f => (
        <div key={f.key}>
          <FieldLabel text={f.label} sources={sources} field={`facts.${f.key}`} />
          <input
            value={value[f.key] ?? ''}
            placeholder={f.placeholder}
            onChange={e => onChange({ ...value, [f.key]: e.target.value })}
            className={INPUT_CLS}
          />
        </div>
      ))}
      <div>
        <FieldLabel text="周边有什么（一行一个）" sources={sources} field="facts.nearby" />
        <textarea
          rows={3}
          value={value.nearby.join('\n')}
          placeholder="如 步行 8 分钟到火车站"
          onChange={e =>
            onChange({ ...value, nearby: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })
          }
          className={INPUT_CLS}
        />
      </div>
    </section>
  )
}

export function GapsEditor({
  value,
  onChange,
}: {
  value: string[]
  onChange: (next: string[]) => void
}) {
  return (
    <section>
      <p className="mb-1 text-[11px] font-black uppercase tracking-[.1em] text-me-charcoal/45">
        还缺什么（一行一条）
      </p>
      <textarea
        rows={4}
        value={value.join('\n')}
        placeholder="查不到的东西写在这里，不要在上面填一个估出来的数"
        onChange={e => onChange(e.target.value.split('\n').map(s => s.trim()).filter(Boolean))}
        className={INPUT_CLS}
      />
      <p className="mt-1 text-xs font-semibold text-me-charcoal/40">
        这一栏空着不代表都查到了 —— 也可能是没人认真查过。
      </p>
    </section>
  )
}

const KIND_DOT: Record<BriefSourceKind, string> = {
  cited:    'bg-[#5C8A4A]',
  inferred: 'bg-me-ochre',
  missing:  'bg-me-charcoal/25',
}

/** 来源总览:一眼看出这份档案里有多少是查到的、多少是 AI 猜的。只读。 */
export function SourcesOverview({ sources }: { sources: BriefSourceEntry[] }) {
  if (sources.length === 0) {
    return (
      <p className="text-xs font-semibold text-me-charcoal/40">
        这一版没有来源标记 —— 上面每一栏都当「缺」看待。
      </p>
    )
  }
  const counts = sources.reduce<Record<string, number>>((acc, s) => {
    acc[s.kind] = (acc[s.kind] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3 text-xs font-bold text-me-charcoal/60">
        {(['cited', 'inferred', 'missing'] as const).map(k => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${KIND_DOT[k]}`} />
            {briefSourceKindLabel(k)} {counts[k] ?? 0}
          </span>
        ))}
      </div>
      <ul className="max-h-56 space-y-1 overflow-y-auto text-xs font-semibold text-me-charcoal/60">
        {sources.map((s, i) => (
          <li key={`${s.field}-${i}`} className="flex items-start gap-2">
            <span className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${KIND_DOT[s.kind]}`} />
            <span className="min-w-0">
              <span className="font-black text-me-charcoal/75">{s.field}</span>
              {s.url && (
                <>
                  {' · '}
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="break-all text-[#5C8A4A] hover:underline"
                  >
                    {s.url}
                  </a>
                </>
              )}
              {s.note && <span className="text-me-charcoal/45"> · {s.note}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
