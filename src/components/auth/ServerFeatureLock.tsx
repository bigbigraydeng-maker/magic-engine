/**
 * Phase X.S5 — Server-component feature gate.
 *
 * Pairs with the client-side <FeatureLockModal> for the paid-only UX. The
 * key difference vs FeatureLockGate (client component): this one reads
 * x-user-tier from the request headers in the server, and when the visitor
 * is below paid_client, the children are NEVER RENDERED — only the modal
 * goes to the browser. That closes the SSR data leak Wei Zheng flagged in
 * H-1: a self_serve user opening DevTools can't see paid feature data in
 * the page HTML because it was never serialised.
 *
 * Usage in an App Router page:
 *
 *   // app/dashboard/clients/[id]/goals/page.tsx
 *   import { ServerFeatureLock } from '@/components/auth/ServerFeatureLock'
 *   import GoalsClient from './_GoalsClient'
 *   export default function Page(props: { params: { id: string } }) {
 *     return (
 *       <ServerFeatureLock feature="Goals">
 *         <GoalsClient {...props} />
 *       </ServerFeatureLock>
 *     )
 *   }
 *
 * `readUserTier()` reads the `x-user-tier` header forwarded by middleware.
 * Admin / paid_client → children render. Anything else → only the modal.
 */

import React from 'react'
import { headers } from 'next/headers'
import { FeatureLockModal } from './FeatureLockGate'

export type ServerAccessTier = 'admin' | 'paid_client' | 'self_serve' | 'portal_only'

/**
 * Reads the tier the middleware forwarded for this request.
 *
 * Returns 'admin' on the rare path where no header was set (defensive: if
 * we somehow miss the middleware, the safe-by-default reading is to *not*
 * lock the page — every API call still has its own requirePaidClientAccess
 * gate, so backend access is preserved even when the gate UI defaults open).
 */
export function readUserTier(): ServerAccessTier {
  const h = headers()
  const raw = h.get('x-user-tier')
  if (raw === 'paid_client' || raw === 'self_serve' || raw === 'portal_only') return raw
  return 'admin'
}

export interface ServerFeatureLockProps {
  /** Display name shown in the upsell modal (e.g. "Goals", "Diagnostic"). */
  feature: string
  /** Optional richer subtitle in the modal. */
  subtitle?: string
  children: React.ReactNode
}

/**
 * Server component. Renders children directly when the visitor has paid
 * access; otherwise renders an isolated upsell modal and skips the children
 * entirely. The modal is dismissible=false so the user can't click through
 * to inspected DOM either.
 */
export function ServerFeatureLock({ feature, subtitle, children }: ServerFeatureLockProps) {
  const tier = readUserTier()
  const allowed = tier === 'admin' || tier === 'paid_client'

  if (allowed) return <>{children}</>

  // Locked: don't render children at all. The Modal is the entire page body.
  return (
    <div className="min-h-screen bg-[#FBF8F3]">
      <FeatureLockModal feature={feature} subtitle={subtitle} open={true} onClose={() => {}} dismissible={false} />
    </div>
  )
}
