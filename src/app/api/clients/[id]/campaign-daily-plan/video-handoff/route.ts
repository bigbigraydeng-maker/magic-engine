import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { supabaseAdmin } from '@/lib/supabase'
import { CAMPAIGN_DAILY_PLAN_KIND, type CampaignDailyPlanData } from '@/lib/campaign/daily-plan'
import { assetIdSchema, videoHandoffSchema, usableVideo, type VideoAsset, type VideoHandoff } from '@/lib/campaign/video-handoff'

type Context = { params: { id: string } }
type AssetRow = VideoAsset & { vision_metadata: Record<string, unknown> | null }

async function latestPlan(clientId: string, campaignId: string) {
  return supabaseAdmin.from('social_plans').select('id, plan_data')
    .eq('client_id', clientId).eq('campaign_id', campaignId)
    .contains('plan_data', { plan_kind: CAMPAIGN_DAILY_PLAN_KIND })
    .order('created_at', { ascending: false }).limit(1)
}

/** Links live in asset metadata; never rewrites the seven-day plan or its Post approvals. */
export async function GET(req: NextRequest, { params }: Context) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const campaign = assetIdSchema.safeParse(req.nextUrl.searchParams.get('campaign_id'))
  if (!campaign.success) return NextResponse.json({ error: 'INVALID_CAMPAIGN_ID' }, { status: 400 })
  const { data: plans, error } = await latestPlan(params.id, campaign.data)
  if (error) return NextResponse.json({ error: 'PLAN_READ_FAILED' }, { status: 503 })
  const plan = plans?.[0]
  if (!plan) return NextResponse.json({ videos: [] })
  const planData = plan.plan_data as CampaignDailyPlanData
  const { data: assets, error: assetError } = await supabaseAdmin.from('client_assets')
    .select('id, storage_url, original_filename, mime_type, status, archived_at, vision_metadata')
    .eq('client_id', params.id).eq('mime_type', 'video/mp4').is('archived_at', null)
  if (assetError) return NextResponse.json({ error: 'ASSET_READ_FAILED' }, { status: 503 })
  const videos = (assets as AssetRow[] ?? []).flatMap(asset => {
    if (!usableVideo(asset)) return []
    const links = asset.vision_metadata?.video_handoffs
    if (!links || typeof links !== 'object' || Array.isArray(links)) return []
    return Object.values(links).flatMap(link => {
      const parsed = videoHandoffSchema.safeParse(link)
      if (!parsed.success || parsed.data.asset_id !== asset.id || parsed.data.plan_id !== plan.id ||
          parsed.data.campaign_id !== campaign.data || parsed.data.expected_plan_revision !== planData.command_meta?.received_at ||
          !planData.days?.some(day => day.date === parsed.data.date)) return []
      return [{ ...parsed.data, preview_url: asset.storage_url, filename: asset.original_filename, approval: 'NOT_REVIEWED' }]
    })
  })
  return NextResponse.json({ videos })
}

export async function POST(req: NextRequest, { params }: Context) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const admin = await requireGlobalAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })
  const parsed = videoHandoffSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_HANDOFF' }, { status: 400 })
  return attach(params.id, parsed.data)
}

async function attach(clientId: string, command: VideoHandoff) {
  const { data: plans, error } = await latestPlan(clientId, command.campaign_id)
  if (error) return NextResponse.json({ error: 'PLAN_READ_FAILED' }, { status: 503 })
  const plan = plans?.[0]
  const planData = plan?.plan_data as CampaignDailyPlanData | undefined
  if (!plan || plan.id !== command.plan_id || planData?.campaign_id !== command.campaign_id ||
      planData.command_meta?.received_at !== command.expected_plan_revision) {
    return NextResponse.json({ error: 'PLAN_CHANGED_RELOAD' }, { status: 409 })
  }
  if (!planData.days?.some(day => day.date === command.date)) {
    return NextResponse.json({ error: 'DATE_NOT_IN_PLAN' }, { status: 400 })
  }
  const { data: asset, error: assetError } = await supabaseAdmin.from('client_assets')
    .select('id, storage_url, original_filename, mime_type, status, archived_at, vision_metadata')
    .eq('client_id', clientId).eq('id', command.asset_id).maybeSingle<AssetRow>()
  if (assetError) return NextResponse.json({ error: 'ASSET_READ_FAILED' }, { status: 503 })
  if (!usableVideo(asset)) return NextResponse.json({ error: 'VIDEO_NOT_AVAILABLE' }, { status: 404 })
  const metadata = asset.vision_metadata ?? {}
  const links = metadata.video_handoffs
  const existing = links && typeof links === 'object' && !Array.isArray(links) ? links : {}
  const key = `${command.plan_id}:${command.date}:${command.platform}`
  const next = { ...metadata, video_handoffs: { ...existing, [key]: command } }
  let update = supabaseAdmin.from('client_assets').update({ vision_metadata: next })
    .eq('client_id', clientId).eq('id', command.asset_id)
    .eq('status', 'analyzed').eq('mime_type', 'video/mp4').is('archived_at', null)
  update = asset.vision_metadata === null
    ? update.is('vision_metadata', null)
    : update.eq('vision_metadata', JSON.stringify(asset.vision_metadata))
  const saved = await update.select('id').maybeSingle()
  if (saved.error) return NextResponse.json({ error: 'HANDOFF_SAVE_FAILED' }, { status: 503 })
  if (!saved.data) return NextResponse.json({ error: 'ASSET_CHANGED_RETRY' }, { status: 409 })
  const current = await latestPlan(clientId, command.campaign_id)
  const currentPlan = current.data?.[0]
  if (current.error || currentPlan?.id !== command.plan_id ||
      (currentPlan?.plan_data as CampaignDailyPlanData)?.command_meta?.received_at !== command.expected_plan_revision) {
    return NextResponse.json({ error: 'PLAN_CHANGED_RELOAD' }, { status: 409 })
  }
  return NextResponse.json({ success: true, video: { ...command, preview_url: asset.storage_url }, publishing_authorization: 'NOT_AUTHORIZED' })
}
