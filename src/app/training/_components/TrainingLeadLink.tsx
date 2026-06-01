'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

type TrainingLeadClick = {
  ctaKey: string
  destination: 'contact' | 'email'
  href: string
  pagePath: '/training'
}

type TrainingLeadLinkProps = {
  href: string
  children: ReactNode
  className: string
  ctaKey: string
  destination: 'contact' | 'email'
}

function trackTrainingLead(payload: TrainingLeadClick) {
  const body = JSON.stringify({
    ...payload,
    referrer: typeof document !== 'undefined' ? document.referrer || null : null,
  })

  if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
    const blob = new Blob([body], { type: 'application/json' })
    navigator.sendBeacon('/api/training/leads', blob)
    return
  }

  void fetch('/api/training/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => undefined)
}

export default function TrainingLeadLink({
  href,
  children,
  className,
  ctaKey,
  destination,
}: TrainingLeadLinkProps) {
  const handleClick = () => {
    trackTrainingLead({
      ctaKey,
      destination,
      href,
      pagePath: '/training',
    })
  }

  if (href.startsWith('mailto:')) {
    return (
      <a href={href} className={className} onClick={handleClick}>
        {children}
      </a>
    )
  }

  return (
    <Link href={href} className={className} onClick={handleClick}>
      {children}
    </Link>
  )
}
