import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import {
  buildWebsiteGrowthPlan,
  queueWebsiteGrowthPlan,
} from '@/lib/website-agent/service'

export const maxDuration = 60

interface RouteContext {
  params: { id: string }
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json(
      { success: false, error: access.error, reason: access.reason },
      { status: access.status },
    )
  }

  const maxActions = parseMaxActions(new URL(request.url).searchParams.get('max_actions'))
  if (maxActions === null) {
    return NextResponse.json(
      { success: false, error: 'max_actions must be an integer from 1 to 5' },
      { status: 400 },
    )
  }

  try {
    const plan = await buildWebsiteGrowthPlan(supabaseAdmin, params.id, maxActions)
    return NextResponse.json({ success: true, plan })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to build website plan'
    const status = message === 'Client not found' ? 404 : 500
    return NextResponse.json({ success: false, error: message }, { status })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json(
      { success: false, error: access.error, reason: access.reason },
      { status: access.status },
    )
  }

  let body: { max_actions?: unknown; confirm_queue?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  if (body.confirm_queue !== true) {
    return NextResponse.json(
      { success: false, error: 'confirm_queue=true is required; use GET for proposal-only planning' },
      { status: 400 },
    )
  }

  const maxActions = parseMaxActions(body.max_actions)
  if (maxActions === null) {
    return NextResponse.json(
      { success: false, error: 'max_actions must be an integer from 1 to 5' },
      { status: 400 },
    )
  }

  try {
    const plan = await buildWebsiteGrowthPlan(supabaseAdmin, params.id, maxActions)
    const queued = await queueWebsiteGrowthPlan(supabaseAdmin, plan)
    return NextResponse.json({ success: true, plan, queued })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to queue website plan'
    const status = message === 'Client not found' ? 404 : 500
    return NextResponse.json({ success: false, error: message }, { status })
  }
}

function parseMaxActions(value: unknown): number | null {
  if (value == null || value === '') return 3
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : null
}

