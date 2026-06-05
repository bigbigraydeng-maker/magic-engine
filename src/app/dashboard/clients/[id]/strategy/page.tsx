/**
 * Phase X.S5 — Server-side wrapper that gates the page behind paid_client tier.
 * Implementation moved to ./_client.tsx (StrategyClient).
 */
import { ServerFeatureLock } from '@/components/auth/ServerFeatureLock'
import { StrategyClient } from './_client'

const SUBTITLE = 'Strategy items connect every diagnosis to an experiment with expected lift. We design the experiments together; you decide which ship.'

export default function Page() {
  return (
    <ServerFeatureLock feature='Strategy' subtitle={SUBTITLE}>
      <StrategyClient />
    </ServerFeatureLock>
  )
}
