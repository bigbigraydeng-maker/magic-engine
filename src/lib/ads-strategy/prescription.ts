/**
 * P21.K.6 — Prescription layer (DAPE P→E for the ads pillar).
 *
 * Turns a campaign's fatigue verdict into ONE concrete, plain-language
 * prescription, and marks whether ME can execute it in one click.
 *
 * Cause → remedy mapping (the 投放师 logic, spec §12.4):
 *   - CTR decayed but frequency is LOW/flat  → the creative itself went stale
 *     (same people aren't even seeing it twice) → refresh creatives from the
 *     winner pool. EXECUTABLE: winner-sync adds new ads (default PAUSED).
 *   - CTR decayed and frequency is HIGH      → audience is worn out → rotate
 *     audience / lower frequency. Advisory (audience surgery is FDE judgement).
 *   - Cost-per-result blew up while CTR held → funnel/offer problem, not the
 *     ad → review offer & landing flow. Advisory.
 *
 * Budget moves are deliberately NOT prescribed here: budget policy can be
 * locked per client (CTS Track A), and budget is the one lever the engine
 * never pushes on its own.
 */

import type { Verdict, MetricVerdict } from './baseline'
import { resolveAdsPlaybook } from './playbooks'

/** Frequency at/above which decay is read as audience fatigue, not creative age. */
const FREQ_FATIGUE_THRESHOLD = 2.5

export interface Prescription {
  kind: 'refresh_creatives' | 'rotate_audience' | 'review_offer'
  /** PM-facing action, imperative, plain. */
  title: string
  /** Why this remedy matches the diagnosis, plain. */
  why: string
  /** True when ME can perform it in one click (winner-sync path). */
  executable: boolean
  /** What the click actually does — sets expectations before pressing. */
  execute_hint?: string
}

export interface PrescribeInput {
  verdict: Verdict
  metrics: MetricVerdict[]
  frequency_7d: number | null
  /** `clients.industry` — only picks the result noun in the copy. null/unknown → neutral words. */
  industry?: string | null
}

/**
 * Produce the single primary prescription for a campaign, or null when there
 * is nothing to act on (healthy / paused / insufficient history).
 */
export function prescribe(input: PrescribeInput): Prescription | null {
  if (input.verdict !== 'alert' && input.verdict !== 'watch') return null

  const ctrBad = input.metrics.some(
    m => m.metric === 'ctr' && (m.verdict === 'alert' || m.verdict === 'watch'),
  )
  const costBad = input.metrics.some(
    m => m.metric === 'cost_per_result' && (m.verdict === 'alert' || m.verdict === 'watch'),
  )
  const freqHigh = input.frequency_7d != null && input.frequency_7d >= FREQ_FATIGUE_THRESHOLD

  if (ctrBad && freqHigh) {
    return {
      kind: 'rotate_audience',
      title: '换一批人看,别让同一批人反复刷到',
      why: `同一批人平均已看 ${input.frequency_7d!.toFixed(1)} 次且点击率在掉 —— 是观众看腻了,不是素材问题。换素材治不了,要换人群。`,
      executable: false,
      execute_hint: '换人群会改变投给谁,我不自动动。先按住钱(降预算或先停),换人群的方案我来出。',
    }
  }

  if (ctrBad) {
    return {
      kind: 'refresh_creatives',
      // Scope is honest: winner-sync adds into the configured creative pool
      // ad set, which is NOT necessarily this card's campaign (魏征 P1-1,
      // 板桥 #4: say so in the hint too, or the PM thinks the button is broken
      // when THIS campaign doesn't visibly change).
      title: '从爆款池补新素材',
      why: '观众没被打扰过度(频次很低),但点击率持续走低 —— 是素材本身老化失效,补新素材最对症。',
      executable: true,
      execute_hint: '把近期表现最好的内容补进账户统一的爆款广告组(不一定是这张卡这条);新素材一律先暂停、不花钱,你确认开启后才投。',
    }
  }

  if (costBad) {
    return {
      kind: 'review_offer',
      title: '检查报价文案和落地流程',
      why: `点击没变差但${resolveAdsPlaybook(input.industry ?? null).costPerResultLabel}变贵了 —— 问题多半不在广告,在点进去之后(表单/报价/页面)。`,
      executable: false,
      execute_hint: '这要改报价文案和落地页,我不自动动。先按住钱(降预算或先停),改哪里我来查了给你。',
    }
  }

  // Alert/watch escalated by some other path — generic advisory fallback.
  return {
    kind: 'review_offer',
    title: '人工看一眼这条广告',
    why: '这条的数据不太常见,我先去查清楚再给你结论。这期间钱要不要先按住,你决定。',
    executable: false,
  }
}
