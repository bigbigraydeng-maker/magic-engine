/**
 * GET /connect/[clientId]
 *
 * Public customer-facing page (no login). A client is sent this link to
 * authorise Magic Engine to read their Google Search Console data. The page
 * resolves the client by id, shows current connection status, and hands off
 * to the OAuth flow with flow=connect so the callback returns here.
 */

import type { Metadata } from 'next'
import { supabaseAdmin } from '@/lib/supabase'
import ConnectScreen from './connect-screen'

export const metadata: Metadata = {
  title: 'Connect Google Search Console — Magic Engine',
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type OAuthStatus = 'success' | 'denied' | 'error' | null

function toOAuthStatus(raw: string | undefined): OAuthStatus {
  if (raw === 'success' || raw === 'denied' || raw === 'error') return raw
  return null
}

interface Props {
  params: { clientId: string }
  searchParams: { oauth?: string }
}

function InvalidLink() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="mb-3 text-3xl">🔗</div>
        <h1 className="text-lg font-semibold text-gray-900">
          This link is no longer valid
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Please ask your Magic Engine contact to send you a fresh connection
          link.
        </p>
      </div>
    </main>
  )
}

export default async function ConnectPage({ params, searchParams }: Props) {
  const { clientId } = params

  if (!UUID_RE.test(clientId)) return <InvalidLink />

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id, name')
    .eq('id', clientId)
    .maybeSingle<{ id: string; name: string }>()

  if (!client) return <InvalidLink />

  const { data: tokenRow } = await supabaseAdmin
    .from('google_oauth_tokens')
    .select('google_email')
    .eq('client_id', clientId)
    .maybeSingle<{ google_email: string | null }>()

  return (
    <ConnectScreen
      clientId={clientId}
      clientName={client.name}
      connectedEmail={tokenRow?.google_email ?? null}
      oauthStatus={toOAuthStatus(searchParams.oauth)}
    />
  )
}
