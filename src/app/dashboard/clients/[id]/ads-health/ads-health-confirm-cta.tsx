'use client'

import React from 'react'
import { MeButton } from '@/components/ui/me-primitives'

export function AdsHealthConfirmCta({ count }: { count: number }) {
  if (count < 1) return null
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-me-gold/50 bg-me-gold/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm font-medium text-me-charcoal">
        现在请您：看 {count} 张确认卡
      </p>
      <MeButton
        type="button"
        variant="primary"
        size="sm"
        className="shrink-0"
        onClick={() => {
          document.getElementById('confirmation-cards')?.scrollIntoView({ behavior: 'smooth' })
        }}
      >
        去看确认卡 ↓
      </MeButton>
    </div>
  )
}
