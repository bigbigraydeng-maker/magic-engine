/**
 * Retired (刀 20, Ray 2026-10-27).
 * Monday six-dimension scoring no longer runs. The dispatcher does not call
 * this route. A direct hit returns 410 and does not collect or write scores.
 */

import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const RETIRED = {
  retired: true,
  error: '华佗六维体检诊断已废弃，每周一自动诊断不再运行。',
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json(RETIRED, { status: 410 })
}
