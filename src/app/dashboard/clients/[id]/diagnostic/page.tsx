/**
 * Phase X.S5 — Server-side wrapper that gates the page behind paid_client tier.
 * Implementation moved to ./_client.tsx (DiagnosticClient).
 */
import { ServerFeatureLock } from '@/components/auth/ServerFeatureLock'
import { DiagnosticClient } from './_client'

const SUBTITLE = 'The diagnostic surfaces every silent leak across SEO, ads, social, AI visibility and reputation — your FDE reads it with you and turns it into a plan.'

export default function Page() {
  return (
    <ServerFeatureLock feature='Diagnostic' subtitle={SUBTITLE}>
      <DiagnosticClient />
    </ServerFeatureLock>
  )
}
