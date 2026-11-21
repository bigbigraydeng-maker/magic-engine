/**
 * Confirm stays closed unless the launch gate, the live ad set, and the image are green.
 * Adding an ad does not change the ad set budget.
 */

import type { HardCheck } from '@/lib/confirmation-card/facts'
import { confirmBlockReason } from '@/lib/confirmation-card/facts'
import {
  LAUNCH_ACCOUNT_UNREAD,
  LAUNCH_NO_ACCOUNT,
  LAUNCH_PLAN_UNREAD,
  LAUNCH_SNAP_BAD,
  LAUNCH_SNAP_MISSING,
  LAUNCH_SNAP_STALE,
  LAUNCH_SNAP_UNREAD,
  LAUNCH_SUM_UNREAD,
  type LaunchBind,
} from '@/lib/ads-launch/plan-gate'
import type { CopiedStory } from './order'

export interface LiveFacts {
  readonly accountKnown: boolean | null
  readonly adSetStatus: string | null
  readonly copy: CopiedStory | null
}

export interface Inspect {
  readonly plan: LaunchBind
  readonly live: LiveFacts
  readonly imageUrl: string | null
}

const STALE = new Set<string>([LAUNCH_SNAP_STALE, LAUNCH_SNAP_MISSING, LAUNCH_SNAP_BAD, LAUNCH_SNAP_UNREAD])
const UNREAD = new Set<string>([LAUNCH_PLAN_UNREAD, LAUNCH_ACCOUNT_UNREAD, LAUNCH_SUM_UNREAD, LAUNCH_NO_ACCOUNT])

export function guardCreative(inspect: Inspect): { checks: HardCheck[]; block: string | null; copy: CopiedStory | null } {
  const checks: HardCheck[] = [
    ...planChecks(inspect.plan),
    activeCheck(inspect.live),
    imageCheck(inspect.imageUrl),
    copyCheck(inspect.live),
    { label: '不改广告组预算', state: 'green', reason: '只加一条广告，不动每天预算' },
  ]
  return { checks, block: confirmBlockReason(checks), copy: inspect.live.copy }
}

function planChecks(plan: LaunchBind): HardCheck[] {
  if (plan.ok) {
    return [
      { label: '已有批准的广告计划', state: 'green', reason: '对得上当前这份已批准的计划' },
      { label: '广告账户快照没过期', state: 'green', reason: '快照还在有效期内' },
    ]
  }
  if (STALE.has(plan.reason)) {
    return [
      { label: '已有批准的广告计划', state: 'green', reason: '计划还在，但快照不能用' },
      { label: '广告账户快照没过期', state: 'red', reason: plan.reason },
    ]
  }
  return [
    { label: '已有批准的广告计划', state: UNREAD.has(plan.reason) ? 'unread' : 'red', reason: plan.reason },
    { label: '广告账户快照没过期', state: 'unread', reason: '计划没对上，还没把快照当成通过' },
  ]
}

function activeCheck(live: LiveFacts): HardCheck {
  if (live.accountKnown == null || live.adSetStatus == null) {
    return { label: '广告组仍在投', state: 'unread', reason: '广告组现在读不到' }
  }
  if (!live.accountKnown) return { label: '广告组仍在投', state: 'red', reason: '广告组不在这个客户的账户里' }
  if (live.adSetStatus !== 'ACTIVE') return { label: '广告组仍在投', state: 'red', reason: '广告组已经不是在投' }
  return { label: '广告组仍在投', state: 'green', reason: '广告组还在投' }
}

function imageCheck(imageUrl: string | null): HardCheck {
  if (!imageUrl) return { label: '图在内容工厂', state: 'red', reason: '内容工厂里这张图现在不能用' }
  return { label: '图在内容工厂', state: 'green', reason: '用的是已经存在的图' }
}

function copyCheck(live: LiveFacts): HardCheck {
  if (live.accountKnown == null || live.adSetStatus == null) {
    return { label: '落地沿用组里已有广告', state: 'unread', reason: '广告组读不到，没法复制落地页' }
  }
  if (!live.copy) return { label: '落地沿用组里已有广告', state: 'red', reason: '组里没有能复制的落地页或表单' }
  return { label: '落地沿用组里已有广告', state: 'green', reason: '不另填落地页或表单' }
}
