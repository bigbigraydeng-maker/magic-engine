// P21.J Content Factory — 信号评估 orchestrator(装配 GateContext → decideSignal → 落库)
// fail-closed:任何装配查询失败 → 信号 rejected('gate_data_unavailable'),绝不放行(护栏 4)。

import { supabaseAdmin } from '@/lib/supabase'
import { FACTORY_ANGLE_DEDUPE_DAYS } from './constants'
import { decideSignal } from './strategist'
import type { DemandSignal, Decision, GateContext } from './types'

const OPEN_ORDER_STATUSES_EXCLUDED = ['closed', 'archived', 'dead_letter', 'superseded']

async function loadContext(signal: DemandSignal): Promise<GateContext> {
  const now = new Date()
  const since = new Date(now.getTime() - FACTORY_ANGLE_DEDUPE_DAYS * 86_400_000).toISOString()
  const todayStart = new Date(now)
  todayStart.setUTCHours(0, 0, 0, 0)

  // 开放工单(护栏 11 语义去重 + 角度去重共用)
  const { data: openOrders, error: ooErr } = await supabaseAdmin
    .from('content_work_orders')
    .select('id, angle, created_at, actual_cost_usd, brief, signal_id, status')
    .eq('client_id', signal.client_id)
    .gte('created_at', since)
  if (ooErr) throw new Error(`work_orders query failed: ${ooErr.message}`)

  const open = (openOrders ?? []).filter((o) => !OPEN_ORDER_STATUSES_EXCLUDED.includes(o.status))

  // 开放工单对应信号的 ad_id(护栏 11)
  const openSignalIds = open.map((o) => o.signal_id).filter(Boolean) as string[]
  let openOrderAdIds: string[] = []
  if (openSignalIds.length > 0) {
    const { data: sigs, error: sErr } = await supabaseAdmin
      .from('content_demand_signals')
      .select('evidence')
      .in('id', openSignalIds)
    if (sErr) throw new Error(`signals query failed: ${sErr.message}`)
    openOrderAdIds = (sigs ?? [])
      .map((s) => (s.evidence as Record<string, unknown>)?.['ad_id'])
      .filter((v): v is string => typeof v === 'string')
  }

  // ③ 战略地基(只读):active master_brief + active goal
  const { data: brief, error: bErr } = await supabaseAdmin
    .from('master_briefs')
    .select('id, core_proposition, content_pillars, keyword_seeds, excluded_topics')
    .eq('client_id', signal.client_id)
    .eq('status', 'active')
    .maybeSingle()
  if (bErr) throw new Error(`master_briefs query failed: ${bErr.message}`)

  const { data: goal, error: gErr } = await supabaseAdmin
    .from('goals')
    .select('id, title')
    .eq('client_id', signal.client_id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (gErr) throw new Error(`goals query failed: ${gErr.message}`)

  // 品牌红线 + 工厂配置
  const { data: client, error: cErr } = await supabaseAdmin
    .from('clients')
    .select('brand_redline_phrases, factory_config')
    .eq('id', signal.client_id)
    .maybeSingle()
  if (cErr) throw new Error(`clients query failed: ${cErr.message}`)

  // 角度黑名单
  const { data: blocklist, error: blErr } = await supabaseAdmin
    .from('factory_angle_blocklist')
    .select('angle, permanent, expires_at')
    .eq('client_id', signal.client_id)
  if (blErr) throw new Error(`blocklist query failed: ${blErr.message}`)

  // 活跃 winner 骨架
  const { data: winners, error: wErr } = await supabaseAdmin
    .from('winner_structures')
    .select('id, hook_segment, middle_segment, cta_segment, win_reason_tags, cost_per_thruplay, current_frequency, status')
    .eq('client_id', signal.client_id)
    .eq('status', 'active')
  if (wErr) throw new Error(`winner_structures query failed: ${wErr.message}`)

  // 余额(护栏 10):ledger 结余
  const { data: ledger, error: lErr } = await supabaseAdmin
    .from('factory_balance_ledger')
    .select('amount_usd')
  if (lErr) throw new Error(`balance_ledger query failed: ${lErr.message}`)
  const balanceUsd = (ledger ?? []).reduce((s, r) => s + Number(r.amount_usd ?? 0), 0)

  // 当日配额(护栏 9)
  const todays = open.filter((o) => new Date(o.created_at) >= todayStart)
  const dailyOrderCount = todays.length
  const dailyCostUsd = todays.reduce((s, o) => s + Number(o.actual_cost_usd ?? 0), 0)

  // 素材库存(护栏 1:仅 active)
  const { data: clips, error: clErr } = await supabaseAdmin
    .from('video_clips')
    .select('id, scene_tag, motion_type, track, usage_count, last_used_at')
    .eq('client_id', signal.client_id)
    .eq('status', 'active')
  if (clErr) throw new Error(`video_clips query failed: ${clErr.message}`)

  const factoryConfig = (client?.factory_config ?? {}) as Record<string, unknown>

  return {
    now,
    signal,
    openOrderAdIds,
    brief: brief ?? null,
    goal: goal ?? null,
    brandRedlines: client ? (client.brand_redline_phrases ?? []) : null,
    recentAngles: (openOrders ?? []).map((o) => o.angle).filter(Boolean),
    blocklist: blocklist ?? [],
    activeWinners: winners ?? [],
    balanceUsd,
    dailyOrderCount,
    dailyCostUsd,
    clipStock: clips ?? [],
    allowBTrackLandmarkAds: factoryConfig['allow_b_track_landmark_ads'] === true,
  }
}

async function persistDecision(signal: DemandSignal, decision: Decision): Promise<Decision> {
  if (decision.outcome === 'expired') {
    await supabaseAdmin
      .from('content_demand_signals')
      .update({ status: 'expired' })
      .eq('id', signal.id)
    return decision
  }
  if (decision.outcome === 'rejected') {
    await supabaseAdmin
      .from('content_demand_signals')
      .update({
        status: 'rejected',
        reject_reason: decision.detail ? `${decision.reason}: ${decision.detail}` : decision.reason,
      })
      .eq('id', signal.id)
    return decision
  }

  const draft = decision.workOrder
  const { clip_links, ...orderFields } = draft
  const { data: order, error: insErr } = await supabaseAdmin
    .from('content_work_orders')
    .insert(orderFields)
    .select('id')
    .single()
  if (insErr || !order) throw new Error(`work_order insert failed: ${insErr?.message}`)

  if (clip_links.length > 0) {
    const { error: linkErr } = await supabaseAdmin.from('content_work_order_clips').insert(
      clip_links.map((l) => ({ ...l, work_order_id: order.id })),
    )
    if (linkErr) throw new Error(`clip links insert failed: ${linkErr.message}`)
  }

  await supabaseAdmin
    .from('content_demand_signals')
    .update({ status: 'accepted', work_order_id: order.id })
    .eq('id', signal.id)

  return decision
}

export interface EvaluateResult {
  outcome: Decision['outcome']
  reject_reason?: string
  work_order_id?: string
}

/** 入口:信号落库后调用。任何异常 → 信号 rejected(gate_data_unavailable),fail-closed。 */
export async function evaluateSignal(signalId: string): Promise<EvaluateResult> {
  const { data: signal, error } = await supabaseAdmin
    .from('content_demand_signals')
    .select('*')
    .eq('id', signalId)
    .single()
  if (error || !signal) throw new Error(`signal not found: ${signalId}`)

  await supabaseAdmin
    .from('content_demand_signals')
    .update({ status: 'evaluating' })
    .eq('id', signalId)

  try {
    const ctx = await loadContext(signal as DemandSignal)
    const decision = await persistDecision(signal as DemandSignal, decideSignal(ctx))
    if (decision.outcome === 'accepted') {
      // work_order_id 已回填信号行,读回给调用方
      const { data: updated } = await supabaseAdmin
        .from('content_demand_signals')
        .select('work_order_id')
        .eq('id', signalId)
        .maybeSingle()
      return { outcome: 'accepted', work_order_id: updated?.work_order_id ?? undefined }
    }
    if (decision.outcome === 'rejected') {
      return {
        outcome: 'rejected',
        reject_reason: decision.detail ? `${decision.reason}: ${decision.detail}` : decision.reason,
      }
    }
    return { outcome: 'expired' }
  } catch (e) {
    // fail-closed(护栏 4):装配/落库异常一律 reject,绝不放行
    const msg = e instanceof Error ? e.message : String(e)
    await supabaseAdmin
      .from('content_demand_signals')
      .update({ status: 'rejected', reject_reason: `gate_data_unavailable: ${msg.slice(0, 300)}` })
      .eq('id', signalId)
    return { outcome: 'rejected', reject_reason: `gate_data_unavailable: ${msg.slice(0, 300)}` }
  }
}
