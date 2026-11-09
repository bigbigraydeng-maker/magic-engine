'use client'

import { REVIEW_OUTLETS } from '@/lib/factory/outlets'

export function PublishOutlets() {
  return (
    <details className="mt-2 text-xs text-slate-500">
      <summary className="cursor-pointer select-none">通过后会去哪里?</summary>
      <ul className="mt-1 space-y-1">
        {REVIEW_OUTLETS.map((outlet) => (
          <li
            key={outlet.key}
            className={outlet.connected ? undefined : 'text-slate-400'}
          >
            <span
              className={`mr-1 inline-block h-2 w-2 rounded-full ${
                outlet.connected ? 'bg-emerald-500' : 'bg-slate-300'
              }`}
              aria-hidden="true"
            />
            <span className="font-medium">{outlet.label}</span>
            <span> {outlet.note}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}
