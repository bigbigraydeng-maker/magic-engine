import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getUserPermissions } from '@/lib/auth/whitelist'
import { boundedBody, checkOrigin } from '@/lib/meta/ai/http'
import { MetaReadError } from '@/lib/meta/graph-read'
import { consumeQuota, dayStartUtc, QuotaUnavailable } from '@/lib/zhangqian/rate-limiter'
import {
  generateSocialOnboardingPlan,
  onboardingInputSchema,
  type OnboardingEvidence,
} from '@/lib/social-onboarding/generator'
import { resolveIndustryProfile } from '@/lib/social-onboarding/industry-profiles'

export const dynamic = 'force-dynamic'
export const maxDuration = 90

type Context = { params: { id: string } }

async function staffAccess(clientId: string) {
  const access = await requireAdmin()
  if (!access.ok) return { ok: false as const, response: NextResponse.json({ error: access.error }, { status: access.status }) }
  const permissions = getUserPermissions(access.user.email ?? '')
  if (permissions?.allowedClientId && permissions.allowedClientId !== clientId) {
    return { ok: false as const, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true as const, user: access.user }
}

function errorResponse(error: unknown) {
  if (error instanceof MetaReadError) return NextResponse.json({ error: error.code }, { status: error.status })
  return NextResponse.json({ error: '请求失败，请稍后重试' }, { status: 500 })
}

async function readClientRow(clientId: string): Promise<Record<string, unknown> | null> {
  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('name, industry, domain, facebook_page_url, facebook_page_id, brief_fields')
    .eq('id', clientId)
    .maybeSingle()
  if (clientError || !client) return null
  return client as Record<string, unknown>
}

type SavedSources = {
  brief: Record<string, unknown> | null
  snapshots: Array<Record<string, unknown>>
  diagnosticRuns: Array<{ dimension: 'social' | 'ads'; id: string; completed_at: string }>
  connectors: Array<Record<string, unknown>>
}

const AD_SNAPSHOT_FRESH_DAYS = 30

function safeText(value: unknown, max = 500): unknown {
  if (typeof value === 'string') return value.slice(0, max)
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeText(item, max))
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).slice(0, 30).map(([key, item]) => [key, safeText(item, max)]),
  )
  return value
}

function safeBriefFields(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const fields = value as Record<string, unknown>
  const allowed = ['industry', 'target_audience', 'audience', 'services', 'products', 'brand_voice', 'tone', 'content_pillars', 'goals', 'constraints']
  return Object.fromEntries(allowed.filter((key) => key in fields).map((key) => [key, safeText(fields[key], 500)]))
}

async function readSavedSources(clientId: string): Promise<SavedSources> {
  const [briefRes, snapshotsRes, socialRunRes, adsRunRes, connectorsRes] = await Promise.all([
    supabaseAdmin.from('master_briefs')
      .select('id, version, brand_name, tagline, primary_audience, pain_points, buying_trigger, products, tone, content_topics, content_avoid, platforms, post_frequency, updated_at')
      .eq('client_id', clientId).or('status.eq.active,is_active.eq.true')
      .order('version', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('meta_ads_snapshots')
      .select('period_start, period_end, impressions, clicks, conversions, roas, ctr, fetched_at')
      .eq('client_id', clientId).order('fetched_at', { ascending: false }).limit(4),
    supabaseAdmin.from('diagnostic_runs')
      .select('id, completed_at').eq('client_id', clientId).eq('status', 'completed')
      .contains('dimensions_requested', ['social']).order('completed_at', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('diagnostic_runs')
      .select('id, completed_at').eq('client_id', clientId).eq('status', 'completed')
      .contains('dimensions_requested', ['ads']).order('completed_at', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('client_connectors')
      .select('anchor, status').eq('client_id', clientId),
  ])

  if (briefRes.error || snapshotsRes.error || socialRunRes.error || adsRunRes.error || connectorsRes.error) {
    throw new Error('无法读取一项或多项已保存的数据源')
  }
  return {
    brief: (briefRes.data as Record<string, unknown> | null) ?? null,
    snapshots: (snapshotsRes.data as Array<Record<string, unknown>> | null) ?? [],
    diagnosticRuns: [
      ...(socialRunRes.data ? [{ dimension: 'social' as const, ...(socialRunRes.data as { id: string; completed_at: string }) }] : []),
      ...(adsRunRes.data ? [{ dimension: 'ads' as const, ...(adsRunRes.data as { id: string; completed_at: string }) }] : []),
    ],
    connectors: (connectorsRes.data as Array<Record<string, unknown>> | null) ?? [],
  }
}

async function readSocialFindings(clientId: string, runs: SavedSources['diagnosticRuns']) {
  if (runs.length === 0) return []
  const results = await Promise.all(runs.map(async (run) => {
    const { data, error } = await supabaseAdmin.from('diagnostic_findings')
      .select('dimension, finding_type, title, description, created_at, priority_score')
      .eq('client_id', clientId).eq('run_id', run.id).eq('dimension', run.dimension)
      .order('priority_score', { ascending: false }).limit(6)
    if (error) throw new Error(`无法读取${run.dimension}诊断数据`)
    return (data as Array<Record<string, unknown>> | null) ?? []
  }))
  return results.flat().map((row) => ({
    dimension: row.dimension,
    finding_type: row.finding_type,
    title: safeText(row.title, 200),
    description: safeText(row.description, 500),
    created_at: row.created_at,
  }))
}

async function readEvidence(clientId: string): Promise<OnboardingEvidence | null> {
  const [client, sources] = await Promise.all([readClientRow(clientId), readSavedSources(clientId)])
  if (!client) return null
  const findings = await readSocialFindings(clientId, sources.diagnosticRuns)
  const briefFields = safeBriefFields(client.brief_fields)
  const newestSnapshotTime = sources.snapshots[0]?.fetched_at ? new Date(String(sources.snapshots[0].fetched_at)).getTime() : NaN
  const adSnapshotStale = sources.snapshots.length > 0 && (!Number.isFinite(newestSnapshotTime) || Date.now() - newestSnapshotTime > AD_SNAPSHOT_FRESH_DAYS * 24 * 60 * 60 * 1000)
  const sanitizedBrief = sources.brief ? Object.fromEntries(Object.entries(sources.brief).map(([key, value]) => [key, safeText(value, 500)])) : null

  return {
    client: {
      name: safeText(client.name, 200),
      industry: safeText(client.industry ?? briefFields?.industry ?? null, 100),
      domain: safeText(client.domain, 200),
      facebook_page_url: safeText(client.facebook_page_url, 300),
      facebook_page_connected: Boolean(client.facebook_page_id),
      brief_fields: briefFields,
    },
    masterBrief: sanitizedBrief,
    socialFindings: findings,
    diagnosticSnapshots: sources.diagnosticRuns.map((run) => ({
      dimension: run.dimension,
      completedAt: run.completed_at,
      findingCount: findings.filter((item) => item.dimension === run.dimension).length,
    })),
    adSnapshots: sources.snapshots.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, safeText(value, 100)]))),
    connectorStatuses: sources.connectors.map((row) => ({ anchor: safeText(row.anchor, 100), status: safeText(row.status, 50) })),
    coverage: {
      masterBrief: Boolean(sources.brief),
      socialSnapshot: sources.diagnosticRuns.some((run) => run.dimension === 'social'),
      adSnapshot: sources.snapshots.length > 0 && !adSnapshotStale,
      adSnapshotStale,
      facebookPage: Boolean(client.facebook_page_id || client.facebook_page_url),
      followerCount: false,
      objectiveBreakdown: false,
    },
  }
}

export async function GET(_request: NextRequest, { params }: Context) {
  const access = await staffAccess(params.id)
  if (!access.ok) return access.response

  let evidence: OnboardingEvidence | null
  try { evidence = await readEvidence(params.id) } catch (error) { return errorResponse(error) }
  if (!evidence) return NextResponse.json({ error: '无法读取客户资料' }, { status: 500 })

  const { data, error } = await supabaseAdmin.from('social_growth_onboarding_plans')
    .select('id, industry_profile, status, inputs, recommendation, evidence_snapshot, reviewed_at, created_at')
    .eq('client_id', params.id).order('created_at', { ascending: false }).limit(10)
  if (error) return NextResponse.json({ error: '无法读取起号方案' }, { status: 500 })

  const industry = String(evidence.client.industry ?? '')
  return NextResponse.json({
    client: evidence.client,
    evidence: { coverage: evidence.coverage },
    suggestedIndustryProfile: resolveIndustryProfile(industry),
    plans: data ?? [],
  })
}

export async function POST(request: NextRequest, { params }: Context) {
  const access = await staffAccess(params.id)
  if (!access.ok) return access.response
  try { checkOrigin(request) } catch (error) { return errorResponse(error) }

  const body = await boundedBody(request).catch(() => null) as { input?: unknown } | null
  const parsed = onboardingInputSchema.safeParse(body?.input)
  if (!parsed.success) return NextResponse.json({ error: '请检查填写内容后重试' }, { status: 400 })

  let evidence: OnboardingEvidence | null
  try { evidence = await readEvidence(params.id) } catch (error) { return errorResponse(error) }
  if (!evidence) return NextResponse.json({ error: '无法读取客户资料' }, { status: 500 })

  try {
    const [staffAllowed, clientAllowed] = await Promise.all([
      consumeQuota('social_growth_onboarding_staff', access.user.id, dayStartUtc(), 10),
      consumeQuota('social_growth_onboarding_client', params.id, dayStartUtc(), 5),
    ])
    if (!staffAllowed || !clientAllowed) return NextResponse.json({ error: '今日方案生成次数已达上限，请明天再试' }, { status: 429 })
  } catch (error) {
    if (error instanceof QuotaUnavailable) return NextResponse.json({ error: '方案生成服务暂时不可用，请稍后重试' }, { status: 503 })
    return NextResponse.json({ error: '方案生成服务暂时不可用，请稍后重试' }, { status: 503 })
  }

  try {
    const generated = await generateSocialOnboardingPlan({ input: parsed.data, evidence })
    const generationMeta = {
      prompt_version: 'facebook-growth-onboarding-v1',
      model: generated.model,
      generation_cost_usd: generated.costUsd,
      input_tokens: generated.inputTokens,
      output_tokens: generated.outputTokens,
      generated_at: new Date().toISOString(),
    }
    const { data, error } = await supabaseAdmin.from('social_growth_onboarding_plans')
      .insert({
        client_id: params.id,
        industry_profile: parsed.data.industryProfile,
        inputs: parsed.data,
        recommendation: generated.plan,
        evidence_snapshot: evidence,
        generation_meta: generationMeta,
        generated_by: access.user.email ?? null,
      })
      .select('id, industry_profile, status, inputs, recommendation, evidence_snapshot, reviewed_at, created_at')
      .single()
    if (error) throw new Error('方案保存失败')
    return NextResponse.json({ plan: data })
  } catch (error) {
    console.error('[social-growth-onboarding] generation failed', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: '方案生成或保存失败，请稍后重试' }, { status: 502 })
  }
}

export async function PATCH(request: NextRequest, { params }: Context) {
  const access = await staffAccess(params.id)
  if (!access.ok) return access.response
  try { checkOrigin(request) } catch (error) { return errorResponse(error) }

  const body = await boundedBody(request).catch(() => null) as { planId?: unknown; status?: unknown } | null
  if (typeof body?.planId !== 'string' || body.status !== 'reviewed') {
    return NextResponse.json({ error: '无效的审核请求' }, { status: 400 })
  }
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin.from('social_growth_onboarding_plans')
    .update({ status: 'reviewed', reviewed_at: now, reviewed_by: access.user.email ?? null })
    .eq('id', body.planId).eq('client_id', params.id).eq('status', 'draft')
    .select('id, status, reviewed_at').maybeSingle()
  if (error) return NextResponse.json({ error: '审核状态保存失败' }, { status: 500 })
  if (!data) return NextResponse.json({ error: '找不到可审核的方案' }, { status: 404 })
  return NextResponse.json({ plan: data })
}
