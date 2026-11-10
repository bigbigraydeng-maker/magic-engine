'use client'

import type { ReactNode } from 'react'
import { cx } from '@/components/ui/me-theme'

interface Props {
  title: string
  subtitle?: string
  defaultOpen?: boolean
  children: ReactNode
  className?: string
}

/** 推广计划页底部手风琴区块，样式对齐 ads-health / Me 设计体系。 */
export function PromoCollapsible({ title, subtitle, defaultOpen = false, children, className }: Props) {
  return (
    <details
      open={defaultOpen}
      className={cx(
        'group rounded-[20px] border border-black/10 bg-white shadow-[0_1px_2px_rgba(26,26,26,.04),0_8px_28px_rgba(26,26,26,.06)]',
        className,
      )}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 marker:content-none [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-semibold text-[#1A1A1A]">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-black/50">{subtitle}</p>}
        </div>
        <span
          aria-hidden
          className="shrink-0 text-black/35 transition group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="border-t border-black/[.06] px-5 py-4">{children}</div>
    </details>
  )
}
