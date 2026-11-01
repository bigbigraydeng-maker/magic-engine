'use client'

import { useState } from 'react'
import { GoLiveCardPanel } from '@/components/go-live-card/GoLiveCardPanel'
import { LandingVerifyPanel } from './LandingVerifyPanel'

export function BeforeGoLive({ clientId, draftId }: { clientId: string; draftId: string }) {
  const [phase, setPhase] = useState(0)
  return (
    <>
      <LandingVerifyPanel
        clientId={clientId}
        draftId={draftId}
        onSettled={() => setPhase((current) => (current === 0 ? 1 : current))}
        onChanged={() => setPhase((current) => current + 1)}
      />
      {phase > 0 ? (
        <GoLiveCardPanel key={phase} clientId={clientId} draftId={draftId} />
      ) : (
        <p className="mt-4 text-base text-neutral-700">落地页核实完成之前，这里不显示开投。</p>
      )}
    </>
  )
}
