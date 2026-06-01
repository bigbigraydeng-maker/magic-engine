'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

interface Props {
  /** Label shown in the banner body explaining which feature is locked */
  featureLabel: string
  children: React.ReactNode
}

/**
 * Wraps a feature area. When the client's Light Brief is incomplete, renders
 * a banner + semi-transparent overlay instead of the children.
 */
export function BriefGateBanner({ featureLabel, children }: Props) {
  const { id } = useParams<{ id: string }>()
  const [complete, setComplete] = useState<boolean | null>(null)

  useEffect(() => {
    fetch(`/api/clients/${id}/light-brief`)
      .then(r => r.json())
      .then(data => setComplete(data.brief_completed_at !== null))
      .catch(() => setComplete(true)) // fail open — don't block on error
  }, [id])

  // loading state — render children transparently to avoid layout shift
  if (complete === null) return <>{children}</>

  if (complete) return <>{children}</>

  return (
    <div className="relative">
      {/* Dimmed children underneath */}
      <div className="pointer-events-none select-none opacity-30 blur-[2px]" aria-hidden>
        {children}
      </div>

      {/* Overlay banner */}
      <div className="absolute inset-0 flex items-start justify-center pt-16">
        <div className="mx-4 w-full max-w-md rounded-xl border border-me-ochre/30 bg-me-ochre/10 p-6 shadow-lg">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-me-ochre">
            Brand Brief required
          </p>
          <h3 className="mt-2 font-display text-lg font-semibold tracking-tight text-me-charcoal">
            Complete your brief to unlock {featureLabel}
          </h3>
          <p className="mt-2 text-sm leading-6 text-me-charcoal/60">
            Without your brand context, generated content will be generic. Takes 2 minutes — unlock the full platform.
          </p>
          <Link
            href={`/dashboard/clients/${id}/brief`}
            className="mt-4 inline-flex h-10 items-center rounded-lg bg-me-ochre px-4 text-sm font-bold text-white hover:bg-me-ochre/90"
          >
            Complete brief →
          </Link>
        </div>
      </div>
    </div>
  )
}
