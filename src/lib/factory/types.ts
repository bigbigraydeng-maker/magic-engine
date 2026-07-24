// P21.J Content Factory — shared types
// Spec: docs/superpowers/specs/2026-07-11-content-factory-ads-loop-v0.1.md

export type SignalType =
  | 'creative_fatigue'
  | 'scale_winner'
  | 'new_campaign'
  | 'asset_gap'

export type SignalStatus = 'received' | 'evaluating' | 'accepted' | 'rejected' | 'expired'

export type OrderType = 'variant_from_winner' | 'fresh_angle' | 'clip_generation'

/**
 * 工单状态机单一类型来源(A1 架构整理)。权威定义 = migration content_work_orders.status
 * CHECK 约束(20260711000002)。改此 union 必同步:①DB CHECK ②STATUS_META + STATUS_ORDER
 * (statusMeta.ts,两者都有编译期穷举断言会报错兜底)。这是 CLAUDE.md「改 enum 必全仓
 * grep 同步」的着力点——以前是裸 string,没地方 grep。
 * 分段:M1 生产 → M2 审核 → M3 发布/归因 → 终态。
 */
export type WorkOrderStatus =
  // ⚠️ 'rendered' 已停止产出(2026-07-23):交付直接落 'in_review'。原先靠 factory-review-sweeper
  //    推 Airtable 时才转 in_review,Airtable 退役后那条搬运路径已停,rendered 成死胡同。
  //    保留此值仅为读取历史行,**不要再往里写**——写进去的工单不会出现在任何审片队列。
  | 'queued' | 'claimed' | 'producing' | 'rendered'          // M1/M2 生产
  | 'in_review' | 'review_rejected' | 'approved'             // 审核
  | 'publishing' | 'publish_failed' | 'published' | 'measuring' | 'closed' // M3 发布/归因
  | 'failed' | 'dead_letter' | 'archived' | 'superseded'     // 终态

/** 打回分类(migration content_work_orders.reject_category CHECK) */
export type ReviewRejectCategory = 'brand_redline' | 'quality' | 'wrong_angle' | 'budget' | 'other'

/** winner 入库来源(migration winner_structures.entry_channel CHECK;peer_study 待 B 段加 migration 后并入) */
export type WinnerEntryChannel = 'auto' | 'manual_intake'

export interface DemandSignal {
  id: string
  client_id: string
  signal_type: SignalType
  source: string
  dedupe_key: string | null
  confidence: number | null
  evidence: Record<string, unknown>
  request: Record<string, unknown>
  status: SignalStatus
  expires_at: string | null
  created_at: string
}

/** master_briefs.content_pillars 实库形状 = jsonb 对象数组(2026-07-11 实库验证) */
export interface ContentPillar {
  id?: string
  name?: string
  description?: string
  post_ratio?: number
}

/** §5.1 闸 1 战略地基切片(只读)。content_pillars 兼容对象数组与字符串数组。 */
export interface MasterBriefSlice {
  id: string
  core_proposition: string | null
  content_pillars: Array<ContentPillar | string> | null
  keyword_seeds: string[] | null
  excluded_topics: string[] | null
}

export interface GoalSlice {
  id: string
  title: string | null
  /** 归因桩(B0):工单产出预期服务的北极星指标,进 D 段 flywheel 归因用 */
  primary_metric_key: string | null
}

export interface WinnerSlice {
  id: string
  hook_segment: Record<string, unknown>
  middle_segment: Record<string, unknown>
  cta_segment: Record<string, unknown>
  win_reason_tags: string[]
  cost_per_thruplay: number | null
  current_frequency: number | null
  status: string
}

export interface BlocklistEntry {
  angle: string
  permanent: boolean
  expires_at: string | null
}

export interface ClipSlice {
  id: string
  scene_tag: string
  motion_type: string | null
  track: 'a_real' | 'b_generated'
  usage_count: number
  last_used_at: string | null
}

/**
 * decideSignal 的全部输入。loader(evaluate.ts)负责从 DB 装配;
 * 纯函数核心不碰 DB —— 可测试性 = 护栏可验证性。
 * 任何切片为 null = 对应查询失败/缺失 → 闸 1 fail-closed(护栏 4)。
 */
export interface GateContext {
  now: Date
  signal: DemandSignal
  /** 该 client 所有开放工单对应的 evidence.ad_id(护栏 11 语义去重) */
  openOrderAdIds: string[]
  brief: MasterBriefSlice | null
  goal: GoalSlice | null
  /** null = clients.brand_redline_phrases 查询失败(fail-closed) */
  brandRedlines: string[] | null
  /** 近 14 天全部工单 angle(含打回/归档,魏征 F4) */
  recentAngles: string[]
  blocklist: BlocklistEntry[]
  activeWinners: WinnerSlice[]
  /** factory_balance_ledger 结余;null = 查询失败 */
  balanceUsd: number | null
  /** 该 client 当日已建工单数 / 当日生成成本 */
  dailyOrderCount: number
  dailyCostUsd: number
  clipStock: ClipSlice[]
  /** 附录 A: CTS=true,他客默认 false */
  allowBTrackLandmarkAds: boolean
  /** B4:客户级持久真促销(factory_config.verified_offer),该客户所有活动默认带上;单条活动可用 signal 覆盖 */
  verifiedOffer: VerifiedOffer | null
  /** 客户是否配了叙事人格(master_briefs.brand_voice.persona)→ 选故事型分镜 + 第一人称文案 */
  hasPersona?: boolean
}

export interface AngleSource {
  /** 'inventory_gap' 仅 asset_gap 类工单用:补库存不是创意角度,溯源指向 evidence.scene_tag(魏征 M1-F11) */
  type: 'content_pillar' | 'core_proposition' | 'winner_structure' | 'inventory_gap'
  ref_id: string
  ref_text: string
}

export interface ClipGenerationPlanItem {
  segment_role: 'hook' | 'middle' | 'cta'
  position: number
  scene_tag: string
  motion_type: string
  prompt_hint: string
  /** `{work_order_id占位}:{segment_role}:{position}` — worker 侧防重烧(魏征 F10③) */
  idempotency_key: string
  source_image_url: null
  requires_source_resolution: true
}

/** 段级广告文案(A2:后端生成,品牌接地) */
export interface AdCopySegment {
  role: 'hook' | 'middle' | 'cta'
  title_main?: string
  title_sub?: string
  caption?: string
  vo?: string
}

/** 一条成片的完整广告文案。A2 起由 ME 后端按 master_brief VI 生成,存进 brief.copy;
 *  worker 只读不生成(不再硬编客户/网址)。 */
export interface AdCopy {
  segments: AdCopySegment[]
  endcard: { cta: string; offer: string[]; url: string; vo?: string }
}

/**
 * B4 verified_offer(板桥+魏征):PM/FDE 录入的**客户白纸黑字确认的真实促销事实**。
 * 红线放行通道——文案里的价格/折扣数字只有出现在这里才允许用,否则一律视为 AI 编造被拦。
 * 全部可选字符串,PM 按活动实际填(留空 = 无促销 = 禁一切数字)。走 signal.evidence.verified_offer 传入。
 */
export interface VerifiedOffer {
  /** 现价,如 "$35.50/m²" */
  price_from?: string
  /** 原价,如 "$59/m²"(可选,有则可做 was/now 对比) */
  was_price?: string
  /** 折扣,如 "40% off"(可选) */
  discount?: string
  /** 截止,如 "31 July" / "end of July"(可选) */
  offer_expiry?: string
}

// ── P0.1 发布(publish-worker)────────────────────────────────────────────────

/** 发布目标(clients.factory_config.publish_target 存,FDE 配)。缺 → 不发标失败,绝不猜/误发别客户页。 */
export interface PublishTarget {
  platform: 'facebook' | 'publer'
  /** facebook:页 id(如 Oztop 748077268383005)。token 走 env META_SYSTEM_USER_TOKEN 换页 token */
  page_id?: string
  /** publer:CTS 账号 id */
  publer_account_id?: string
  publer_provider?: string
  /** 防误发(魏征 B9 第三重):期望的客户品牌名,resolveToken 校验 FB 页名 ~ 此值,不符不发 */
  expect_brand?: string
}

/** 发布回执(存 published_ref):幂等对账锚(防"发出去没记上"重发)+ P1 measure 数据源。一次存全。 */
export interface PublishedRef {
  platform: 'facebook' | 'publer'
  page_id?: string
  post_id: string
  video_id?: string
  published_at: string
  permalink?: string
}

/**
 * 发布适配器契约(子牙 B8):publish-worker 主体只认 adapter + 状态机 + 三落库,平台差异全塞进 adapter。
 * 加 CTS = 多写个 PublerAdapter,worker 一行不改。
 */
export interface PublishAdapter {
  readonly platform: 'facebook' | 'publer'
  /**
   * 发布一条成片,返回回执。draft=true 只发草稿/不公开(首测验格式)。
   * onStarted(魏征 B9 防双发):拿到平台 video_id 的第一时间(上传/finish 之前)回调,
   * 让 worker 把 video_id 落本地库当幂等锚——中途崩后重来能靠本地锚判断,不盲目重发。
   */
  publish(args: {
    videoUrl: string
    caption: string
    target: PublishTarget
    idempotencyTag: string
    draft: boolean
    onStarted?: (videoId: string) => Promise<void>
  }): Promise<PublishedRef>
  /** 幂等对账(魏征 B9 防双发):查平台侧该 wo(靠 idempotencyTag)是否已发。已发→回执,未发→null。 */
  findExisting(args: { target: PublishTarget; idempotencyTag: string }): Promise<PublishedRef | null>
}

export interface WorkOrderBrief {
  segments: Array<{
    role: 'hook' | 'middle' | 'cta'
    duration_hint_s: number
    description: string
    clip_ids: string[]
    /** 「转入本段」的转场(ffmpeg xfade 名)。worker 原样下发给 make_promo,
     *  不填则装配层用默认 fade —— 那正是「每条片子转场都一样」的来源。 */
    transition?: string
  }>
  /** 闸 2 预扣制硬数(护栏 8):worker 提交 muapi 前本地强制 check */
  max_new_clips: number
  clip_generation_plan: ClipGenerationPlanItem[]
  aspect_ratio: '9:16'
  notes: string
  /** A2:后端生成的广告文案(品牌接地)。worker 读它装配,不再自己写硬编 CTS 的文案。 */
  copy?: AdCopy
  /** B0 归因桩:这条产出预期服务的 Goal + 北极星指标。诸葛亮红线——每条片天生挂对 Goal
   *  不成孤岛,进 D 段 flywheel_actions 带 goal_id/expected_metric 直接归因。
   *  ⚠️ 权威源约定(诸葛亮 B0 复审):goal_id 的权威源是 content_work_orders 顶层列(一直有),
   *  这里的 goal_id 只是同址镜像;expected_metric 才是本桩的真正新增价值(锁死当时预期指标,
   *  Goal 的 metric 以后可能变)。D 段读 goal 一律读顶层列,brief.attribution 只当 metric 快照。 */
  attribution?: { goal_id: string; expected_metric: string | null }
}

export interface WorkOrderDraft {
  client_id: string
  signal_id: string
  goal_id: string
  master_brief_id: string
  winner_structure_id: string | null
  order_type: OrderType
  angle: string
  angle_source: AngleSource
  rationale_one_liner: string
  brief: WorkOrderBrief
  budget_cap_usd: number
  /** 触发信号的 evidence.ad_id 冗余进工单本表(护栏 11 语义去重直查,不经 signal join;魏征 M1-F2) */
  source_ad_id: string | null
  clip_links: Array<{ clip_id: string; segment_role: 'hook' | 'middle' | 'cta'; position: number }>
}

export type Decision =
  | { outcome: 'expired' }
  | { outcome: 'rejected'; reason: RejectReason; detail?: string }
  | { outcome: 'accepted'; workOrder: WorkOrderDraft }

export type RejectReason =
  | 'duplicate_open_order'
  | 'gate_data_unavailable'
  | 'no_active_brief_or_goal'
  | 'angle_not_traceable'
  | 'brand_redline_hit'
  | 'excluded_topic_hit'
  | 'no_angle_available'
  | 'balance_low'
  | 'daily_order_cap'
  | 'daily_cost_cap'
  | 'rationale_template_failed'
  | 'unsupported_signal'
  /** 价格广告红线:verifiedOffer(真价)客户无真拍(a_real)素材,不许用 AI 底料背书真价 */
  | 'price_ad_needs_real_footage'
