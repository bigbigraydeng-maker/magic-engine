import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { supabaseAdmin } from '@/lib/supabase'
import { parseCreativePool, defaultConfig } from '@/lib/ads-strategy/config'
import { videoHandoffSchema, usableVideo, type VideoAsset, type VideoHandoff } from '@/lib/campaign/video-handoff'
import { CAMPAIGN_DAILY_PLAN_KIND, type CampaignDailyPlanData } from '@/lib/campaign/daily-plan'

/** Append a local-library candidate; does not upload to Meta or authorise execution. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const admin = await requireGlobalAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })
  const parsed = videoHandoffSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_HANDOFF' }, { status: 400 })
  const command = parsed.data
  const { data: plans, error: planError } = await supabaseAdmin.from('social_plans').select('id, plan_data')
    .eq('client_id', params.id).eq('campaign_id', command.campaign_id)
    .contains('plan_data', { plan_kind: CAMPAIGN_DAILY_PLAN_KIND })
    .order('created_at', { ascending: false }).limit(1)
  const plan = plans?.[0]
  const planData = plan?.plan_data as CampaignDailyPlanData | undefined
  if (planError) return NextResponse.json({ error: 'PLAN_READ_FAILED' }, { status: 503 })
  if (!plan || plan.id !== command.plan_id || planData?.command_meta?.received_at !== command.expected_plan_revision ||
      !planData.days?.some(day => day.date === command.date)) {
    return NextResponse.json({ error: 'PLAN_CHANGED_RELOAD' }, { status: 409 })
  }
  const { data: asset, error: assetError } = await supabaseAdmin.from('client_assets')
    .select('id, storage_url, original_filename, mime_type, status, archived_at, vision_metadata')
    .eq('client_id', params.id).eq('id', command.asset_id)
    .maybeSingle<VideoAsset & { vision_metadata: Record<string, unknown> | null }>()
  if (assetError) return NextResponse.json({ error: 'ASSET_READ_FAILED' }, { status: 503 })
  if (!usableVideo(asset)) return NextResponse.json({ error: 'VIDEO_NOT_AVAILABLE' }, { status: 404 })
  const links = asset.vision_metadata?.video_handoffs as Record<string, unknown> | undefined
  const linked = videoHandoffSchema.safeParse(links?.[`${command.plan_id}:${command.date}:${command.platform}`])
  if (!linked.success || JSON.stringify(linked.data) !== JSON.stringify(command)) {
    return NextResponse.json({ error: 'ATTACH_TO_DAILY_PLAN_FIRST' }, { status: 409 })
  }
  return appendCandidate(params.id, command)
}

async function appendCandidate(clientId: string, command: VideoHandoff) {
  const { data: row, error } = await supabaseAdmin.from('ad_strategy_configs')
    .select('creative_pool').eq('client_id', clientId).maybeSingle()
  if (error) return NextResponse.json({ error: 'POOL_READ_FAILED' }, { status: 503 })
  const raw = row?.creative_pool ?? []
  const pool = parseCreativePool(raw)
  if (!Array.isArray(raw) || pool.length !== raw.length) {
    return NextResponse.json({ error: 'POOL_STATE_INVALID' }, { status: 409 })
  }
  const previous = pool.find(entry => entry.kind === 'client_video' && entry.ref === command.asset_id)
  if (previous) {
    if (previous.campaign_id !== command.campaign_id || previous.title !== command.title || previous.caption !== command.caption) {
      return NextResponse.json({ error: 'CANDIDATE_CONTEXT_CHANGED_REVIEW_REQUIRED' }, { status: 409 })
    }
    return NextResponse.json({ success: true, idempotent: true, candidate: previous })
  }
  const candidate = { kind: 'client_video' as const, ref: command.asset_id, status: 'candidate' as const,
    campaign_id: command.campaign_id, title: command.title, caption: command.caption }
  const next = [...raw, candidate]
  if (!row) {
    const inserted = await supabaseAdmin.from('ad_strategy_configs')
      .insert({ ...defaultConfig(clientId), creative_pool: next })
    if (inserted.error) return NextResponse.json({ error: 'POOL_CREATE_CONFLICT_RETRY' }, { status: 409 })
  } else {
    let query = supabaseAdmin.from('ad_strategy_configs').update({ creative_pool: next, updated_at: new Date().toISOString() })
      .eq('client_id', clientId)
    query = row.creative_pool === null ? query.is('creative_pool', null) : query.eq('creative_pool', JSON.stringify(raw))
    const saved = await query.select('client_id').maybeSingle()
    if (saved.error) return NextResponse.json({ error: 'POOL_SAVE_FAILED' }, { status: 503 })
    if (!saved.data) return NextResponse.json({ error: 'POOL_CHANGED_RETRY' }, { status: 409 })
  }
  return NextResponse.json({ success: true, candidate, publishing_authorization: 'NOT_AUTHORIZED' }, { status: 201 })
}
