// GET /api/factory/winners?client=<uuid>: 该客户的赢家看板（骨架、表现、复核与确认状态）。只读。

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { loadWinnerBoard } from '@/lib/factory/winner-decision'
import { confirmIsPmOnly, isGlobalAdminByEmail } from '@/lib/factory/winner-gate'

export const dynamic = 'force-dynamic'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request) {
  const client = new URL(req.url).searchParams.get('client')
  if (!client || !UUID_RE.test(client)) {
    return NextResponse.json({ error: 'client must be a uuid' }, { status: 400 })
  }
  const access = await requirePaidClientAccess(client)
  if (!access.ok) return NextResponse.json({ error: access.error, reason: access.reason }, { status: access.status })

  try {
    const [winners, cfg] = await Promise.all([
      loadWinnerBoard(supabaseAdmin, client),
      supabaseAdmin.from('clients').select('factory_config').eq('id', client).maybeSingle(),
    ])
    if (cfg.error) throw new Error(cfg.error.message)
    return NextResponse.json({
      winners,
      pm_only: confirmIsPmOnly(cfg.data?.factory_config ?? null),
      viewer_role: isGlobalAdminByEmail(access.user.email ?? '') ? 'magic_lab' : 'client_staff',
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
