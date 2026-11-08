/**
 * GET /api/clients/[id]/reel-readback — the client's reels that went public through the social agent, with their 72-hour numbers
 * (likes, comments, shares) and the same "more / less" suggestion the Monday to-do uses. Read-only; global admins only.
 */
import { NextResponse } from 'next/server'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { supabaseAdmin } from '@/lib/supabase'
import { isUuid } from '@/lib/validation-utils'
import { loadReelReadback } from '@/lib/social/reel-readback/load'
import { buildSuggestion } from '@/lib/social/reel-readback/suggest'

export const dynamic = 'force-dynamic'

const LOOKBACK_DAYS = 60
const refused = (status: number, error: string) => NextResponse.json({ success: false, error }, { status })

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return refused(400, '这个地址不对。')
  const admin = await requireGlobalAdmin()
  if (!admin.ok) return refused(admin.status, admin.error)
  try {
    const now = new Date()
    const { items, unmatched } = await loadReelReadback(supabaseAdmin, { clientId: params.id, since: new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000), now })
    return NextResponse.json({ success: true, items, unmatched, suggestion: buildSuggestion(items) })
  } catch {
    return refused(500, '成绩没读出来，不要当成没有数据。')
  }
}
