'use client'

import Link from 'next/link'
import { MeMark } from '@/components/ui/me-mark'

export function DashboardTopBar({ contextLabel, userEmail }: { contextLabel: string; userEmail: string }) {
  const initial = (userEmail.trim()[0] ?? 'M').toUpperCase()
  return (
    <header className="sticky top-0 z-20 flex h-[52px] shrink-0 items-center justify-between border-b border-black/10 bg-me-ivory/95 px-4 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/dashboard" className="flex items-center gap-2">
          <MeMark className="h-6 w-7" />
          <span className="font-display text-sm font-bold text-me-charcoal">Magic Engine</span>
        </Link>
        <span className="text-me-charcoal/25">|</span>
        <span className="truncate text-sm font-semibold text-me-charcoal/70">{contextLabel}</span>
      </div>
      <p className="flex h-8 w-8 items-center justify-center rounded-full bg-me-charcoal text-xs font-black text-white" title={userEmail}>{initial}</p>
    </header>
  )
}
