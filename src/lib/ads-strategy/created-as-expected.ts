/**
 * 建完回读之后，对一遍「我们要建的，是不是真的建成了这样」。纯函数，不联网。
 *
 * ── 跟 `launch-readback.checkLaunch` 分工 ────────────────────────────────
 * `checkLaunch` 查的是「已知的坑」（多语言混放、重定向被放宽……），它不知道我们
 * **想要**什么，所以有三类事它天生查不出来：
 *   1. 全程 PAUSED。创建时我们传了 PAUSED，但没有任何一步回头确认它真的是。
 *   2. 目标 / 落点。名字叫私信、实际落成别的，数据上完全看不出来。
 *   3. 广告条数。刚建完回读有最终一致性窗口，读到 0 条时 `checkLaunch` 会因为
 *      「没有创意 = 没有可查的东西」而放行。
 * 这几条都只在「调用方声明了期望」时才有意义，所以单独成文件，不扩
 * `checkLaunch` 的入参，现有的每日巡检路径行为不变。
 *
 * 目前只有私信类型调用。出的全是 blocker：它们说的都是「建出来的东西不是我们
 * 想要的」，不是风险提示。
 */

import type { LaunchFinding } from './launch-readback'
import type { MetaObjectiveTriplet } from './ad-draft'
import type { RawMetaAdSet, RawMetaAdCreative } from './meta-readback-adapter'
import { findRedlineHits } from './draft-redlines'

export interface CreatedExpectation {
  optimizationGoal: MetaObjectiveTriplet['optimizationGoal']
  destinationType: MetaObjectiveTriplet['destinationType']
  /** 我们建出来的广告条数（`adIds.length`）。 */
  adCount: number
  /** 客户禁用词。空数组 = 查过、没配。 */
  brandRedlines: readonly string[]
}

export interface CreatedReadback {
  /** 系列的 status。读不到是 null —— 读不到 ≠ 暂停着。 */
  campaignStatus: string | null
  adSet: RawMetaAdSet
  ads: readonly RawMetaAdCreative[]
}

const isPaused = (s: unknown): boolean =>
  typeof s === 'string' && s.trim().toUpperCase() === 'PAUSED'

const show = (s: unknown): string =>
  typeof s === 'string' && s.trim() ? s.trim() : '读不到'

function pausedFindings(
  got: CreatedReadback,
  requirePaused: { campaign?: boolean; adSet?: boolean },
): LaunchFinding[] {
  const bad: string[] = []
  if (requirePaused.campaign !== false && !isPaused(got.campaignStatus)) {
    bad.push(`广告系列（${show(got.campaignStatus)}）`)
  }
  if (requirePaused.adSet !== false && !isPaused(got.adSet.status)) bad.push(`广告组（${show(got.adSet.status)}）`)
  for (const ad of got.ads) {
    if (!isPaused(ad.status)) bad.push(`广告 ${show(ad.adName)}（${show(ad.status)}）`)
  }
  if (bad.length === 0) return []
  return [{
    code: 'not_paused',
    severity: 'blocker',
    message:
      `建出来应该全是暂停的，但回读到这些不是暂停：${bad.join('、')}。` +
      '读不到也算 —— 没确认它是暂停的，就不能当它是暂停的。',
    learnedFrom: '2026-10-04 魏征复审：「全程 PAUSED」原来只有创建时的传参，没有任何回读证据',
  }]
}

function targetFindings(exp: CreatedExpectation, adSet: RawMetaAdSet): LaunchFinding[] {
  const goal = typeof adSet.optimization_goal === 'string' ? adSet.optimization_goal : ''
  const dest = typeof adSet.destination_type === 'string' ? adSet.destination_type : ''
  const problems: string[] = []
  if (goal.toUpperCase() !== exp.optimizationGoal) {
    problems.push(`优化目标应是 ${exp.optimizationGoal}，回读到 ${goal || '读不到'}`)
  }
  if (exp.destinationType && dest.toUpperCase() !== exp.destinationType) {
    problems.push(`落点应是 ${exp.destinationType}，回读到 ${dest || '读不到'}`)
  }
  if (problems.length === 0) return []
  return [{
    code: 'messaging_adset_mismatch',
    severity: 'blocker',
    message: `这个组本该是私信广告，但${problems.join('；')}。名字叫私信、实际买别的，从数据上看不出来。`,
    learnedFrom: '2026-08-04 事故：名字和实际设置对不上，数据上看起来完全正常',
  }]
}

function countFindings(exp: CreatedExpectation, got: CreatedReadback): LaunchFinding[] {
  if (got.ads.length === exp.adCount) return []
  return [{
    code: 'ad_count_mismatch',
    severity: 'blocker',
    message:
      `建了 ${exp.adCount} 条广告，回读到 ${got.ads.length} 条。` +
      '可能是刚建完还没同步，也可能是丢了 —— 两种都不能当「没问题」放行。',
    learnedFrom: '2026-10-04 魏征复审：回读到 0 条创意时，现有闸门会因为「没有可查的东西」而放行',
  }]
}

function redlineFindings(exp: CreatedExpectation, got: CreatedReadback): LaunchFinding[] {
  // 连 Meta 自己加的问候语一起扫：它们才是建的时候传不进去、回读才现形的那批字。
  const texts = got.ads.flatMap((a) => a.texts)
  const hits = findRedlineHits(texts, exp.brandRedlines)
  if (hits.length === 0) return []
  return [{
    code: 'brand_redline_in_readback',
    severity: 'blocker',
    message: `买家会看到的文字里出现了客户的禁用词：${hits.join('、')}。`,
    learnedFrom: '2026-10-04 魏征复审：建前只能扫我们传的字，Meta 自动加的问候语要回读才看得见',
  }]
}

export function checkCreatedAsExpected(
  exp: CreatedExpectation,
  got: CreatedReadback,
  requirePaused: { campaign?: boolean; adSet?: boolean } = {},
): LaunchFinding[] {
  return [
    ...pausedFindings(got, requirePaused),
    ...targetFindings(exp, got.adSet),
    ...countFindings(exp, got),
    ...redlineFindings(exp, got),
  ]
}
