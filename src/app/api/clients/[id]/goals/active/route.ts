/**
 * GET /api/clients/[id]/goals/active — current active goal (or null)
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getActiveGoal } from '@/lib/strategy/goals'

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const goal = await getActiveGoal(supabaseAdmin, params.id)
  return NextResponse.json({ goal })
}
