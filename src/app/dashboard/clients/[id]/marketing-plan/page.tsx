/**
 * Phase X.S5 — Server-side wrapper that gates the page behind paid_client tier.
 * Implementation moved to ./_client.tsx (MarketingPlanClient).
 */
import { ServerFeatureLock } from '@/components/auth/ServerFeatureLock'
import { MarketingPlanClient } from './_client'

const SUBTITLE = 'Marketing plans connect strategy to delivery — we configure the engine and your FDE keeps it tuned.'

export default function Page() {
  return (
    <ServerFeatureLock feature='Marketing Plan' subtitle={SUBTITLE}>
      <MarketingPlanClient />
    </ServerFeatureLock>
  )
}
