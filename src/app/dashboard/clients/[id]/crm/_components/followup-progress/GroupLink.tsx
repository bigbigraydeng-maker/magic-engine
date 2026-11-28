'use client'

/**
 * The "去处理" link of one group. A page behind the CRM email feature is linked only for people who see that page's
 * item in the CRM top nav (same check, same cache), so nobody is sent to a page their nav hides.
 */

import Link from 'next/link'
import { useTemplatesAccess } from '../useCrmNavAccess'

export function GroupLink({ clientId, page, needsEmailFeature }: { clientId: string; page: string; needsEmailFeature: boolean }): JSX.Element {
  const emailFeature = useTemplatesAccess(clientId)
  if (needsEmailFeature && !emailFeature) return <span className="text-me-charcoal/60">—</span>
  return <Link className="underline" href={`/dashboard/clients/${clientId}/crm/${page}`}>去处理</Link>
}
