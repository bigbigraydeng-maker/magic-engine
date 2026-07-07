import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { buildLeadFormSnippet } from '@/lib/leads/form-snippet'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

/**
 * GET /api/clients/[id]/lead-form/snippet
 *
 * Returns a self-contained enquiry-form snippet the FDE hands to the client to
 * paste on their own website. The form POSTs to the existing public
 * /api/clients/[id]/leads endpoint (CORS-locked to the client's domain), so no
 * new endpoint or migration is needed — this is Phase B tooling around what
 * already ships. Behind paid-client access, same as the GEO snippet route.
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('name')
    .eq('id', params.id)
    .maybeSingle<{ name: string | null }>()

  // The form is embedded on the client's site but POSTs back to the ME app,
  // whose leads endpoint allows the client's own domain as the CORS origin.
  const apiBase = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.magicengine.com.au'

  const snippet = buildLeadFormSnippet({
    clientId:     params.id,
    apiBase,
    businessName: client?.name ?? undefined,
    accent:       '#C4912E',
  })

  return NextResponse.json({ success: true, ...snippet })
}
