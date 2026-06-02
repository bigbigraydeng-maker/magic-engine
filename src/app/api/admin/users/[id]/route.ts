/**
 * DELETE /api/admin/users/[id]
 *
 * Admin-only. Removes a client_portal_users entry by primary key.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'

// Render builds Next.js page-data for every route, which evaluates the module
// — guardAdmin() reads cookies via next/headers and throws during build/page-
// data collection. force-dynamic skips that phase so the build succeeds.
// Without this: Render "Failed to collect page data for /api/admin/users/[id]".
export const dynamic = 'force-dynamic'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  const { id } = params
  if (!id) {
    return NextResponse.json({ error: 'id is required.' }, { status: 400 })
  }

  const { error, count } = await supabaseAdmin
    .from('client_portal_users')
    .delete({ count: 'exact' })
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (count === 0) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
