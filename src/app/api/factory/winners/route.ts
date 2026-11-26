// GET /api/factory/winners?client=<uuid>: 该客户的赢家看板（骨架、表现、复核与确认状态）。只读。

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { loadWinnerBoard } from '@/lib/factory/winner-decision'
import { isGlobalAdminByEmail, loadPmOnly } from '@/lib/factory/winner-gate'

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
    const [winners, pm] = await Promise.all([loadWinnerBoard(supabaseAdmin, client), loadPmOnly(supabaseAdmin, client)])
    return NextResponse.json({
      winners,
      pm_only: pm.pmOnly,
      // 「只认 PM」已经生效（赢家行有标记），但客户配置里的开关没写上 → 界面标红，待办里出开发欠账
      pm_only_unsynced: pm.pmOnly && !pm.configFlag,
      viewer_role: isGlobalAdminByEmail(access.user.email ?? '') ? 'magic_lab' : 'client_staff',
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
