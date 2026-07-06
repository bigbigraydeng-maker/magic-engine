/**
 * GET /api/admin/prospecting/[id]
 *
 * Admin-only. Full detail for one outbound prospect, including the heavy
 * jsonb fields (audit / score_breakdown / ai_report) that the list
 * endpoint deliberately excludes.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  if (!UUID_REGEX.test(params.id)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const { data, error } = await supabaseAdmin
    .from('outbound_prospects')
    .select('*')
    .eq('id', params.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 })

  return NextResponse.json({ prospect: data })
}
