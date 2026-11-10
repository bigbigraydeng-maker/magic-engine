'use client'

import React, { useState } from 'react'

function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <details
      className="group rounded-xl border border-me-stone bg-white shadow-card open:pb-4"
      open={open}
      onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer list-none px-5 py-4 font-medium text-me-charcoal marker:content-none">
        <span className="flex items-center justify-between gap-3">
          {title}
          <span className="text-me-charcoal/35 group-open:rotate-180 transition-transform" aria-hidden>⌄</span>
        </span>
      </summary>
      <div className="border-t border-me-stone/80 px-5 pt-4">{children}</div>
    </details>
  )
}

export function AdsHealthAccordions({ sections }: { sections: Array<{ title: string; body: React.ReactNode; defaultOpen?: boolean }> }) {
  return (
    <div className="space-y-3">
      {sections.map(s => (
        <Section key={s.title} title={s.title} defaultOpen={s.defaultOpen}>
          {s.body}
        </Section>
      ))}
    </div>
  )
}
