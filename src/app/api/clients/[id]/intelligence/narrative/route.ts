/**
 * GET /api/clients/[id]/intelligence/narrative
 *
 * Phase 22.C.1 — AI 叙述摘要（Strategy Engine / Claude Sonnet）
 *
 * 做法：
 *   1. 从 flywheel_metrics 批量取 7 个 spotlight 指标的 30 天数据
 *   2. bucketByGranularity → TrendSeries[]（复用 22.B 分析层）
 *   3. generateInsights → InsightCard[]（复用 22.B 规则引擎）
 *   4. 把 TrendSeries + InsightCard 序列化成结构化文本作为 prompt
 *   5. 调 Claude Sonnet（strategy 档位）生成 ~200 字自然语言月度点评
 *   6. 返回 { narrative, generatedAt, tokensUsed }
 *
 * 成本控制：
 *   - max_tokens 限制在 400（约 200 AU English 词）
 *   - 无 DB 写入，无缓存表
 *
 * Auth: session cookie via requireDashboardClientAccess
 *
 * Reference: ROADMAP.md P22.C.1
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { getAnthropicClient, MODEL_SONNET } from '@/lib/anthropic/client'
import { bucketByGranularity } from '@/lib/flywheel/intelligence/timeseries'
import { generateInsights } from '@/lib/flywheel/intelligence/insights'
import { getMetricMeta, SPOTLIGHT_METRIC_KEYS } from '@/lib/flywheel/intelligence/metric-catalog'
import type { TrendSeries, InsightCard, MetricUnit } from '@/lib/flywheel/intelligence/types'
import type { FlywheelName } from '@/lib/flywheel/adapters/types'

export const dynamic = 'force-dynamic'

const LOOKBACK_DAYS = 30
const DEFAULT_TZ    = 'Pacific/Auckland'
const MAX_TOKENS    = 400   // ~200 AU English words — enough for one paragraph

type RouteContext = { params: { id: string } }

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id: clientId } = params

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  try {
    const now    = new Date()
    const cutoff = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000)

    // ── 1. Fetch raw flywheel_metrics ─────────────────────────────────────────
    const { data: rows, error: dbErr } = await supabaseAdmin
      .from('flywheel_metrics')
      .select('metric_key, metric_value, measured_at, flywheel')
      .eq('client_id', clientId)
      .in('metric_key', SPOTLIGHT_METRIC_KEYS)
      .gte('measured_at', cutoff.toISOString())
      .order('measured_at', { ascending: true })

    if (dbErr) throw new Error(`DB error: ${dbErr.message}`)

    // ── 2. Group by metric_key ────────────────────────────────────────────────
    const grouped = new Map<string, Array<{ measured_at: string; metric_value: number }>>()
    for (const row of (rows ?? [])) {
      const pts = grouped.get(row.metric_key as string) ?? []
      pts.push({ measured_at: row.measured_at as string, metric_value: row.metric_value as number })
      grouped.set(row.metric_key as string, pts)
    }

    // ── 3. Build TrendSeries[] via bucketByGranularity ────────────────────────
    const trendSeries: TrendSeries[] = SPOTLIGHT_METRIC_KEYS.map(metricKey => {
      const pts       = grouped.get(metricKey) ?? []
      const meta      = getMetricMeta(metricKey)
      const sampleRow = (rows ?? []).find(r => r.metric_key === metricKey)
      const flywheel  = (sampleRow?.flywheel ?? metricKey.split('.')[0]) as FlywheelName
      return bucketByGranularity(pts, 'day', DEFAULT_TZ, metricKey, flywheel, meta.label, meta.unit, meta.direction)
    })

    // ── 4. Generate InsightCards ──────────────────────────────────────────────
    const { data: anomalyRows } = await supabaseAdmin
      .from('anomaly_signals')
      .select('*')
      .eq('client_id', clientId)
      .eq('status', 'fresh')
      .order('created_at', { ascending: false })
      .limit(10)

    const insights: InsightCard[] = generateInsights(trendSeries, anomalyRows ?? [], clientId)

    // ── 5. Guard: no data ─────────────────────────────────────────────────────
    const hasData = trendSeries.some(s => s.points.length > 0)
    if (!hasData) {
      return NextResponse.json({
        success:     true,
        clientId,
        narrative:   null,
        reason:      'no_data',
        generatedAt: now.toISOString(),
      })
    }

    // ── 6. Build prompt ───────────────────────────────────────────────────────
    const systemPrompt = buildNarrativeSystemPrompt()
    const userPrompt   = buildNarrativeUserPrompt(trendSeries, insights)

    // ── 7. Call Strategy Engine (Sonnet) ──────────────────────────────────────
    const anthropic = getAnthropicClient()
    const message   = await anthropic.messages.create({
      model:      MODEL_SONNET,
      max_tokens: MAX_TOKENS,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    })

    const narrative = message.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('')
      .trim()

    return NextResponse.json({
      success:     true,
      clientId,
      narrative,
      generatedAt: now.toISOString(),
      tokensUsed:  {
        input:  message.usage.input_tokens,
        output: message.usage.output_tokens,
      },
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Narrative generation failed'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

function buildNarrativeSystemPrompt(): string {
  return [
    'You are a senior digital performance analyst writing a concise monthly data summary for a marketing agency FDE (Frontline Deployment Engineer) in Australia/New Zealand.',
    '',
    'Your task: Write ONE paragraph (3–5 sentences, approx. 200 words) that summarises the key performance signals from the last 28 days.',
    '',
    'Rules:',
    '- Use AU/NZ English spelling (optimise, colour, behaviour).',
    '- Be direct and factual — cite specific percentage changes.',
    '- Mention 2–3 standout metrics (positive and/or negative).',
    '- If there are high-severity insights, name them explicitly.',
    '- End with ONE clear priority recommendation for the next 30 days.',
    '- Do NOT use markdown, bullet points, or headings — plain prose only.',
    '- Do NOT mention "Claude", "AI", or internal system names.',
  ].join('\n')
}

function buildNarrativeUserPrompt(series: TrendSeries[], insights: InsightCard[]): string {
  const lines: string[] = ['## Performance Data (Last 28 Days)\n']

  for (const s of series) {
    if (s.points.length === 0) continue
    const lastPt  = s.points[s.points.length - 1]
    const val     = formatValue(lastPt.value, s.unit)
    const delta28 = s.deltaPct28d !== null
      ? ` (${s.deltaPct28d >= 0 ? '+' : ''}${s.deltaPct28d.toFixed(1)}% vs 28d ago)`
      : ''
    lines.push(`- ${s.label}: ${val}${delta28}`)
  }

  if (insights.length > 0) {
    lines.push('\n## Top Insights\n')
    const top5 = insights.slice(0, 5)
    for (const card of top5) {
      lines.push(`- [${card.severity.toUpperCase()}] ${card.headline}: ${card.body}`)
    }
  }

  lines.push('\nWrite the monthly performance summary paragraph now.')
  return lines.join('\n')
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatValue(val: number, unit: MetricUnit): string {
  switch (unit) {
    case 'currency':   return `$${val.toFixed(2)}`
    case 'percent':    return `${(val * 100).toFixed(1)}%`
    case 'percent100': return `${val.toFixed(1)}%`
    case 'ratio':      return `${val.toFixed(2)}x`
    case 'seconds':    return `${Math.round(val)}s`
    case 'rank':       return `#${val.toFixed(1)}`
    default:           return val.toLocaleString()
  }
}
