// P21.J Content Factory — 信号评估 orchestrator(装配 GateContext → decideSignal → 落库)
// fail-closed:任何装配查询失败 → 信号 rejected('gate_data_unavailable'),绝不放行(护栏 4)。
// 魏征 M1 评审修订:F2 语义去重直查 source_ad_id 无时间窗 / F4 部分失败收敛 /
// F5 日配额含终态工单 + NZ 日界 / F6 brief 双轨兼容 / F9 余额 SQL 聚合 / F10 全体收进 try。

import { supabaseAdmin } from '@/lib/supabase'
import { FACTORY_ANGLE_DEDUPE_DAYS } from './constants'
import { generateAdCopy } from './copy-generator'
import { decideSignal, pickFactoryGoal } from './strategist'
import type { AdCopy, DemandSignal, Decision, GateContext, GoalSlice, VerifiedOffer } from './types'
import type { MasterBrief } from '@/types/magic-engine'

const TERMINAL_STATUSES = ['closed', 'archived', 'dead_letter', 'superseded']

/** 日配额按客户营业日重置(CLAUDE.md:时区默认 NZST 不是 UTC;魏征 M1-F5) */
function nzDay(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
}

async function loadContext(
  signal: DemandSignal,
): Promise<{ ctx: GateContext; fullBrief: MasterBrief | null }> {
  const now = new Date()
  const since = new Date(now.getTime() - FACTORY_ANGLE_DEDUPE_DAYS * 86_400_000).toISOString()

  // 护栏 11 语义去重:直查工单本表 source_ad_id,不带时间窗、不经 signal join(魏征 M1-F2)
  const adId = typeof signal.evidence['ad_id'] === 'string' ? (signal.evidence['ad_id'] as string) : null
  let openOrderAdIds: string[] = []
  if (adId) {
    const { data: dupOrders, error: dupErr } = await supabaseAdmin
      .from('content_work_orders')
      .select('source_ad_id, status')
      .eq('client_id', signal.client_id)
      .eq('source_ad_id', adId)
    if (dupErr) throw new Error(`open-order dedupe query failed: ${dupErr.message}`)
    openOrderAdIds = (dupOrders ?? [])
      .filter((o) => !TERMINAL_STATUSES.includes(o.status))
      .map((o) => o.source_ad_id as string)
  }

  // 近 14 天全部工单(角度去重含打回/归档,魏征 F4;同时供日配额统计)
  const { data: recentOrders, error: roErr } = await supabaseAdmin
    .from('content_work_orders')
    .select('angle, created_at, actual_cost_usd, status')
    .eq('client_id', signal.client_id)
    .gte('created_at', since)
  if (roErr) throw new Error(`work_orders query failed: ${roErr.message}`)

  // ③ 战略地基(只读):active master_brief(双轨兼容:status='active' 或旧行 is_active=true,
  // 取最高 version;魏征 M1-F6)。A3:一次查全字段,strategist 用窄切片、copy 生成用 full brief,
  // 消掉 persistDecision 里的第二次查(魏征 A2-§5)。
  const { data: fullBrief, error: bErr } = await supabaseAdmin
    .from('master_briefs')
    .select('*')
    .eq('client_id', signal.client_id)
    .or('status.eq.active,is_active.eq.true')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (bErr) throw new Error(`master_briefs query failed: ${bErr.message}`)
  // strategist 只需这 4 个战略字段(GateContext.brief 契约不变)
  const brief = fullBrief
    ? {
        id: fullBrief.id,
        core_proposition: fullBrief.core_proposition,
        content_pillars: fullBrief.content_pillars,
        keyword_seeds: fullBrief.keyword_seeds,
        excluded_topics: fullBrief.excluded_topics,
      }
    : null

  // client 先查(拿 factory_config,含 B0 圈定的 factory_goal_id)
  const { data: client, error: cErr } = await supabaseAdmin
    .from('clients')
    .select('brand_redline_phrases, factory_config')
    .eq('id', signal.client_id)
    .maybeSingle()
  if (cErr) throw new Error(`clients query failed: ${cErr.message}`)

  // B0 Goal 圈定(诸葛亮红线:禁"选最新 Goal"盲量产,产出必须挂对客户真正想推的 Goal)。
  // 一次查全部 active goal(desc),纯函数 pickFactoryGoal 挑:优先 factory_config.factory_goal_id,
  // 指向的 goal 不在 active 列表(归档/删/换客户)则退回最新 active(fail-safe)。
  const { data: activeGoals, error: gErr } = await supabaseAdmin
    .from('goals')
    .select('id, title, primary_metric_key')
    .eq('client_id', signal.client_id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
  if (gErr) throw new Error(`goals query failed: ${gErr.message}`)
  const configGoalId = ((client?.factory_config ?? {}) as Record<string, unknown>)['factory_goal_id']
  const goal = pickFactoryGoal(configGoalId, (activeGoals ?? []) as GoalSlice[])

  const { data: blocklist, error: blErr } = await supabaseAdmin
    .from('factory_angle_blocklist')
    .select('angle, permanent, expires_at')
    .eq('client_id', signal.client_id)
  if (blErr) throw new Error(`blocklist query failed: ${blErr.message}`)

  const { data: winners, error: wErr } = await supabaseAdmin
    .from('winner_structures')
    .select('id, hook_segment, middle_segment, cta_segment, win_reason_tags, cost_per_thruplay, current_frequency, status')
    .eq('client_id', signal.client_id)
    .eq('status', 'active')
  if (wErr) throw new Error(`winner_structures query failed: ${wErr.message}`)

  // 余额(护栏 10):SQL 层聚合,避免 supabase-js 1000 行静默截断(魏征 M1-F9)
  const { data: balance, error: lErr } = await supabaseAdmin.rpc('factory_balance_usd')
  if (lErr) throw new Error(`balance rpc failed: ${lErr.message}`)

  // 日配额(护栏 9):当日全量工单**含终态**(魏征 M1-F5:打回/归档不逃分母),NZ 日界
  const today = nzDay(now)
  const todays = (recentOrders ?? []).filter((o) => nzDay(new Date(o.created_at)) === today)
  const dailyOrderCount = todays.length
  const dailyCostUsd = todays.reduce((s, o) => s + Number(o.actual_cost_usd ?? 0), 0)

  const { data: clips, error: clErr } = await supabaseAdmin
    .from('video_clips')
    .select('id, scene_tag, motion_type, track, usage_count, last_used_at')
    .eq('client_id', signal.client_id)
    .eq('status', 'active')
  if (clErr) throw new Error(`video_clips query failed: ${clErr.message}`)

  const factoryConfig = (client?.factory_config ?? {}) as Record<string, unknown>

  const ctx: GateContext = {
    now,
    signal,
    openOrderAdIds,
    brief: brief ?? null,
    goal: goal ?? null,
    brandRedlines: client ? (client.brand_redline_phrases ?? []) : null,
    recentAngles: (recentOrders ?? []).map((o) => o.angle).filter(Boolean),
    blocklist: blocklist ?? [],
    activeWinners: winners ?? [],
    balanceUsd: typeof balance === 'number' ? balance : Number(balance ?? NaN) || null,
    dailyOrderCount,
    dailyCostUsd,
    clipStock: clips ?? [],
    allowBTrackLandmarkAds: factoryConfig['allow_b_track_landmark_ads'] === true,
  }
  return { ctx, fullBrief: fullBrief ?? null }
}

/** B4:从 signal.evidence.verified_offer 安全提取 PM 录入的真实促销(只取非空字符串字段,防脏数据)。 */
function parseVerifiedOffer(raw: unknown): VerifiedOffer | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  // 防 prompt 注入(魏征 B4-P2):evidence 是外部 POST 可控,剥换行 + 限长(价格/折扣/日期本就是短串)。
  const pick = (k: string): string | undefined => {
    if (typeof o[k] !== 'string') return undefined
    const cleaned = (o[k] as string).replace(/[\r\n]+/g, ' ').trim().slice(0, 40)
    return cleaned || undefined
  }
  const offer: VerifiedOffer = {
    price_from: pick('price_from'),
    was_price: pick('was_price'),
    discount: pick('discount'),
    offer_expiry: pick('offer_expiry'),
  }
  return offer.price_from || offer.was_price || offer.discount || offer.offer_expiry ? offer : null
}

async function persistDecision(
  signal: DemandSignal,
  decision: Decision,
  fullBrief: MasterBrief | null,
  goal: GateContext['goal'],
): Promise<string | null> {
  if (decision.outcome === 'expired') {
    await supabaseAdmin.from('content_demand_signals').update({ status: 'expired' }).eq('id', signal.id)
    return null
  }
  if (decision.outcome === 'rejected') {
    await supabaseAdmin
      .from('content_demand_signals')
      .update({
        status: 'rejected',
        reject_reason: decision.detail ? `${decision.reason}: ${decision.detail}` : decision.reason,
      })
      .eq('id', signal.id)
    return null
  }

  const draft = decision.workOrder
  const { clip_links, ...orderFields } = draft
  const { data: order, error: insErr } = await supabaseAdmin
    .from('content_work_orders')
    .insert(orderFields)
    .select('id')
    .single()
  if (insErr || !order) throw new Error(`work_order insert failed: ${insErr?.message}`)

  // insert 之后任何一步失败 → 工单收敛为 failed,不留孤儿 queued 单被 worker 烧钱(魏征 M1-F4)
  try {
    // A2 脑子收回后端:按 master_brief 品牌接地生成广告文案存进 brief.copy,worker 不再自己写。
    // best-effort:失败(LLM/查 brief)不阻塞建单,copy 缺省时 worker 有品牌无关兜底。
    let copy: AdCopy | undefined
    try {
      if (fullBrief) {
        copy = await generateAdCopy({
          brief: fullBrief,
          angle: draft.angle,
          rationale: draft.rationale_one_liner,
          segmentRoles: draft.brief.segments.map((s) => s.role),
          expectedMetric: goal?.primary_metric_key, // B3:CTA 导向圈定 Goal 北极星(诸葛亮硬验收)
          verifiedOffer: parseVerifiedOffer(signal.evidence?.['verified_offer']), // B4:真促销真数字进钩子
        })
      }
    } catch (e) {
      console.error(`[factory] copy gen failed (signal ${signal.id}): ${e instanceof Error ? e.message : e}`)
    }

    // B0 归因桩:每条产出天生挂对 Goal + 北极星指标(goal 在 accepted 分支必非 null,gate1 已过)。
    const attribution = goal
      ? { goal_id: draft.goal_id, expected_metric: goal.primary_metric_key }
      : undefined
    // idempotency_key 占位符 → 真实工单 id(魏征 M1-F3:跨工单 key 碰撞会让 worker 张冠李戴复用 clip)
    const needsIdemResolve = draft.brief.clip_generation_plan.length > 0
    const resolvedBrief = {
      ...draft.brief,
      ...(needsIdemResolve
        ? {
            clip_generation_plan: draft.brief.clip_generation_plan.map((p) => ({
              ...p,
              idempotency_key: p.idempotency_key.replace('{work_order_id}', order.id),
            })),
          }
        : {}),
      ...(copy ? { copy } : {}),
      ...(attribution ? { attribution } : {}),
    }
    const { error: upErr } = await supabaseAdmin
      .from('content_work_orders')
      .update({ brief: resolvedBrief })
      .eq('id', order.id)
    if (upErr) throw new Error(`brief resolve/copy/attribution update failed: ${upErr.message}`)

    if (clip_links.length > 0) {
      const { error: linkErr } = await supabaseAdmin
        .from('content_work_order_clips')
        .insert(clip_links.map((l) => ({ ...l, work_order_id: order.id })))
      if (linkErr) throw new Error(`clip links insert failed: ${linkErr.message}`)
    }

    const { error: sigErr } = await supabaseAdmin
      .from('content_demand_signals')
      .update({ status: 'accepted', work_order_id: order.id })
      .eq('id', signal.id)
    if (sigErr) throw new Error(`signal accept update failed: ${sigErr.message}`)
  } catch (e) {
    await supabaseAdmin
      .from('content_work_orders')
      .update({ status: 'failed', reject_reason: 'persist_incomplete' })
      .eq('id', order.id)
    throw e
  }

  return order.id
}

export interface EvaluateResult {
  outcome: Decision['outcome']
  reject_reason?: string
  work_order_id?: string
}

/**
 * 入口:信号落库后调用。全体收进 try(魏征 M1-F10):
 * 任何异常 → 尽力把信号收敛为 rejected(gate_data_unavailable),自身绝不 throw。
 */
export async function evaluateSignal(signalId: string): Promise<EvaluateResult> {
  try {
    const { data: signal, error } = await supabaseAdmin
      .from('content_demand_signals')
      .select('*')
      .eq('id', signalId)
      .single()
    if (error || !signal) throw new Error(`signal not found: ${signalId}`)

    await supabaseAdmin.from('content_demand_signals').update({ status: 'evaluating' }).eq('id', signalId)

    const { ctx, fullBrief } = await loadContext(signal as DemandSignal)
    const decision = decideSignal(ctx)
    const orderId = await persistDecision(signal as DemandSignal, decision, fullBrief, ctx.goal)

    if (decision.outcome === 'accepted') {
      return { outcome: 'accepted', work_order_id: orderId ?? undefined }
    }
    if (decision.outcome === 'rejected') {
      return {
        outcome: 'rejected',
        reject_reason: decision.detail ? `${decision.reason}: ${decision.detail}` : decision.reason,
      }
    }
    return { outcome: 'expired' }
  } catch (e) {
    // fail-closed(护栏 4):装配/落库异常一律 reject,绝不放行;收敛动作本身失败也不上抛
    const msg = e instanceof Error ? e.message : String(e)
    const reason = `gate_data_unavailable: ${msg.slice(0, 300)}`
    try {
      await supabaseAdmin
        .from('content_demand_signals')
        .update({ status: 'rejected', reject_reason: reason })
        .eq('id', signalId)
    } catch {
      // 信号可能卡在 received/evaluating —— M2 sweeper 兜底;此处不再抛
    }
    return { outcome: 'rejected', reject_reason: reason }
  }
}
