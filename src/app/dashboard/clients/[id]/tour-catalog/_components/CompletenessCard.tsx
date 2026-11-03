'use client'

import { useState } from 'react'
import { MANUAL_CONFIRMATIONS, checkTourCompleteness, missingItems } from '@/lib/tour-catalog/completeness'
import type { CatalogTourView } from './types'

export const SOP_HINT = '依据：新团补齐清单 + SEO 检查（docs/sops/2026-10-26-tour-catalog-new-tour-complete-before-publish.md）'

/** Checklist under the tour header: what is still empty before this tour is fit to publish. */
export function CompletenessCard(props: { tour: CatalogTourView; departureCount: number }): JSX.Element {
  const [open, setOpen] = useState(false)
  const items = checkTourCompleteness(props.tour, props.departureCount)
  const missing = missingItems(items)
  const allDone = missing.length === 0
  return (
    <div
      data-testid="completeness-card"
      className={`rounded-lg border p-3 ${allDone ? 'border-[#456F35]/30 bg-[#456F35]/10' : 'border-[#C2453A]/30 bg-[#C2453A]/5'}`}
    >
      <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)} className="flex w-full items-center justify-between text-left">
        <span className={`text-sm font-black ${allDone ? 'text-[#456F35]' : 'text-[#C2453A]'}`}>
          {allDone ? '上架前补齐：机器能查的项目都齐了' : `上架前补齐：还差 ${missing.length} 项（共 ${items.length} 项）`}
        </span>
        <span className="text-xs font-bold text-me-charcoal/55">{open ? '收起' : '展开'}</span>
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          <ul className="space-y-0.5">
            {items.map(i => (
              <li key={i.key} data-ok={i.ok} className={`text-sm font-semibold ${i.ok ? 'text-me-charcoal/55' : 'text-[#C2453A]'}`}>
                {i.ok ? '✓ ' : '✗ '}
                {i.label}
                {i.ok ? '' : ` — ${i.detail}`}
              </li>
            ))}
          </ul>
          <p className="text-sm font-black text-me-charcoal">上架前还要人工确认：</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {MANUAL_CONFIRMATIONS.map(text => (
              <li key={text} className="text-sm font-semibold text-me-charcoal/70">
                {text}
              </li>
            ))}
          </ul>
          <p className="text-xs font-semibold text-me-charcoal/55">{SOP_HINT}</p>
        </div>
      ) : null}
    </div>
  )
}
