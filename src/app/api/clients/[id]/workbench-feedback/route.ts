import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

type FeedbackState = 'done' | 'dismissed' | 'irrelevant'

interface WorkbenchFeedbackBody {
  suggestionId?: unknown
  suggestionKey?: unknown
  suggestionTitle?: unknown
  state?: unknown
  currentAreaLabel?: unknown
  currentHref?: unknown
  clientLabel?: unknown
  campaignLabel?: unknown
  taskLabel?: unknown
  packageLabel?: unknown
  recordedAt?: unknown
  source?: unknown
}

function isFeedbackState(value: unknown): value is FeedbackState {
  return value === 'done' || value === 'dismissed' || value === 'irrelevant'
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const body = await req.json() as WorkbenchFeedbackBody

    if (
      typeof body.suggestionId !== 'string' ||
      typeof body.suggestionKey !== 'string' ||
      typeof body.suggestionTitle !== 'string' ||
      !isFeedbackState(body.state) ||
      typeof body.currentAreaLabel !== 'string' ||
      typeof body.clientLabel !== 'string'
    ) {
      return NextResponse.json({ success: false, error: 'Invalid feedback payload' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('zhuge_feedback_events')
      .insert({
        client_id: clientId,
        suggestion_id: body.suggestionId,
        suggestion_key: body.suggestionKey,
        suggestion_title: body.suggestionTitle,
        feedback_state: body.state,
        current_area_label: body.currentAreaLabel,
        current_href: typeof body.currentHref === 'string' ? body.currentHref : null,
        client_label: body.clientLabel,
        campaign_label: typeof body.campaignLabel === 'string' ? body.campaignLabel : null,
        task_label: typeof body.taskLabel === 'string' ? body.taskLabel : null,
        package_label: typeof body.packageLabel === 'string' ? body.packageLabel : null,
        feedback_source: typeof body.source === 'string' ? body.source : 'workbench_beta',
        client_recorded_at: typeof body.recordedAt === 'string' ? body.recordedAt : null,
        metadata: {},
      })

    if (error) {
      throw error
    }

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[workbench-feedback POST]', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
