/**
 * POST /api/clients/[id]/marketing-plan/generate
 *
 * 生成 Marketing Plan 草稿。
 * 输入：title, start_date, end_date, campaign_id?, focus_note?, intensity?
 * 输出：新建的 marketing_plans 记录（status=draft）
 *
 * 流程：
 *   1. 读 Master Brief（active）
 *   2. 读 Campaign Brief（如指定）
 *   3. 读 Strategy 建议主题（content_strategy_items 表，最新 12 条 pending）
 *   4. 调 Claude Strategy Engine 生成 plan_data
 *   5. 写入 marketing_plans 表（status=draft）
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { formatBriefForPrompt } from '@/lib/content/brief-injector'
import { formatCampaignForPrompt, getCampaignById } from '@/lib/content/campaign-injector'
import {
  generatePlanData,
  formatStrategySuggestions,
  formatViralReferences,
} from '@/lib/marketing-plan/generator'
import type { ClaudeDocInput } from '@/lib/anthropic/client'
import type { GeneratePlanRequest } from '@/lib/marketing-plan/types'
import type { MasterBrief } from '@/types/magic-engine'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

const CAMPAIGN_BUCKET = 'campaign-uploads'

export const maxDuration = 90  // Plan 生成耗时较长（Claude 大 token 输出）

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  const clientId = params.id

  try {
    const body = await req.json().catch(() => ({})) as Partial<GeneratePlanRequest>

    // ── 参数校验 ──────────────────────────────────────────────────────────────
    if (!body.title || !body.start_date || !body.end_date) {
      return NextResponse.json({
        success: false,
        error: 'title, start_date, end_date are required',
      }, { status: 400 })
    }

    if (new Date(body.end_date).getTime() <= new Date(body.start_date).getTime()) {
      return NextResponse.json({
        success: false,
        error: 'end_date must be after start_date',
      }, { status: 400 })
    }

    // ── 1. Master Brief ──────────────────────────────────────────────────────
    const { data: brief, error: briefErr } = await supabaseAdmin
      .from('master_briefs')
      .select('*')
      .eq('client_id', clientId)
      .or('status.eq.active,is_active.eq.true')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (briefErr) throw new Error(briefErr.message || 'Database error fetching master brief')
    if (!brief) {
      return NextResponse.json({
        success: false,
        error: 'No active Master Brief found. Please set up the brand brief first.',
      }, { status: 400 })
    }

    const briefText = formatBriefForPrompt(brief as unknown as MasterBrief)

    // ── 2. Campaign Brief（可选）─────────────────────────────────────────────
    let campaignText: string | null = null
    const campaignDocs: ClaudeDocInput[] = []

    if (body.campaign_id) {
      const campaign = await getCampaignById(clientId, body.campaign_id)
      if (!campaign) {
        return NextResponse.json({
          success: false,
          error: 'Campaign Brief not found or does not belong to this client.',
        }, { status: 400 })
      }
      campaignText = formatCampaignForPrompt(campaign)

      // ── 2b. Download campaign files and pass directly to Claude ───────────
      const filePaths = (campaign.source_file_urls ?? []).filter(Boolean).slice(0, 3)
      for (const storagePath of filePaths) {
        try {
          const { data, error } = await supabaseAdmin.storage
            .from(CAMPAIGN_BUCKET)
            .download(storagePath)
          if (!data || error) continue
          const buffer = Buffer.from(await data.arrayBuffer())
          const filename = storagePath.split('/').pop() ?? storagePath
          const isPdf = storagePath.toLowerCase().endsWith('.pdf')
          campaignDocs.push({
            type: isPdf ? 'pdf' : 'text',
            content: isPdf ? buffer.toString('base64') : buffer.toString('utf-8'),
            filename,
          })
        } catch {
          // non-fatal — campaign text fields still provide context
        }
      }
    }

    // ── 3. Strategy 建议主题（最新 pending）────────────────────────────────────
    let strategySuggestions: string | null = null
    try {
      const { data: strategyItems } = await supabaseAdmin
        .from('content_strategy_items')
        .select('id, proposed_title, rationale, source_keyword, keyword_volume, keyword_kd, priority_score')
        .eq('client_id', clientId)
        .eq('status', 'pending')
        .order('priority_score', { ascending: false })
        .limit(12)

      if (strategyItems && strategyItems.length > 0) {
        strategySuggestions = formatStrategySuggestions(strategyItems)
      }
    } catch (strategyErr) {
      console.warn('[marketing-plan generate] strategy items fetch failed (non-blocking):', strategyErr)
    }

    // ── 3b. Viral Reference Library（爆款风格参考）────────────────────────────
    let viralReferences: string | null = null
    try {
      const { data: viralItems } = await supabaseAdmin
        .from('viral_reference_library')
        .select('id, platform, content_goal, style_tags, key_techniques, style_description')
        .eq('is_learnable', true)
        .eq('analysis_status', 'done')
        .or(`client_id.eq.${clientId},client_id.is.null`)
        .order('client_id', { ascending: false })   // client-specific 优先
        .limit(8)

      if (viralItems && viralItems.length > 0) {
        viralReferences = formatViralReferences(viralItems)
      }
    } catch (viralErr) {
      console.warn('[marketing-plan generate] viral references fetch failed (non-blocking):', viralErr)
    }

    // ── 4. AI 生成 plan_data ─────────────────────────────────────────────────
    const { plan_data, meta } = await generatePlanData({
      briefText,
      campaignText,
      campaignDocs: campaignDocs.length > 0 ? campaignDocs : undefined,
      strategySuggestions,
      viralReferences,
      request: body as GeneratePlanRequest,
    })

    // ── 5. 写入数据库 ─────────────────────────────────────────────────────────
    const { data: saved, error: insertErr } = await supabaseAdmin
      .from('marketing_plans')
      .insert({
        client_id:       clientId,
        campaign_id:     body.campaign_id ?? null,
        master_brief_id: (brief as { id: string }).id,
        title:           body.title,
        status:          'draft',
        start_date:      body.start_date,
        end_date:        body.end_date,
        plan_data,
        generation_meta: meta,
        initiative_id:   body.initiative_id ?? null,
      })
      .select('*')
      .single()

    if (insertErr) throw new Error(insertErr.message || 'Database error saving marketing plan')

    return NextResponse.json({ success: true, plan: saved })

  } catch (err: unknown) {
    const message = err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message: unknown }).message)
        : String(err) || 'Unknown error'
    console.error('[marketing-plan generate] error:', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
