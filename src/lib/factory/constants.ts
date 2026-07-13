// P21.J Content Factory — 护栏常量(spec §5.2 护栏总表)

/** 单工单生成成本上限(护栏 8) */
export const FACTORY_ORDER_BUDGET_CAP_USD = 2.0

/** Kling 2.1 720p I2V 实测单价(2026-07 实测 $0.225/条) */
export const FACTORY_CLIP_UNIT_COST_USD = 0.225

/** 预扣制成本 margin(护栏 8) */
export const FACTORY_COST_MARGIN = 0.1

/** 余额低于此值全线停机(护栏 10) */
export const FACTORY_MIN_BALANCE_USD = 10

/** 单客户每日新工单上限(护栏 9) */
export const FACTORY_DAILY_ORDER_CAP = 3

/** 单客户每日生成成本上限(护栏 9) */
export const FACTORY_DAILY_COST_CAP_USD = 5

/** 角度去重回看窗口(护栏 7) */
export const FACTORY_ANGLE_DEDUPE_DAYS = 14

/** 单工单投放预算绝对硬顶(PM 决策 ②:$50/工单,审核「通过」单次确认风险上界) */
export const FACTORY_PUBLISH_BUDGET_HARD_CAP_USD = 50

/** winner 疲劳解锁阈值:frequency > 2.5 才允许撞题材续命(护栏 7) */
export const FACTORY_WINNER_FREQUENCY_UNLOCK = 2.5

/**
 * B 轨(生成式)scene_tag 白名单(板桥 #8 / 护栏 6):
 * 具体地标/门店/产品一律 A 轨实拍;例外走 clients.factory_config.allow_b_track_landmark_ads
 * (附录 A: CTS 已由 PM 显式接受风险放开)。
 */
export const FACTORY_B_TRACK_SCENE_TAGS = [
  'sunset_mood',
  'texture_detail',
  'aerial_abstract',
  'water_reflection',
  'light_bokeh',
  'cloud_timelapse',
] as const

/** 三段式默认时长模板(§5.1 步骤 4) */
/**
 * 分镜方案(治定格+素材单一,PM 反馈"中间 6-10s 定格、素材太单一")。
 * 旧:hook3/middle8/cta3 三段,中段 8s 撑一条 ~5s clip → 6-10s 定格。
 * 新:5 镜,中段拆 3 短镜,每镜 ≤ 最短库存 clip(3.0s)不撑帧;拉 5 条不同场景 = 快节奏 + 不单一。
 * worker 装配再按 clip 实长 min-cap 兜底(双保险,任何短 clip 都不定格)。
 */
export const FACTORY_SHOT_PLAN = [
  { role: 'hook', duration_hint_s: 2.8 },
  { role: 'middle', duration_hint_s: 2.6 },
  { role: 'middle', duration_hint_s: 2.6 },
  { role: 'middle', duration_hint_s: 2.6 },
  { role: 'cta', duration_hint_s: 2.8 },
] as const
