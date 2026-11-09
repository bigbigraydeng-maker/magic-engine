'use client'

/** 「状态都是什么意思」：页面上会出现的每一种状态标签，各用一句大白话讲清楚。 */

import { MePill } from '@/components/ui/me-primitives'
import { STATUS_LEGEND } from '@/lib/crm/auto-send/status'
import { DASHED_PILL, Panel } from './ui'

export function StatusLegend(): JSX.Element {
  return (
    <Panel title="状态都是什么意思" testId="auto-send-legend">
      <ul className="space-y-1.5">
        {STATUS_LEGEND.map((row) => (
          <li key={row.label} className="flex items-start gap-3">
            <span className="w-24 shrink-0">
              <MePill tone={row.tone} className={row.dashed ? DASHED_PILL : ''}>
                {row.label}
              </MePill>
            </span>
            <span className="min-w-0 pt-1 text-xs text-me-charcoal/70">{row.text}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
