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

import { addDays } from './reconcile'
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

/** 缺口条目的「怎么办」文案（缺口与纯形状错误共用）。 */
const HOW_TEXT =
  '打开每日计划页，让代理按推广计划补出这几类的草稿；只产草稿，仍要你审核、授权才会发。条数够只表示数量对，不代表排得对（价格屏、相邻短视频不同曲这些放行规则不在这里检查）。'

/**
 * 未来 7 天条数够不够。
 * 计划没要求 / 排期算不出来 → []。
 * 读不到每日计划 → 一条 daily_plan_unreadable。
 * 有缺口或形状错误 → 一条 daily_plan_gap。
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
  if (expected.error !== null || allZero(expected.counts)) {
    return []
  }

  if (read.status === 'read_failed') {
    return [
      {
        code: 'daily_plan_unreadable',
        what: `推广计划《${title}》要求未来 7 天（${from} 到 ${to}）发内容，但每日计划这次读不出来（${read.error}），没法核对条数。读不到不等于够了，也不等于一条没排。`,
        how: '这条不用你动手，是我们这边的欠账；连续几天都这样，请找开发看。',
      },
    ]
  }

  const planned = plannedCountsInWindow(read.snapshots, from, to)

  const gaps: Array<{ kind: keyof SlotCounts; expected: number; planned: number }> = []
  for (const kind of KIND_ORDER) {
    const want = expected.counts[kind]
    const got = planned[kind]
    if (got < want) {
      gaps.push({ kind, expected: want, planned: got })
    }
  }

  const shapeErrorDays = planned.shape_error_days

  if (gaps.length === 0 && shapeErrorDays === 0) {
    return []
  }

  if (gaps.length === 0) {
    return [
      {
        code: 'daily_plan_gap',
        what: `推广计划《${title}》未来 7 天条数够，但有 ${shapeErrorDays} 天的每日计划槽位标成了已排、草稿内容不全，这些天没有算进去。`,
        how: HOW_TEXT,
      },
    ]
  }

  let what = `推广计划《${title}》要求未来 7 天（${from} 到 ${to}）发 ${formatGapList(gaps)}，每日计划里排好草稿的只有 ${formatPlannedList(gaps)}。`
  what += coverageNote(planned.latest_covered_date, planned.snapshots_used, from)
  if (shapeErrorDays > 0) {
    what += ` 另有 ${shapeErrorDays} 天的每日计划槽位标成了已排但草稿内容不全，这些天没有算进去。`
  }

  return [
    {
      code: 'daily_plan_gap',
      what,
      how: HOW_TEXT,
    },
  ]
}
