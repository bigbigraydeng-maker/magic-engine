/**
 * Phase X.S5 — Server-side wrapper that gates the page behind paid_client tier.
 * Implementation moved to ./_client.tsx (ExecutionClient).
 */
import { ServerFeatureLock } from '@/components/auth/ServerFeatureLock'
import { ExecutionClient } from './_client'

const SUBTITLE = 'The execution board is where your FDE runs the playbook for you and you sign off on outcomes — not something to drive solo.'

export default function Page() {
  return (
    <ServerFeatureLock feature='Execution' subtitle={SUBTITLE}>
      <ExecutionClient />
    </ServerFeatureLock>
  )
}
