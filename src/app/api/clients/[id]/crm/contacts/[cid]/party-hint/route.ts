/**
 * GET /api/clients/[id]/crm/contacts/[cid]/party-hint
 *
 * Headcount already stored on this guest's summary, mail, or call notes.
 * Staff can still type a different number. This route does not write.
 */

import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { readPartyHint } from '@/lib/conversions/crm-deal-party-read'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: { id: string; cid: string } },
): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const hint = await readPartyHint(supabaseAdmin, params.id, params.cid)
  return NextResponse.json({ size: hint?.size ?? null, source: hint?.source ?? null })
}
