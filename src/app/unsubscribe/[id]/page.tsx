/**
 * GET /unsubscribe/[id]
 *
 * Public, customer-facing one-click opt-out landing page (Phase 35). The
 * unsubscribe link in every outreach email points here. No login: the prospect
 * UUID in the URL is the token (same model as /report/[id]).
 *
 * The page only renders the confirm control — the suppression itself is a
 * deliberate POST from UnsubscribeButton, so link-prefetching email scanners
 * can't opt someone out on their behalf. An already-opted-out prospect sees the
 * confirmation state directly (idempotent, reassuring on a second visit).
 *
 * Brand: Magic Engine VI — ivory / gold / charcoal, MeMark logo. noindex:
 * private to one business.
 */

import type { Metadata } from 'next'
import { supabaseAdmin } from '@/lib/supabase'
import { MeMark, MeMarkDefs } from '@/components/ui/me-mark'
import UnsubscribeButton from './_components/UnsubscribeButton'

export const metadata: Metadata = {
  title: 'Unsubscribe — Magic Engine',
  robots: { index: false, follow: false },
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IVORY = '#FBF8F3', CHARCOAL = '#1A1A1A'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4" style={{ background: IVORY, color: CHARCOAL }}>
      <MeMarkDefs />
      <div className="w-full max-w-md rounded-[24px] bg-white p-8 text-center"
           style={{ boxShadow: '0 1px 2px rgba(26,26,26,.04), 0 8px 28px rgba(26,26,26,.06)' }}>
        <div className="mb-6 flex justify-center"><MeMark className="h-7 w-auto" /></div>
        {children}
      </div>
    </main>
  )
}

function InvalidLink() {
  return (
    <Shell>
      <div className="mb-3 text-3xl">🔗</div>
      <h1 className="text-lg font-semibold">This link is no longer valid</h1>
      <p className="mt-2 text-sm" style={{ color: 'rgba(26,26,26,0.55)' }}>
        If you'd like to be taken off our list, just reply to the email and we'll sort it.
      </p>
    </Shell>
  )
}

function AlreadyDone() {
  return (
    <Shell>
      <div className="mb-3 text-3xl">✓</div>
      <h1 className="text-lg font-semibold">You're already unsubscribed</h1>
      <p className="mt-2 text-sm" style={{ color: 'rgba(26,26,26,0.55)' }}>
        You're off our list — you won't hear from us again. Nothing more to do.
      </p>
    </Shell>
  )
}

export default async function UnsubscribePage(
  { params }: { params: { id: string } },
) {
  if (!UUID_RE.test(params.id)) return <InvalidLink />

  const { data: prospect } = await supabaseAdmin
    .from('outbound_prospects')
    .select('business_name, status')
    .eq('id', params.id)
    .maybeSingle<{ business_name: string; status: string }>()

  if (!prospect) return <InvalidLink />
  if (prospect.status === 'opted_out') return <AlreadyDone />

  return (
    <Shell>
      <h1 className="text-lg font-semibold">Unsubscribe {prospect.business_name}?</h1>
      <p className="mt-2 mb-6 text-sm" style={{ color: 'rgba(26,26,26,0.55)' }}>
        We sent you a one-off note after coming across your public Google listing. Click below and
        we'll take you off our list — no more emails from Magic Engine.
      </p>
      <UnsubscribeButton prospectId={params.id} />
    </Shell>
  )
}
