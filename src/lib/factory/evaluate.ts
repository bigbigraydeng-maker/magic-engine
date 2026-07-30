// P21.J Content Factory — 信号评估 orchestrator(装配 GateContext → decideSignal → 落库)
// fail-closed:任何装配查询失败 → 信号 rejected('gate_data_unavailable'),绝不放行(护栏 4)。
// 魏征 M1 评审修订:F2 语义去重直查 source_ad_id 无时间窗 / F4 部分失败收敛 /
// F5 日配额含终态工单 + NZ 日界 / F6 brief 双轨兼容 / F9 余额 SQL 聚合 / F10 全体收进 try。

import { supabaseAdmin } from '@/lib/supabase'
import { FACTORY_ANGLE_DEDUPE_DAYS } from './constants'
import { generateAdCopy } from './copy-generator'
import { compactCreativeProfile, projectCreativeProfile } from './client-config'
import { decideSignal, pickFactoryGoal } from './strategist'
import { detectContentGoal, getViralClipDirective } from '@/lib/reels/viral-style-advisor'
import type { AdCopy, DemandSignal, Decision, GateContext, GoalSlice, VerifiedOffer } from './types'
import type { MasterBrief } from '@/types/magic-engine'

const TERMINAL_STATUSES = ['closed', 'archived', 'dead_letter', 'superseded']

/** 日配额按客户营业日重置(CLAUDE.md:时区默认 NZST 不是 UTC;魏征 M1-F5) */
/** NZ 日界。日配额、自动下单的 dedupe_key 都按这个切天,必须用同一套口径。 */
export function nzDay(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
}

/** video_clips.storage_url(相对路径)→ content-factory bucket 公开 URL;已是完整 URL 直接用。
 *  worker 的 i2v 只接受可下载的公开地址,所以源图必须是 http(s) URL。 */
export function toPublicClipUrl(storageUrl: string | null): string | null {
  if (!storageUrl) return null
  if (/^https?:\/\//i.test(storageUrl)) return storageUrl
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return null // 缺 base 宁可不给,也不拼出一个打不开的地址(worker i2v 会失败)
  return `${base}/storage/v1/object/public/content-factory/${storageUrl.replace(/^\/+/, '')}`
}

async function loadContext(
  signal: DemandSignal,
): Promise<{
  ctx: GateContext
  fullBrief: MasterBrief | null
  industry: string | null
  creativeProfile: Record<string, unknown>
}> {
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
    // industry:查爆款参考库的键(travel / flooring / …)。空 = 拿不到参考,静默跳过。
    .select('brand_redline_phrases, factory_config, industry')
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
    .select('id, scene_tag, motion_type, track, usage_count, last_used_at, storage_url, source_meta')
    .eq('client_id', signal.client_id)
    .eq('status', 'active')
  if (clErr) throw new Error(`video_clips query failed: ${clErr.message}`)

  // 🔴 静图/视频分流(在数据源头,不靠下游记得过滤):
  // 抓来的静图(source_meta.is_still_image=true)只能当 i2v 源图,**绝不能进 clipStock** ——
  // selectClips 会把 clipStock 里的东西当**现成视频**直接塞进 segments,worker 下载静图当
  // mp4 播 = 黑屏。用 JS 分流而非 SQL `.not.eq`:后者对没有该字段的旧真视频行(->>返回 NULL)
  // 会因三值逻辑一并排除,把好素材也滤掉。
  const meta = (c: { source_meta?: unknown }) =>
    ((c.source_meta ?? null) as Record<string, unknown> | null) ?? {}
  const isStill = (c: { source_meta?: unknown }) => meta(c).is_still_image === true
  const allClips = clips ?? []
  const videoClips = allClips.filter((c) => !isStill(c))

  // 🔴 版权隔离:**只有 AI 改过的图能进出片池**。
  // 抓来的原图是别人的作品,只作为改图的输入留在库里,永远不进成片 ——
  // 这是 PM 定的「抓图 → AI 改图(防版权)→ 图转视频」里「防版权」那一步的落点。
  // 绝不能因为「改图失败了就先用原图顶上」而放宽:那等于把版权风险直接发给客户。
  const sourceImagePool = allClips
    .filter((c) => isStill(c) && meta(c).is_ai_transformed === true)
    .map((c) => toPublicClipUrl(c.storage_url as string | null))
    .filter((u): u is string => !!u)

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
    clipStock: videoClips, // 已排除静图:只留真能当片段用的视频
    allowBTrackLandmarkAds: factoryConfig['allow_b_track_landmark_ads'] === true,
    verifiedOffer: parseVerifiedOffer(factoryConfig['verified_offer']), // B4:客户级持久真促销
    // 叙事人格:配了就走故事型分镜 + 第一人称文案(见 copy-generator / shot-recipes)
    hasPersona: Boolean(
      ((fullBrief?.brand_voice ?? null) as { persona?: { name?: string } } | null)?.persona?.name,
    ),
    // i2v 源图池:抓来的静图,喂给 generationPlan 当底图(见 selectClips 源图轮换)
    sourceImagePool,
  }
  return {
    ctx,
    fullBrief: fullBrief ?? null,
    industry: (client?.industry as string | null) ?? null,
    // 出片风格:PM 在 ME 配置页填的,建单时注入 brief 下发给 worker(见 persistDecision)
    creativeProfile: compactCreativeProfile(projectCreativeProfile(factoryConfig['creative_profile'])),
  }
}

/** 去掉指令里的「open with a … hook」分句,只留画面手法(给非首段用)。 */
function stripHookClause(directive: string): string {
  const parts = directive.split(': ')
  if (parts.length < 2) return directive
  const kept = parts.slice(1).join(': ').split('; ').filter((s) => !/^open with a .* hook$/i.test(s.trim()))
  return kept.length > 0 ? `${parts[0]}: ${kept.join('; ')}` : directive
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
  industry: string | null,
  creativeProfile: Record<string, unknown>,
  goal: GateContext['goal'],
  clientOffer: VerifiedOffer | null, // B4:客户级持久 offer,signal 无 override 时用它
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
          // B4:单条活动 signal.evidence 可覆盖;否则用客户级持久 offer
          verifiedOffer: parseVerifiedOffer(signal.evidence?.['verified_offer']) ?? clientOffer,
        })
      }
    } catch (e) {
      console.error(`[factory] copy gen failed (signal ${signal.id}): ${e instanceof Error ? e.message : e}`)
    }

    // B0 归因桩:每条产出天生挂对 Goal + 北极星指标(goal 在 accepted 分支必非 null,gate1 已过)。
    const attribution = goal
      ? { goal_id: draft.goal_id, expected_metric: goal.primary_metric_key }
      : undefined
    // 爆款配方接回工厂:按客户行业查参考库,把「开场钩子 + 高频手法」揉进每个 clip 的
    // 生成提示词。爆款库(606 条)本就是为工厂做的,但一直只挂在 reels 那条产线上,
    // 工厂选角度/写提示词时根本不查 —— 有配方,厨房没用。
    // best-effort:查不到参考(行业为空/该行业无样本)就保持原提示词不变,绝不阻塞建单。
    let clipDirective: string | null = null
    try {
      if (industry) {
        clipDirective = await getViralClipDirective(
          industry,
          // 有真促销数字 = 走转化向的参考;否则品牌向。复用 reels 那套判定,不另立规则。
          detectContentGoal({
            offer: (signal.evidence?.['verified_offer'] ? 'offer' : null) ?? clientOffer?.price_from ?? null,
            campaign_angle: draft.angle,
            channel_goal: goal?.primary_metric_key ?? null,
          }),
        )
      }
    } catch (e) {
      console.error(`[factory] viral directive failed (signal ${signal.id}): ${e instanceof Error ? e.message : e}`)
    }

    // idempotency_key 占位符 → 真实工单 id(魏征 M1-F3:跨工单 key 碰撞会让 worker 张冠李戴复用 clip)
    const needsIdemResolve = draft.brief.clip_generation_plan.length > 0
    const resolvedBrief = {
      ...draft.brief,
      ...(needsIdemResolve
        ? {
            clip_generation_plan: draft.brief.clip_generation_plan.map((p, i) => ({
              ...p,
              idempotency_key: p.idempotency_key.replace('{work_order_id}', order.id),
              // worker 把 prompt_hint 原样喂给 i2v 模型,所以配方必须落在这里才真正生效。
              // ⚠️ 「开场钩子」那半句只给第一段:拼给每一段的话,中段和结尾也会被要求
              // 拍成开场镜头,一条片子里出现三四个开场感画面,节奏直接毁掉。
              prompt_hint: clipDirective
                ? `${p.prompt_hint} — ${i === 0 ? clipDirective : stripHookClause(clipDirective)}`
                : p.prompt_hint,
            })),
          }
        : {}),
      ...(copy ? { copy } : {}),
      ...(attribution ? { attribution } : {}),
      ...(clipDirective ? { viral_style_directive: clipDirective } : {}),
      // 风格下发:worker 优先用它,本地 factory_profile.json 仅在这里为空时兜底。
      // 空对象不写 —— 否则 worker 会以为 ME 显式要求「全用引擎默认」,把本地配置也盖掉。
      ...(Object.keys(creativeProfile).length > 0 ? { creative_profile: creativeProfile } : {}),
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

    const { ctx, fullBrief, industry, creativeProfile } = await loadContext(signal as DemandSignal)
    const decision = decideSignal(ctx)
    const orderId = await persistDecision(signal as DemandSignal, decision, fullBrief, industry, creativeProfile, ctx.goal, ctx.verifiedOffer)

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
