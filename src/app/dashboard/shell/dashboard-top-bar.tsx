'use client'

import Link from 'next/link'
import { MeMark } from '@/components/ui/me-mark'

export function DashboardTopBar({
  contextLabel,
  userEmail,
}: {
  contextLabel: string
  userEmail: string
}) {
  const initial = (userEmail.trim()[0] ?? 'M').toUpperCase()

  return (
    <header className="sticky top-0 z-20 flex h-[52px] shrink-0 items-center justify-between border-b border-black/10 bg-me-ivory/95 px-4 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/dashboard" className="flex items-center gap-2">
          <MeMark className="h-6 w-7" />
          <span className="font-display text-sm font-bold text-me-charcoal">Magic Engine</span>
        </Link>
        <span className="text-me-charcoal/25" aria-hidden>
          |
        </span>
        <span className="truncate text-sm font-semibold text-me-charcoal/70">{contextLabel}</span>
      </div>
      <div className="flex items-center gap-3">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-full bg-me-charcoal text-xs font-black text-white"
          title={userEmail}
        >
          {initial}
        </span>
        <form action="/auth/signout" method="POST" className="hidden sm:block">
          <button
            type="submit"
            className="rounded-lg border border-black/12 px-2.5 py-1 text-xs font-semibold text-me-charcoal/55 hover:border-black/25 hover:text-me-charcoal"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  )
}
