'use client'

import type { ReactNode } from 'react'
import { scanPlaceholders } from '@/lib/crm/email-templates/placeholders'
import { variableLabel } from '@/lib/crm/email-templates/placeholders'
import { MeChip } from '@/components/ui/me-primitives'

export function TemplateBodyChips(props: { text: string; showRawUnknown?: boolean }): JSX.Element {
  const { text, showRawUnknown = true } = props
  const refs = scanPlaceholders(text)
  if (refs.length === 0) {
    return <span className="whitespace-pre-wrap text-sm text-me-charcoal">{text}</span>
  }
  const parts: ReactNode[] = []
  let cursor = 0
  refs.forEach((ref, index) => {
    if (ref.start > cursor) {
      parts.push(
        <span key={`t-${index}-pre`} className="whitespace-pre-wrap">
          {text.slice(cursor, ref.start)}
        </span>,
      )
    }
    const label = variableLabel(ref.name)
    const unknown = label === ref.name
    parts.push(
      <MeChip key={`v-${index}`} gold={!unknown}>
        {showRawUnknown && unknown ? ref.raw : label}
        {ref.count !== null ? ` · 前 ${ref.count} 条` : ''}
      </MeChip>,
    )
    cursor = ref.end
  })
  if (cursor < text.length) {
    parts.push(
      <span key="tail" className="whitespace-pre-wrap">
        {text.slice(cursor)}
      </span>,
    )
  }
  return <div className="flex flex-wrap items-baseline gap-1 text-sm text-me-charcoal">{parts}</div>
}
