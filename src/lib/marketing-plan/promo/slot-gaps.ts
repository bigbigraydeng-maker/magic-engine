/**
 * 未来 7 天条数够不够 —— 纯函数。只数条数，不比星期几。
 * 输入：推广计划（PromoSpec）+ 摆法（PromoPlaybook）+ 每日计划读取结果（DailyPlanRead）。
 * 输出：给 PM 的待办条目（WatchFinding[]）。没事就返回空数组。
 *
 * 原则：
 *  - 计划没要求（三类期望都为 0）就不查。
 *  - 排期算不出来（error / too_dense）是别处的事，这里不报。
 *  - 读不到每日计划 ≠ 够了，也 ≠ 一条没排，要单独出声。
 *  - 只数 post / story / reel；blog / newsletter / ads_start 一律不数、不输出。
 *  - 文案里不出现星期几，不出现 phase / step 编号，不复述计划里除标题外的任何文字。
 */

import { addDays, daysBetween } from './reconcile'
import type { PromoPlaybook } from './playbooks'
import type { PromoSpec } from './spec'
import { expandPromoSchedule } from './schedule'
import type { DailyPlanRead } from './daily-plan-read'
import { plannedCountsInWindow } from './daily-plan-read'
import type { WatchFinding } from './daily-watch'

/** 三类槽位的条数。 */
export interface SlotCounts {
  post: number
  story: number
  reel: number
}

/** 三类槽位的展示名（只用于文案）。 */
const KIND_LABEL: Record<keyof SlotCounts, string> = {
  post: '帖子',
  story: '快拍',
  reel: '短视频',
}

/** 三类槽位的固定顺序，保证期望与实际按同样顺序写。 */
const KIND_ORDER: Array<keyof SlotCounts> = ['post', 'story', 'reel']

/** 窗口 = 今天+1 … 今天+7（UTC 日历天，字符串上加减）。 */
export function slotWindow(today: string): { from: string; to: string } {
  return { from: addDays(today, 1), to: addDays(today, 7) }
}

/**
 * 计划在 [from, to] 窗口内要求的三类条数。
 * 排期算不出来（error 非空 / too_dense）时 counts 全 0、error 带原因。
 * 只数 post / story / reel，其它类型不数。
 */
export function expectedSlotCounts(
  spec: PromoSpec,
  playbook: PromoPlaybook,
  from: string,
  to: string,
): { counts: SlotCounts; error: string | null } {
  const counts: SlotCounts = { post: 0, story: 0, reel: 0 }
  const schedule = expandPromoSchedule(spec, playbook)
  if (schedule.error !== null) {
    return { counts, error: schedule.error }
  }
  if (schedule.too_dense) {
    return { counts, error: '排期太密，没法逐日核对' }
  }
  for (const day of schedule.days) {
    if (day.date < from || day.date > to) {
      continue
    }
    for (const item of day.items) {
      if (item.kind === 'post' || item.kind === 'story' || item.kind === 'reel') {
        counts[item.kind] += 1
      }
    }
  }
  return { counts, error: null }
}

/** 三类期望是否都为 0。 */
function allZero(counts: SlotCounts): boolean {
  return counts.post === 0 && counts.story === 0 && counts.reel === 0
}

/** 把「3 条帖子、2 条快拍」这样的列表拼出来，只列有缺口的类型。 */
function formatGapList(gaps: Array<{ kind: keyof SlotCounts; expected: number; planned: number }>): string {
  return gaps.map(g => `${g.expected} 条${KIND_LABEL[g.kind]}`).join('、')
}

/** 把「1 条帖子、0 条快拍」这样的实际条数列表拼出来，顺序与缺口列表一致。 */
function formatPlannedList(gaps: Array<{ kind: keyof SlotCounts; expected: number; planned: number }>): string {
  return gaps.map(g => `${g.planned} 条${KIND_LABEL[g.kind]}`).join('、')
}

/** 覆盖说明：每日计划排到哪一天 / 有没有建过。 */
function coverageNote(latestCoveredDate: string | null, snapshotsUsed: number, from: string): string {
  if (latestCoveredDate === null) {
    if (snapshotsUsed === 0) {
      return ' 这个客户还没有建过每日计划。'
    }
    return ' 每日计划里还一份都没有排过。'
  }
  if (latestCoveredDate < from) {
    return ` 每日计划最新只排到 ${latestCoveredDate}。`
  }
  return ''
}

/** 缺口条目的「怎么办」文案（缺口与纯形状错误共用）。不承诺任何自动补排——目前没有谁会自动补。 */
const HOW_TEXT =
  '打开每日计划页，按推广计划里每周的条数自己补排（这条只是提醒，不会自动补）；排出来的只是草稿，仍要你审核、授权才会发。条数够只表示数量对，不代表排得对，也不代表能发（价格屏、相邻短视频不同曲这些放行规则不在这里检查）。'

/** 窗口里少于这么多天被覆盖时，不做条数比较（太短，按比例折算没意义）。 */
const MIN_COVERED_DAYS_FOR_COUNT = 3

/**
 * 每日计划是「一个活动一行、整份 7 天覆盖」，代理通常每周才排一次，所以周中窗口伸到快照覆盖范围之外是常态。
 * 因此只做两件事：
 *  1. 明天起一天都没覆盖 → 缺口（真缺口：明天没有计划）；
 *  2. 已覆盖的部分（≥ 3 天）里，条数低于「每周要求 × 覆盖天数 ÷ 7」取整的下限 → 缺口。
 * 只比帖子和快拍：短视频是「每月 N 条」，窗口里的期望会 0 / 1 来回跳，不比（Reel 成片也只走视频工厂）。
 * 计划没要求 / 排期算不出来 → []；读不到 / 读不懂每日计划 → daily_plan_unreadable（走开发欠账，不进 PM 清单）。
 */
export function detectSlotGaps(input: {
  title: string
  today: string
  spec: PromoSpec
  playbook: PromoPlaybook
  read: DailyPlanRead
}): WatchFinding[] {
  const { title, today, spec, playbook, read } = input
  const { from, to } = slotWindow(today)

  const expected = expectedSlotCounts(spec, playbook, from, to)
  const want7 = { post: expected.counts.post, story: expected.counts.story }
  if (expected.error !== null || (want7.post === 0 && want7.story === 0)) {
    return []
  }

  const unreadable = (detail: string): WatchFinding[] => [
    {
      code: 'daily_plan_unreadable',
      what: `推广计划《${title}》要求未来 7 天（${from} 到 ${to}）发内容，但每日计划${detail}，没法核对条数。读不到不等于够了，也不等于一条没排。`,
      how: '这条不用你动手，是我们这边的欠账；连续几天都这样，请找开发看。',
    },
  ]
  if (read.status === 'read_failed') {
    return unreadable(`这次读不出来（${read.error}）`)
  }
  const unparsed = read.rows_unparseable ?? 0
  if (read.snapshots.length === 0 && unparsed > 0) {
    return unreadable(`有 ${unparsed} 份记录格式读不懂`)
  }

  const kinds = (['post', 'story'] as const).filter(k => want7[k] > 0)
  const full = plannedCountsInWindow(read.snapshots, from, to)
  const covered = full.latest_covered_date

  // 1. 明天起一天都没覆盖
  if (covered === null || covered < from) {
    const wantList = kinds.map(k => `${want7[k]} 条${KIND_LABEL[k]}`).join('、')
    const what = `推广计划《${title}》要求未来 7 天（${from} 到 ${to}）发 ${wantList}，每日计划里明天起一天都没有排。` + coverageNote(covered, full.snapshots_used, from)
    return [{ code: 'daily_plan_gap', what, how: HOW_TEXT }]
  }

  // 2. 已覆盖的部分：条数下限（按覆盖天数折算，不比星期几）
  const effectiveTo = covered < to ? covered : to
  const coveredDays = daysBetween(from, effectiveTo) + 1
  const sub = effectiveTo === to ? full : plannedCountsInWindow(read.snapshots, from, effectiveTo)
  const gaps: Array<{ kind: keyof SlotCounts; expected: number; planned: number }> = []
  if (coveredDays >= MIN_COVERED_DAYS_FOR_COUNT) {
    for (const k of kinds) {
      const floorWant = Math.floor((want7[k] * coveredDays) / 7)
      if (sub[k] < floorWant) gaps.push({ kind: k, expected: floorWant, planned: sub[k] })
    }
  }

  const shapeErrorDays = sub.shape_error_days
  if (gaps.length === 0 && shapeErrorDays === 0) return []

  if (gaps.length === 0) {
    return [{
      code: 'daily_plan_gap',
      what: `推广计划《${title}》已覆盖的日子条数够，但有 ${shapeErrorDays} 天的每日计划槽位标成了已排、草稿内容不全，这些天没有算进去。`,
      how: HOW_TEXT,
    }]
  }

  let what = `推广计划《${title}》要求每日计划已覆盖的这 ${coveredDays} 天（${from} 到 ${effectiveTo}）至少有 ${formatGapList(gaps)}，每日计划里排好草稿的只有 ${formatPlannedList(gaps)}。`
  if (shapeErrorDays > 0) {
    what += ` 另有 ${shapeErrorDays} 天的每日计划槽位标成了已排但草稿内容不全，这些天没有算进去。`
  }
  return [{ code: 'daily_plan_gap', what, how: HOW_TEXT }]
}
