/**
 * 诊断门槛 · 平台默认参数（不是行业先验、不是客户数字）。
 *
 * 行业/客户差异不改这里：客户目标单次成本、主结果最低数走客户配置（ad_strategy_configs），
 * 行业先验（D6）要 ≥2 个客户证据才进剧本（红线 7），本阶段不做。
 * 金额类门槛以账户币种主单位计。
 */

/** 近几天为一个评估窗口（D3/D4/D5/D8） */
export const WINDOW_DAYS = 7

// ── D1 投放卡住 ─────────────────────────────────────────────
/** 预筛：当天花费 < 前 3 天花费中位数 × 这个比例，才去拉小时数据 */
export const D1_PRESCREEN_DROP_RATIO = 0.75
/** 连续零投放至少几小时 */
export const D1_MIN_STALL_HOURS = 3
/** 缺口结束到评估时刻至少几小时（避开报表延迟） */
export const D1_REPORT_LAG_HOURS = 2
/** 夜间低谷（账户时区，含起不含止）：缺口完全落在这里 → not_comparable */
export const D1_NIGHT_START_HOUR = 0
export const D1_NIGHT_END_HOUR = 6
/** 昨天同时段至少这么多比例的小时有投放，才算「昨天同时段在投」 */
export const D1_YESTERDAY_ACTIVE_HOUR_RATIO = 0.5
/** M5：往前看几天，判「连续多天同一时刻停投」；起点相差 ≤ 这个小时数算同一时刻 */
export const D1_REPEAT_LOOKBACK_DAYS = 2
export const D1_REPEAT_HOUR_TOLERANCE = 1

// ── D3 花钱没结果 ───────────────────────────────────────────
/** 窗口花费 ≥ K × 目标单次成本，且单次结果成本 ≥ K × 目标（含零结果）→ 命中 */
export const D3_COST_MULTIPLE = 2

// ── D4 攒了人没收割 ─────────────────────────────────────────
/** 破冰花费下限（账户币种主单位） */
export const D4_MIN_AWARENESS_SPEND = 30
/** 破冰至少投了几天（有花费的天数）才判——刚开投一两天没收割不算问题 */
export const D4_MIN_AWARENESS_DAYS = 3
/** Meta 受众人数显示下限：≤ 它说明人数没法判断 */
export const D4_AUDIENCE_FLOOR = 1000
/** 受众建成不满这么多小时 → not_comparable */
export const D4_AUDIENCE_MIN_AGE_HOURS = 72

// ── D5 钱和结果错配 ─────────────────────────────────────────
/** Benjamini–Hochberg 错误发现率 */
export const D5_FDR_Q = 0.1
/** 花费占比与主结果占比至少差这么多（绝对值）才报 */
export const D5_MIN_SHARE_GAP = 0.15

// ── D9 纯播放目标漏排除 Audience Network（PITFALLS D9） ──────
/** 这些优化目标是"用最低成本换看完/播放次数"，留自动版位时 Meta 会偏爱 Audience Network 奖励视频（假信号）。 */
export const D9_VIEW_OPTIMIZATION_GOALS = ['THRUPLAY', 'VIDEO_VIEW'] as const
/** 窗口内至少有这么多花费才报——刚建还没花钱的广告组不判，避免噪音。 */
export const D9_MIN_WINDOW_SPEND = 1

// ── D7 授权/数据体检 ────────────────────────────────────────
/** 有在投设置但日数据停更超过几天 → 命中 */
export const D7_STALE_DATA_DAYS = 2
/**
 * 内部邮箱域名（日报只许发内部）。2026-09-14 按仓库内实际使用的内部地址核对：
 * magicengine.cloud（默认收发件）、magicengine.com.au、magiclab.com、magiclab.com.au。
 * 另认环境变量 ADMIN_EMAIL_DOMAIN / ADMIN_EMAILS（见 internal-email.ts）。
 */
export const INTERNAL_EMAIL_DOMAINS = ['magicengine.cloud', 'magicengine.com.au', 'magiclab.com', 'magiclab.com.au'] as const
