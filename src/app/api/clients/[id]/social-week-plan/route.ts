/**
 * Build or read this week's social slot plan. Does not publish.
 */
import { NextResponse } from 'next/server'

import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { targetWeek } from '@/lib/social/week-pack/cadence'
import { readLatestWeeklyPlan } from '@/lib/social/weekly-plan/db'
import { buildAndSaveWeeklyPlan } from '@/lib/social/weekly-plan/run'
import { supabaseAdmin } from '@/lib/supabase'
import { isUuid } from '@/lib/validation-utils'

export const dynamic = 'force-dynamic'

function refused(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

async function allowed(clientId: string) {
  if (!isUuid(clientId)) return refused(400, '这个地址不对。')
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) return refused(access.status, access.status === 401 ? '请先登录。' : '你不能看这位客户的社媒方案。')
  return null
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const deny = await allowed(params.id)
  if (deny) return deny
  const week = targetWeek(new Date())
  const found = await readLatestWeeklyPlan(supabaseAdmin, params.id, week.weekStart)
  if (found === 'unreadable') return refused(500, '方案读不到，没有当成这一周没有方案。')
  return NextResponse.json({ plan: found })
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const deny = await allowed(params.id)
  if (deny) return deny
  try {
    const saved = await buildAndSaveWeeklyPlan(supabaseAdmin, params.id, new Date())
    if (saved === 'error') return refused(500, '方案没有存上。')
    return NextResponse.json({ id: saved.id, saved: saved.saved, plan: saved.plan })
  } catch {
    return refused(500, '方案没有排出来。')
  }
}
