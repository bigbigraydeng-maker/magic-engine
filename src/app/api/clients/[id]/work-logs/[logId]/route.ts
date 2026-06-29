import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireSession } from '@/lib/auth/require-session'

interface Params { params: { id: string; logId: string } }

// DELETE /api/clients/[id]/work-logs/[logId]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await requireSession()
  if (!session.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabaseAdmin
    .from('fde_work_logs')
    .delete()
    .eq('id', params.logId)
    .eq('client_id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}
