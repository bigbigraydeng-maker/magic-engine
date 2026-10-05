/**
 * 广告级规则 · 疲劳分类（纯函数，无 I/O）。
 *
 * 只回答一个问题：CTR 掉了，是「人看腻了」还是「素材看腻了」？
 * 频率高 → 同一批人反复看 → 受众疲劳；频率不高 → 素材本身衰减 → 素材疲劳。
 */

import { DEFAULT_BASELINE_CONFIG } from '../baseline'

/** Frequency (7-day de-duplicated, campaign level) above which falling CTR reads as audience fatigue. Matches playbook §21 and the meta-ads-ai prompt. */
export const FATIGUE_FREQUENCY_HIGH = 3
/** CTR must fall at least this much vs the ad's own baseline (0.25 = same 0.75 ratio analysis.ts uses). */
export const D2_MIN_CTR_DROP = 0.25
/** Below this own-baseline CTR, CTR carries no fatigue signal (video-style noise). Re-exported from baseline.ts, not a new number. */
export const D2_CTR_SIGNAL_FLOOR: number = DEFAULT_BASELINE_CONFIG.ctrSignalFloor
export const D2_MIN_BASE_IMPRESSIONS = 3000
export const D2_MIN_RECENT_IMPRESSIONS = 500

export type FatigueKind = 'audience' | 'creative' | 'unknown'

/** null or non-finite → 'unknown'; > FATIGUE_FREQUENCY_HIGH → 'audience'; otherwise 'creative'. */
export function classifyFatigue(frequency7d: number | null): FatigueKind {
  if (frequency7d === null || !Number.isFinite(frequency7d)) return 'unknown'
  return frequency7d > FATIGUE_FREQUENCY_HIGH ? 'audience' : 'creative'
}
