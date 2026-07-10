/**
 * POST /api/discovery/scan-results
 *
 * 接收 me-client-discovery plugin（Phase 0）或未来司马徽 agent（Phase 3）
 * 提交的 Discovery 扫描结果 · 上表：
 *   - competitor_snapshots × N
 *   - market_context_snapshots × (0 or 1)
 *   - local_media_channels × M
 *
 * Auth: Bearer ${DISCOVERY_API_TOKEN}
 * Spec: plugins/me-client-discovery/docs/FUTURE-ME-COMPAT.md
 * Contract: src/lib/discovery/schemas.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  ScanResultsRequestSchema,
  type CompetitorSnapshot,
  type LocalMediaChannel,
  type MarketContextSnapshot,
} from '@/lib/discovery/schemas'
import { z } from 'zod'

export const maxDuration = 60

// ────────────────────────────────────────────────────────────────
// Handler
// ────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Auth
  const apiToken = process.env.DISCOVERY_API_TOKEN
  if (!apiToken) {
    return NextResponse.json(
      { error: 'Server misconfiguration: DISCOVERY_API_TOKEN not set' },
      { status: 500 },
    )
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${apiToken}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Parse + validate
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = ScanResultsRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Schema validation failed',
        details: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 },
    )
  }

  const payload = parsed.data

  // 3. Verify client_id 存在
  const { data: client, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('id', payload.client_id)
    .maybeSingle()

  if (clientErr) {
    return NextResponse.json(
      { error: 'Database error looking up client', details: clientErr.message },
      { status: 500 },
    )
  }
  if (!client) {
    return NextResponse.json(
      { error: `client_id not found: ${payload.client_id}` },
      { status: 404 },
    )
  }

  // 4. Upsert 3 张表（并行 · 独立事务 · 一张失败不阻塞其他）
  const [competitorRes, marketRes, mediaRes] = await Promise.all([
    upsertCompetitors(payload.client_id, payload.competitors),
    upsertMarketContext(payload.client_id, payload.market_context),
    upsertLocalMedia(payload.client_id, payload.local_media_channels),
  ])

  const errors: string[] = []
  if (competitorRes.error) errors.push(`competitors: ${competitorRes.error}`)
  if (marketRes.error) errors.push(`market_context: ${marketRes.error}`)
  if (mediaRes.error) errors.push(`local_media: ${mediaRes.error}`)

  if (errors.length > 0) {
    return NextResponse.json(
      {
        error: 'Partial write failure',
        details: errors,
        written: {
          competitor_snapshots: competitorRes.written,
          market_context_snapshots: marketRes.written,
          local_media_channels: mediaRes.written,
        },
      },
      { status: 207 }, // Multi-Status
    )
  }

  // 5. Success
  return NextResponse.json({
    written: {
      competitor_snapshots: competitorRes.written,
      market_context_snapshots: marketRes.written,
      local_media_channels: mediaRes.written,
    },
    discovery_tab_url: `/dashboard/clients/${payload.client_id}/discovery`,
  })
}

// ────────────────────────────────────────────────────────────────
// Upsert helpers
// ────────────────────────────────────────────────────────────────

async function upsertCompetitors(
  clientId: string,
  competitors: CompetitorSnapshot[],
): Promise<{ written: number; error?: string }> {
  if (competitors.length === 0) return { written: 0 }

  const rows = competitors.map((c) => ({
    client_id: clientId,
    competitor_name: c.competitor_name,
    scanned_at: c.scanned_at,
    source: c.source,
    snapshot_json: c,
  }))

  const { error } = await supabaseAdmin
    .from('competitor_snapshots')
    .upsert(rows, { onConflict: 'client_id,competitor_name,scanned_at' })

  if (error) return { written: 0, error: error.message }
  return { written: rows.length }
}

async function upsertMarketContext(
  clientId: string,
  ctx: MarketContextSnapshot | null,
): Promise<{ written: number; error?: string }> {
  if (!ctx) return { written: 0 }

  const row = {
    client_id: clientId,
    geography_region_name: ctx.geography.region_name,
    scanned_at: ctx.scanned_at,
    source: ctx.source,
    snapshot_json: ctx,
  }

  const { error } = await supabaseAdmin
    .from('market_context_snapshots')
    .upsert([row], { onConflict: 'client_id,geography_region_name,scanned_at' })

  if (error) return { written: 0, error: error.message }
  return { written: 1 }
}

async function upsertLocalMedia(
  clientId: string,
  channels: LocalMediaChannel[],
): Promise<{ written: number; error?: string }> {
  if (channels.length === 0) return { written: 0 }

  const rows = channels.map((c) => ({
    client_id: clientId,
    media_name: c.media_name,
    category: c.category,
    discovered_at: c.scanned_at, // Note: local_media 用 discovered_at 字段名 · plugin 输出用 scanned_at
    source: c.source,
    channel_json: c,
    roi_rank: c.roi_rank ?? null,
    chinese_relevant: c.chinese_relevant,
    is_active: true,
  }))

  const { error } = await supabaseAdmin
    .from('local_media_channels')
    .upsert(rows, { onConflict: 'client_id,media_name' })

  if (error) return { written: 0, error: error.message }
  return { written: rows.length }
}
