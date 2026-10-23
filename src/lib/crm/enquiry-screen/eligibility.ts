/**
 * 「邮件 / WhatsApp 来客是不是有效咨询」筛选的**准入判定**（纯函数，不碰网络）。
 * 设计稿：docs/specs/2026-10-21-crm-valid-leads-only-design-v0.md
 *
 * 只回答一个问题：这个人**现在**该不该进筛选。判完之后的模型调用、写阶段、
 * 干跑报告都在别处。这里不读库、不写库、不看时钟 —— `now` 由调用方传进来，
 * 测试才能钉死边界。
 *
 * 顺序即语义：先便宜的后贵的，先「根本不该看」的后「看了但还不到时候」。
 * 第一个不满足的条件就是 `why`，调用方拿它写干跑报告。
 */

import { isAutomatedActor, ENQUIRY_SCREEN_ACTOR } from '@/lib/crm/actors'
import {
  NOT_ENQUIRY_STAGE_KEY,
  SCREENABLE_INBOUND_SOURCES,
  type Eligibility,
  type ScreenConfig,
  type ScreenContact,
  type ScreenStageEvent,
  type ScreenTouch,
} from './types'

export type ContactKindLike = 'retail' | 'trade' | 'staff'

export interface EligibilityInput {
  contact: ScreenContact
  touches: ScreenTouch[]
  events: ScreenStageEvent[]
  contactKind: ContactKindLike
  hasNotEnquiryStage: boolean
  config: ScreenConfig
  now: Date
}

/** 阶段里「正常在跑」的那几个 —— 判走时要求最新机器事件正好落在这个阶段。 */
const RUNNING_STAGES: ReadonlySet<string> = new Set(['new', 'deferred', 'no_response'])

const DAY_MS = 86_400_000

/** 取 `createdAt` 最大的那条事件；空数组返回 undefined。 */
function latestEvent(events: ScreenStageEvent[]): ScreenStageEvent | undefined {
  let best: ScreenStageEvent | undefined
  let bestMs = -Infinity
  for (const e of events) {
    const ms = Date.parse(e.createdAt)
    if (ms > bestMs) {
      bestMs = ms
      best = e
    }
  }
  return best
}

/** 取 `createdAt` 最大的那条触点的毫秒时间戳；空数组返回 -Infinity。 */
function newestTouchMs(touches: ScreenTouch[]): number {
  let best = -Infinity
  for (const t of touches) {
    const ms = Date.parse(t.createdAt)
    if (ms > best) best = ms
  }
  return best
}

/** 触点是否在白名单里（channel/source 且入站）。 */
function isScreenableInbound(t: ScreenTouch): boolean {
  if (t.direction !== 'inbound') return false
  return SCREENABLE_INBOUND_SOURCES.has(`${t.channel}/${t.source ?? ''}`)
}

/** 阶段规则（第 10 步）。返回 null 表示通过。 */
function checkStageRules(
  contact: ScreenContact,
  events: ScreenStageEvent[],
  touches: ScreenTouch[],
): Eligibility | null {
  if (contact.stage === null) return null

  const latest = latestEvent(events)

  if (RUNNING_STAGES.has(contact.stage)) {
    if (!latest) return { eligible: false, why: 'no_machine_event' }
    if (latest.toStage !== contact.stage) return { eligible: false, why: 'stage_mismatch' }
    return null
  }

  if (contact.stage === NOT_ENQUIRY_STAGE_KEY) {
    const lastScreen = latestEvent(
      events.filter((e) => e.changedBy === ENQUIRY_SCREEN_ACTOR && e.toStage === NOT_ENQUIRY_STAGE_KEY),
    )
    if (!lastScreen) return { eligible: false, why: 'no_machine_event' }
    if (!latest || latest.toStage !== NOT_ENQUIRY_STAGE_KEY) {
      return { eligible: false, why: 'stage_mismatch' }
    }
    const lastScreenMs = Date.parse(lastScreen.createdAt)
    const revived = touches.some((t) => Date.parse(t.createdAt) > lastScreenMs)
    if (!revived) return { eligible: false, why: 'not_revived' }
    return null
  }

  return { eligible: false, why: 'stage_not_allowed' }
}

export function checkEligibility(input: EligibilityInput): Eligibility {
  const { contact, touches, events, contactKind, hasNotEnquiryStage, config, now } = input

  if (!config.enabled) return { eligible: false, why: 'disabled' }
  if (!hasNotEnquiryStage) return { eligible: false, why: 'no_stage_configured' }
  if (contact.doNotContact) return { eligible: false, why: 'do_not_contact' }
  if (contactKind !== 'retail') return { eligible: false, why: 'trade_or_staff' }
  if (touches.length === 0) return { eligible: false, why: 'no_touches' }
  if (touches.some((t) => t.direction === 'outbound')) return { eligible: false, why: 'has_outbound' }
  if (contact.hasPhone) return { eligible: false, why: 'has_phone' }
  if (!touches.every(isScreenableInbound)) return { eligible: false, why: 'non_screenable_touch' }
  if (events.some((e) => !isAutomatedActor(e.changedBy))) {
    return { eligible: false, why: 'human_stage_change' }
  }

  const stageResult = checkStageRules(contact, events, touches)
  if (stageResult) return stageResult

  const newest = newestTouchMs(touches)
  if (now.getTime() - newest < config.minAgeDays * DAY_MS) {
    return { eligible: false, why: 'too_recent' }
  }

  return { eligible: true }
}
