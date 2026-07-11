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
export const FACTORY_SEGMENT_TEMPLATE = {
  hook: 3,
  middle: 8,
  cta: 3,
} as const
