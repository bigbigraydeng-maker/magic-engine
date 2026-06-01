/**
 * POST /api/ai/zhugeliang/proactive
 *
 * Zhugeliang Proactive Advisory — Phase 22.D.2
 *
 * Reads NEW anomaly signals for a client and asks Claude to generate
 * prioritised advisory execution items. Each advisory is written to
 * execution_items(source='proactive_signal') for display on the execution
 * board with the ⚡ 系统检测 badge (P22.D.4).
 *
 * Request body:
 *   { clientId: string, limit?: number }
 *
 * Response:
 *   { success: true, processed: number, advisories: Advisory[], signals_acknowledged: number }
 *
 * Flow:
 *   1. Load anomaly_signals WHERE status='new' AND client_id=X (newest first, ≤ limit)
 *   2. Return early if no new signals
 *   3. Build prompt with signal context
 *   4. Call Claude Haiku — generate structured advisory list
 *   5. Parse JSON response → validate advisory rows
 *   6. Insert execution_items (source='proactive_signal')
 *   7. Mark anomaly_signals as 'acknowledged'
 *   8. Return summary
 *
 * Auth: Bearer CRON_SECRET (called by anomaly-detector cron — P22.D.3)
 *
 * Reference: ROADMAP.md P22.D.2
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAnthropicClient, MODEL_HAIKU, parseJsonResponse } from '@/lib/anthropic/client'

export const dynamic    = 'force-dynamic'
export const maxDuration = 60

// ─── Types ───────────────────────────────────────────────────────────────────

interface AnomalySignalRow {
  id:             string
  flywheel:       string
  metric_key:     string
  rule_id:        string
  severity:       string
  current_value:  number | null
  baseline_value: number | null
  pct_change:     number | null
  detected_at:    string
}

interface Advisory {
  title:       string
  description: string
  dimension:   'seo' | 'ai_visibility' | 'ads' | 'social' | 'reputation' | 'competitor'
  fix_type:    'me_auto' | 'fde_manual' | 'third_party'
  severity:    'high' | 'medium' | 'low'
  signal_ids:  string[]   // which anomaly_signal IDs this advisory addresses
}

interface ClaudeAdvisoryResponse {
  advisories: Advisory[]
}

// ─── Route ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Server misconfiguration: CRON_SECRET not set' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let clientId: string
  let limit = 10

  try {
    const body = await req.json() as { clientId?: unknown; limit?: unknown }
    if (!body.clientId || typeof body.clientId !== 'string') {
      return NextResponse.json({ error: 'clientId (string) is required' }, { status: 400 })
    }
    clientId = body.clientId
    if (typeof body.limit === 'number' && body.limit > 0) {
      limit = Math.min(body.limit, 20)
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // ── 1. Load new anomaly signals ────────────────────────────────────────────
  const { data: signals, error: signalsErr } = await supabaseAdmin
    .from('anomaly_signals')
    .select('id, flywheel, metric_key, rule_id, severity, current_value, baseline_value, pct_change, detected_at')
    .eq('client_id', clientId)
    .eq('status', 'new')
    .order('detected_at', { ascending: false })
    .limit(limit)

  if (signalsErr) {
    return NextResponse.json(
      { error: `Failed to load anomaly signals: ${signalsErr.message}` },
      { status: 500 },
    )
  }

  const rows = (signals ?? []) as AnomalySignalRow[]

  // ── 2. Nothing to process ──────────────────────────────────────────────────
  if (rows.length === 0) {
    return NextResponse.json({
      success:                true,
      processed:              0,
      advisories:             [],
      signals_acknowledged:   0,
      message:               'No new anomaly signals — nothing to advise',
    })
  }

  // ── 3. Build prompt ────────────────────────────────────────────────────────
  const signalList = rows
    .map((s, i) => [
      `Signal ${i + 1} (id: ${s.id}):`,
      `  Flywheel: ${s.flywheel}`,
      `  Metric:   ${s.metric_key}`,
      `  Rule:     ${s.rule_id}`,
      `  Severity: ${s.severity}`,
      `  Current:  ${s.current_value ?? 'n/a'}`,
      `  Baseline: ${s.baseline_value ?? 'n/a'}`,
      `  Change:   ${s.pct_change !== null ? `${s.pct_change.toFixed(1)}%` : 'n/a'}`,
      `  Detected: ${s.detected_at}`,
    ].join('\n'))
    .join('\n\n')

  const systemPrompt = `You are Zhugeliang (诸葛亮), the proactive AI advisor for Magic Engine — a marketing automation platform used by small AU/NZ businesses.

Your role: given a set of anomaly signals (data-driven threshold breaches), generate concise, actionable advisory items for the client's execution board.

RULES:
- Each advisory must address 1–3 closely related signals. Do NOT over-aggregate.
- Be specific and actionable. Example: "GSC click rate dropped 28% week-over-week — refresh meta titles and add FAQ schema to the top 5 pages."
- Assign the correct dimension: seo / ai_visibility / ads / social / reputation / competitor
- Assign the correct fix_type: me_auto (Magic Engine can auto-execute) / fde_manual (FDE does it manually) / third_party (requires a third-party platform action)
- For ads anomalies: fix_type = third_party (Meta Ads Manager)
- For SEO/GEO anomalies: fix_type = me_auto if content generation; fde_manual if structural SEO work
- For social anomalies: fix_type = fde_manual
- Keep title under 80 characters
- Keep description under 300 characters
- signal_ids must include the IDs of the signals this advisory addresses

Return ONLY valid JSON in this exact shape — no markdown, no commentary:
{
  "advisories": [
    {
      "title": "...",
      "description": "...",
      "dimension": "seo",
      "fix_type": "me_auto",
      "severity": "high",
      "signal_ids": ["uuid1", "uuid2"]
    }
  ]
}`

  const userMessage = `Here are the new anomaly signals detected for this client:

${signalList}

Generate advisory execution items. Return JSON only.`

  // ── 4. Call Claude Haiku ───────────────────────────────────────────────────
  let advisories: Advisory[]
  let rawText: string

  try {
    const client = getAnthropicClient()
    const message = await client.messages.create({
      model:      MODEL_HAIKU,
      max_tokens: 1024,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userMessage }],
    })

    rawText = message.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('')

    const parsed = parseJsonResponse<ClaudeAdvisoryResponse>(rawText)
    advisories   = validateAdvisories(parsed.advisories ?? [])
  } catch (err) {
    console.error('[zhugeliang/proactive] Claude call failed:', (err as Error).message)
    return NextResponse.json(
      { error: `AI advisory generation failed: ${(err as Error).message}` },
      { status: 502 },
    )
  }

  if (advisories.length === 0) {
    return NextResponse.json({
      success:              true,
      processed:            rows.length,
      advisories:           [],
      signals_acknowledged: 0,
      message:             'Claude returned no advisories — signals left as new',
    })
  }

  // ── 5. Write execution_items ───────────────────────────────────────────────
  // Map severity → sort_order so high-severity items appear first
  const SEVERITY_ORDER: Record<string, number> = { high: 1, medium: 2, low: 3 }

  const itemsToInsert = advisories.map((adv, idx) => ({
    client_id:         clientId,
    prescription_id:   null,
    finding_id:        null,
    dimension:         adv.dimension,
    title:             adv.title,
    description:       adv.description,
    fix_type:          adv.fix_type,
    status:            'pending',
    source:            'proactive_signal',
    action_type:       `proactive.${adv.dimension}.${adv.severity}`,
    sort_order:        (SEVERITY_ORDER[adv.severity] ?? 3) * 10 + idx,
    // Link to first signal_id in the advisory (for badge tooltip)
    anomaly_signal_id: adv.signal_ids[0] ?? null,
  }))

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('execution_items')
    .insert(itemsToInsert)
    .select('id')

  if (insertErr) {
    console.error('[zhugeliang/proactive] execution_items insert error:', insertErr.message)
    return NextResponse.json(
      { error: `Failed to write advisory items: ${insertErr.message}` },
      { status: 500 },
    )
  }

  // ── 6. Acknowledge signals ────────────────────────────────────────────────
  // Collect all signal IDs referenced by the advisories
  const referencedSignalIds = new Set<string>()
  for (const adv of advisories) {
    for (const sid of adv.signal_ids) {
      referencedSignalIds.add(sid)
    }
  }
  // Also acknowledge all signals we loaded (even if not referenced explicitly)
  for (const row of rows) {
    referencedSignalIds.add(row.id)
  }

  const { error: ackErr } = await supabaseAdmin
    .from('anomaly_signals')
    .update({ status: 'acknowledged', acknowledged_at: new Date().toISOString() })
    .in('id', Array.from(referencedSignalIds))

  if (ackErr) {
    // Non-fatal: advisories are written, signals can be re-processed next run
    console.error('[zhugeliang/proactive] signal acknowledge error:', ackErr.message)
  }

  return NextResponse.json({
    success:              true,
    processed:            rows.length,
    advisories,
    execution_item_ids:   (inserted as { id: string }[]).map(r => r.id),
    signals_acknowledged: referencedSignalIds.size,
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_DIMENSIONS = new Set(['seo', 'ai_visibility', 'ads', 'social', 'reputation', 'competitor'])
const VALID_FIX_TYPES  = new Set(['me_auto', 'fde_manual', 'third_party'])
const VALID_SEVERITIES = new Set(['high', 'medium', 'low'])

function validateAdvisories(raw: unknown[]): Advisory[] {
  return raw.filter((item): item is Advisory => {
    if (!item || typeof item !== 'object') return false
    const a = item as Partial<Advisory>
    return (
      typeof a.title       === 'string' && a.title.trim().length > 0 &&
      typeof a.description === 'string' && a.description.trim().length > 0 &&
      typeof a.dimension   === 'string' && VALID_DIMENSIONS.has(a.dimension) &&
      typeof a.fix_type    === 'string' && VALID_FIX_TYPES.has(a.fix_type) &&
      typeof a.severity    === 'string' && VALID_SEVERITIES.has(a.severity) &&
      Array.isArray(a.signal_ids)
    )
  })
}
