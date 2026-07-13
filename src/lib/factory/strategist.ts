// P21.J Content Factory — 策略决策核(纯函数,零 DB 依赖)
// Spec §5:信号 → [闸0 时效+语义去重] → [闸1 战略地基] → [闸2 成本]
//        → [角度去重] → [骨架选取] → [素材选取+A/B分流] → [rationale] → 工单
// 所有护栏编号对照 spec §5.2 护栏总表。fail-closed:数据缺失一律 reject(护栏 4)。

import {
  FACTORY_B_TRACK_SCENE_TAGS,
  FACTORY_CLIP_UNIT_COST_USD,
  FACTORY_COST_MARGIN,
  FACTORY_DAILY_COST_CAP_USD,
  FACTORY_DAILY_ORDER_CAP,
  FACTORY_MIN_BALANCE_USD,
  FACTORY_ORDER_BUDGET_CAP_USD,
  FACTORY_SHOT_PLAN,
  FACTORY_WINNER_FREQUENCY_UNLOCK,
} from './constants'
import type {
  AngleSource,
  ClipGenerationPlanItem,
  ClipSlice,
  Decision,
  GateContext,
  GoalSlice,
  WinnerSlice,
  WorkOrderBrief,
  WorkOrderDraft,
} from './types'

// ── helpers ──────────────────────────────────────────────────────────────────

export function normalizeAngle(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * B0 Goal 圈定(纯函数,零 DB):优先 factory_config.factory_goal_id 指向的 active goal,
 * 指向的 goal 不在 active 列表(归档/删/换客户)则退回最新 active(activeGoals 由调用方按
 * created_at desc 排序,[0]=最新)。诸葛亮红线:禁"盲选最新 Goal"式量产。
 */
export function pickFactoryGoal(configGoalId: unknown, activeGoals: GoalSlice[]): GoalSlice | null {
  if (typeof configGoalId === 'string') {
    const configured = activeGoals.find((g) => g.id === configGoalId)
    if (configured) return configured
  }
  return activeGoals[0] ?? null
}

function containsPhrase(haystack: string, phrase: string): boolean {
  return normalizeAngle(haystack).includes(normalizeAngle(phrase))
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** 信号文本面(角度候选 + notes)——红线/排除话题扫描对象 */
function signalTextSurface(ctx: GateContext): string {
  const req = ctx.signal.request
  const ev = ctx.signal.evidence
  return [asString(req['notes']), asString(req['angle_hint']), asString(ev['campaign_name'])]
    .filter(Boolean)
    .join(' | ')
}

// ── 闸 0 · 时效 + 语义去重(护栏 11,魏征 F6/F15)──────────────────────────────

export function gate0(ctx: GateContext): Decision | null {
  if (ctx.signal.expires_at && new Date(ctx.signal.expires_at).getTime() < ctx.now.getTime()) {
    return { outcome: 'expired' }
  }
  const adId = asString(ctx.signal.evidence['ad_id'])
  if (adId && ctx.openOrderAdIds.includes(adId)) {
    return { outcome: 'rejected', reason: 'duplicate_open_order', detail: `ad_id=${adId}` }
  }
  return null
}

// ── 闸 1 · 战略地基硬闸(护栏 2/3/4/5,板桥 #1 正向溯源为主闸)─────────────────

export function gate1(ctx: GateContext): Decision | null {
  // fail-closed:任何地基切片缺失/查询失败 → reject(护栏 4)。查不到红线 ≠ 没有红线。
  if (ctx.brandRedlines === null) {
    return { outcome: 'rejected', reason: 'gate_data_unavailable', detail: 'brand_redlines query failed' }
  }
  if (!ctx.brief || !ctx.goal) {
    return { outcome: 'rejected', reason: 'no_active_brief_or_goal' }
  }
  // 黑名单副闸:红线短语 + excluded_topics 扫信号文本面
  const surface = signalTextSurface(ctx)
  if (surface) {
    for (const phrase of ctx.brandRedlines) {
      if (phrase && containsPhrase(surface, phrase)) {
        return { outcome: 'rejected', reason: 'brand_redline_hit', detail: phrase }
      }
    }
    for (const topic of ctx.brief.excluded_topics ?? []) {
      if (topic && containsPhrase(surface, topic)) {
        return { outcome: 'rejected', reason: 'excluded_topic_hit', detail: topic }
      }
    }
  }
  return null
}

// ── 闸 2 · 成本护栏(护栏 8/9/10,预扣制)───────────────────────────────────────

export function gate2(ctx: GateContext): Decision | null {
  if (ctx.balanceUsd === null) {
    return { outcome: 'rejected', reason: 'gate_data_unavailable', detail: 'balance ledger query failed' }
  }
  if (ctx.balanceUsd < FACTORY_MIN_BALANCE_USD) {
    return { outcome: 'rejected', reason: 'balance_low', detail: `balance=$${ctx.balanceUsd.toFixed(2)}` }
  }
  if (ctx.dailyOrderCount >= FACTORY_DAILY_ORDER_CAP) {
    return { outcome: 'rejected', reason: 'daily_order_cap' }
  }
  if (ctx.dailyCostUsd >= FACTORY_DAILY_COST_CAP_USD) {
    return { outcome: 'rejected', reason: 'daily_cost_cap' }
  }
  return null
}

/** 预扣制硬数(护栏 8):worker 提交 muapi 前本地强制 check 已提交数 < max_new_clips */
export function maxNewClipsFor(budgetCapUsd: number): number {
  return Math.max(0, Math.floor(budgetCapUsd / (1 + FACTORY_COST_MARGIN) / FACTORY_CLIP_UNIT_COST_USD))
}

// ── 角度选取 + 去重(护栏 2/7)──────────────────────────────────────────────────

interface AnglePick {
  angle: string
  source: AngleSource
}

function isBlocked(ctx: GateContext, angle: string): boolean {
  const n = normalizeAngle(angle)
  if (ctx.recentAngles.some((a) => normalizeAngle(a) === n)) return true
  for (const b of ctx.blocklist) {
    if (normalizeAngle(b.angle) !== n) continue
    if (b.permanent) return true
    if (!b.expires_at || new Date(b.expires_at).getTime() > ctx.now.getTime()) return true
  }
  // 防撞 active winner 题材(护栏 7):frequency ≤ 2.5 的在跑赢家题材不做,> 2.5 解锁续命
  for (const w of ctx.activeWinners) {
    const theme = asString((w.hook_segment ?? {})['description'])
    if (!theme || normalizeAngle(theme) !== n) continue
    const freq = w.current_frequency
    if (freq === null || freq <= FACTORY_WINNER_FREQUENCY_UNLOCK) return true
  }
  return false
}

/**
 * 候选角度文本自身过红线/排除话题扫描(魏征 M1-F8):
 * winner hookDesc 未来源于 Airtable 人工录入,brief 条目也可能踩线,
 * 而 angle 会内插进 rationale 流向客户可见叙事 —— 候选级拦截。
 */
function angleTextClean(ctx: GateContext, text: string): boolean {
  for (const phrase of ctx.brandRedlines ?? []) {
    if (phrase && containsPhrase(text, phrase)) return false
  }
  for (const topic of ctx.brief?.excluded_topics ?? []) {
    if (topic && containsPhrase(text, topic)) return false
  }
  return true
}

/**
 * 正向溯源(板桥 #1 主闸):角度必须指向 brief 具体条目或 winner 来源。
 * 黑名单永远列不全没发生过的编造,只有正向溯源防得住(两次历史事故教训)。
 */
export function pickAngle(ctx: GateContext, winner: WinnerSlice | null): AnglePick | Decision {
  const brief = ctx.brief
  if (!brief) return { outcome: 'rejected', reason: 'no_active_brief_or_goal' }

  // variant_from_winner:骨架即溯源
  if (winner) {
    const tagText = winner.win_reason_tags.join(', ') || 'proven structure'
    const hookDesc = asString((winner.hook_segment ?? {})['description']) ?? tagText
    const angle = `winner-variant: ${hookDesc}`
    if (!isBlocked(ctx, angle) && angleTextClean(ctx, angle)) {
      return {
        angle,
        source: { type: 'winner_structure', ref_id: winner.id, ref_text: hookDesc },
      }
    }
    // 骨架角度撞车/踩线 → 落回 brief 溯源的 fresh 角度
  }

  // fresh_angle / new_campaign / asset_gap:强制溯源 brief 具体条目(护栏 2)
  // content_pillars 实库为 jsonb 对象数组 {id,name,description}(2026-07-11 实库验证),兼容纯字符串
  const candidates: AnglePick[] = []
  ;(brief.content_pillars ?? []).forEach((p, i) => {
    const name = typeof p === 'string' ? p : (p?.name ?? '')
    if (!name) return
    const refId = typeof p === 'object' && p?.id ? `content_pillars.${p.id}` : `content_pillars[${i}]`
    candidates.push({ angle: name, source: { type: 'content_pillar', ref_id: refId, ref_text: name } })
  })
  ;(brief.keyword_seeds ?? []).forEach((k, i) => {
    if (k) candidates.push({ angle: k, source: { type: 'keyword_seed', ref_id: `keyword_seeds[${i}]`, ref_text: k } })
  })
  if (brief.core_proposition) {
    candidates.push({
      angle: brief.core_proposition,
      source: { type: 'core_proposition', ref_id: 'core_proposition', ref_text: brief.core_proposition },
    })
  }

  if (candidates.length === 0) {
    return { outcome: 'rejected', reason: 'angle_not_traceable', detail: 'brief has no traceable entries' }
  }
  const pick = candidates.find((c) => !isBlocked(ctx, c.angle) && angleTextClean(ctx, c.angle))
  if (!pick) {
    return { outcome: 'rejected', reason: 'no_angle_available', detail: 'all traceable angles deduped/blocked' }
  }
  return pick
}

// ── 骨架选取(§5.1 步骤 4)─────────────────────────────────────────────────────

export function pickWinner(ctx: GateContext): WinnerSlice | null {
  const reuse = ctx.signal.request['reuse_winner_structure']
  if (reuse === false) return null
  if (ctx.signal.signal_type === 'new_campaign' || ctx.signal.signal_type === 'asset_gap') return null
  const active = ctx.activeWinners
    .filter((w) => w.status === 'active')
    .sort((a, b) => (a.cost_per_thruplay ?? Infinity) - (b.cost_per_thruplay ?? Infinity))
  return active[0] ?? null
}

// ── 素材选取 + A/B 轨分流(护栏 1/6,§5.1 步骤 5)──────────────────────────────

const B_TRACK_WHITELIST: readonly string[] = FACTORY_B_TRACK_SCENE_TAGS

function clipAllowed(ctx: GateContext, clip: ClipSlice): boolean {
  if (clip.track === 'a_real') return true
  if (B_TRACK_WHITELIST.includes(clip.scene_tag)) return true
  // B 轨具体地标:仅当客户显式接受风险(附录 A: CTS)
  return ctx.allowBTrackLandmarkAds
}

interface ClipSelection {
  segments: WorkOrderBrief['segments']
  clipLinks: WorkOrderDraft['clip_links']
  generationPlan: ClipGenerationPlanItem[]
}

/** scene_tag 与角度的 token 重叠度(魏征 M1-F12:素材必须优先匹配角度,防货不对题) */
function sceneAngleOverlap(sceneTag: string, angle: string): number {
  const angleTokens = new Set(normalizeAngle(angle).split(/[^a-z0-9一-鿿]+/).filter(Boolean))
  const sceneTokens = sceneTag.toLowerCase().split(/[^a-z0-9一-鿿]+/).filter(Boolean)
  return sceneTokens.filter((t) => angleTokens.has(t)).length
}

export function selectClips(ctx: GateContext, angle: string): ClipSelection {
  // 匹配角度优先(token 重叠 desc),同分冷素材优先(usage asc, last_used asc)防审美疲劳
  const pool = ctx.clipStock
    .filter((c) => clipAllowed(ctx, c))
    .sort((a, b) => {
      const ov = sceneAngleOverlap(b.scene_tag, angle) - sceneAngleOverlap(a.scene_tag, angle)
      if (ov !== 0) return ov
      if (a.usage_count !== b.usage_count) return a.usage_count - b.usage_count
      const at = a.last_used_at ? new Date(a.last_used_at).getTime() : 0
      const bt = b.last_used_at ? new Date(b.last_used_at).getTime() : 0
      return at - bt
    })

  const segments: WorkOrderBrief['segments'] = []
  const clipLinks: WorkOrderDraft['clip_links'] = []
  const generationPlan: ClipGenerationPlanItem[] = []
  const used = new Set<string>()
  // 按 scene_tag(内容身份)去重,不止 clip.id:同一场景多行(如 bath1_factory×2 同源不同 id)
  // 不能跨镜重复出镜,否则成片「素材单一」。distinct 场景不够 → 该镜 generationPlan 补生成。
  const usedScenes = new Set<string>()

  // 5 镜方案(中段拆 3 短镜):每镜拉一条不同场景 clip = 治定格 + 素材单一 + 太平(护栏 2/7)
  FACTORY_SHOT_PLAN.forEach((shot, i) => {
    const role = shot.role
    const clip = pool.find((c) => !used.has(c.id) && !(c.scene_tag && usedScenes.has(c.scene_tag)))
    if (clip) {
      used.add(clip.id)
      if (clip.scene_tag) usedScenes.add(clip.scene_tag)
      segments.push({
        role,
        duration_hint_s: shot.duration_hint_s,
        description: `${role} — ${clip.scene_tag}`,
        clip_ids: [clip.id],
      })
      clipLinks.push({ clip_id: clip.id, segment_role: role, position: i })
    } else {
      // 库存不足 → 同工单附 clip_generation_plan(idempotency_key 防重烧,魏征 F10③)
      segments.push({
        role,
        duration_hint_s: shot.duration_hint_s,
        description: `${role} — to generate for angle: ${angle}`,
        clip_ids: [],
      })
      generationPlan.push({
        segment_role: role,
        position: i,
        scene_tag: 'pending_resolution',
        motion_type: role === 'hook' ? 'push_in' : role === 'middle' ? 'lateral_truck' : 'pull_back',
        prompt_hint: `${angle} — ${role} segment, real motion, 9:16 vertical`,
        idempotency_key: `{work_order_id}:${role}:${i}`,
        source_image_url: null,
        requires_source_resolution: true,
      })
    }
  })

  return { segments, clipLinks, generationPlan }
}

// ── rationale 模板(护栏 19,板桥 #4:模板化,不许 AI 自由发挥)────────────────

export function buildRationale(ctx: GateContext, angle: string): string | null {
  const ev = ctx.signal.evidence
  const req = ctx.signal.request
  const metrics = (ev['metrics'] ?? {}) as Record<string, unknown>
  switch (ctx.signal.signal_type) {
    case 'creative_fatigue': {
      const freq = asNumber(metrics['frequency'])
      return `你的王牌广告看腻了(观众平均看到 ${freq !== null ? freq.toFixed(1) : '多'} 次),我们用同一套获客结构换了新画面`
    }
    case 'scale_winner': {
      const n = asNumber(req['desired_variant_count']) ?? 1
      return `你的赢家广告表现出色,我们做了 ${n} 条同结构变体,分摊疲劳、放大效果`
    }
    case 'new_campaign': {
      const campaign = asString(ev['campaign_name']) ?? asString(req['notes'])
      if (!campaign) return null // 模板填不出人话 → reject(护栏 19)
      return `新推广「${campaign}」上线,我们按你品牌主线「${angle}」准备了首批创意`
    }
    case 'asset_gap': {
      const scene = asString(ev['scene_tag'])
      if (!scene) return null
      return `素材库「${scene}」画面储备不足,我们补充生产了新素材备用`
    }
    default:
      return null
  }
}

// ── 主决策流(§5.1)────────────────────────────────────────────────────────────

/**
 * asset_gap 独立分支(魏征 M1-F11):spec §3.2「只出 clip 生成工单,不出成片」——
 * 不挂既有 clip、不烧 brief 角度进去重窗、scene_tag 取自 evidence。
 */
function decideAssetGap(ctx: GateContext): Decision {
  const brief = ctx.brief!
  const goal = ctx.goal!
  const scene = asString(ctx.signal.evidence['scene_tag'])
  if (!scene) {
    return { outcome: 'rejected', reason: 'rationale_template_failed', detail: 'asset_gap missing evidence.scene_tag' }
  }
  const rationale = buildRationale(ctx, scene)
  if (!rationale) return { outcome: 'rejected', reason: 'rationale_template_failed' }

  const budgetCap = FACTORY_ORDER_BUDGET_CAP_USD
  const desired = asNumber(ctx.signal.request['desired_variant_count']) ?? 1
  const count = Math.min(Math.max(desired, 1), maxNewClipsFor(budgetCap))
  const motion = asString(ctx.signal.request['motion_type']) ?? 'push_in'

  return {
    outcome: 'accepted',
    workOrder: {
      client_id: ctx.signal.client_id,
      signal_id: ctx.signal.id,
      goal_id: goal.id,
      master_brief_id: brief.id,
      winner_structure_id: null,
      order_type: 'clip_generation',
      angle: `asset_gap:${scene}`,
      angle_source: { type: 'inventory_gap', ref_id: 'evidence.scene_tag', ref_text: scene },
      rationale_one_liner: rationale,
      brief: {
        segments: [],
        max_new_clips: maxNewClipsFor(budgetCap),
        clip_generation_plan: Array.from({ length: count }, (_, i) => ({
          segment_role: 'middle' as const,
          position: i,
          scene_tag: scene,
          motion_type: motion,
          prompt_hint: `${scene} — b-roll clip, real motion, 9:16 vertical`,
          idempotency_key: `{work_order_id}:middle:${i}`,
          source_image_url: null,
          requires_source_resolution: true as const,
        })),
        aspect_ratio: '9:16',
        notes: asString(ctx.signal.request['notes']) ?? '',
      },
      budget_cap_usd: budgetCap,
      source_ad_id: asString(ctx.signal.evidence['ad_id']),
      clip_links: [],
    },
  }
}

export function decideSignal(ctx: GateContext): Decision {
  const g0 = gate0(ctx)
  if (g0) return g0
  const g1 = gate1(ctx)
  if (g1) return g1
  const g2 = gate2(ctx)
  if (g2) return g2

  // gate1 通过后 brief/goal 必非空(TS 收窄)
  const brief = ctx.brief!
  const goal = ctx.goal!

  if (ctx.signal.signal_type === 'asset_gap') return decideAssetGap(ctx)

  const winner = pickWinner(ctx)
  const anglePick = pickAngle(ctx, winner)
  if ('outcome' in anglePick) return anglePick

  const rationale = buildRationale(ctx, anglePick.angle)
  if (!rationale) {
    return { outcome: 'rejected', reason: 'rationale_template_failed' }
  }

  const budgetCap = FACTORY_ORDER_BUDGET_CAP_USD
  const { segments, clipLinks, generationPlan } = selectClips(ctx, anglePick.angle)

  const orderType =
    winner && anglePick.source.type === 'winner_structure' ? 'variant_from_winner' : 'fresh_angle'

  const briefPayload: WorkOrderBrief = {
    segments,
    max_new_clips: maxNewClipsFor(budgetCap),
    clip_generation_plan: generationPlan,
    aspect_ratio: '9:16',
    notes: asString(ctx.signal.request['notes']) ?? '',
  }

  return {
    outcome: 'accepted',
    workOrder: {
      client_id: ctx.signal.client_id,
      signal_id: ctx.signal.id,
      goal_id: goal.id,
      master_brief_id: brief.id,
      winner_structure_id: orderType === 'variant_from_winner' ? winner!.id : null,
      order_type: orderType,
      angle: anglePick.angle,
      angle_source: anglePick.source,
      rationale_one_liner: rationale,
      brief: briefPayload,
      budget_cap_usd: budgetCap,
      source_ad_id: asString(ctx.signal.evidence['ad_id']),
      clip_links: clipLinks,
    },
  }
}
