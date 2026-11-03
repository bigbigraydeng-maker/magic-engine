/**
 * 成绩单「合格客人」（修复方案第 1 刀 ③；设计 docs/specs/2026-11-03-ads-scorecard-qualified-column-v0.md）。
 * 纯函数，只读。按「第一次是哪个组带来的」把近 30 天新进的客人归到组，数：
 * 合格几个（谁标的：人 / 系统 / AI / 来源认不出）、跟进过但没合格几个、没人跟进几个、观察中几个。
 *
 * 🔴 不进 D5 / O3、不当加钱依据（样本太小）。结果阶梯里「合格询盘」那一级故意不动（设计 §5）。
 */

import { classifyStageWriter, type StageWriterKind } from '@/lib/crm/actors'
import { isHumanFollowup, type LeadTouch } from '@/lib/crm/lead-followup-due'

export const QUALIFIED_WINDOW_DAYS = 30
/** 平台默认；行业手册可以改（地产周期更长）。 */
export const QUALIFIED_OBSERVE_DAYS = 14

export interface QualifiedEvent { toStage: string; changedBy: string | null; createdAt: string }

export interface QualifiedContact {
  id: string
  /** contacts.attr_adset_id：第一次是哪个广告组带来的；null = 对不上组 */
  adsetId: string | null
  createdAt: string
  stage: string | null
  events: QualifiedEvent[]
  touches: LeadTouch[]
}

/** 成绩单里的预算单位（整个系列分钱的按系列，其余按组），用来把组归到单位。 */
export interface QualifiedUnitRef {
  id: string
  name: string | null
  level: 'campaign' | 'adset'
  adsetIds: string[]
  spentLast7d: boolean
}

export type QualifiedByWriter = Record<StageWriterKind, number>

export interface QualifiedRow {
  id: string
  name: string | null
  level: 'campaign' | 'adset'
  /** 近 7 天没花钱（或不在今天的广告快照里） */
  stoppedLast7d: boolean
  /** 近 30 天这个组带来的新客人 */
  leads: number
  qualified: { total: number } & QualifiedByWriter
  /** 跟进过、满观察期、没合格 */
  followedNotQualified: number
  /** 从没被真人跟进过（没合格的里面数） */
  noFollowup: number
  /** 第一次跟进还不满观察天数（没合格的里面数） */
  observing: number
}

export interface QualifiedBlock {
  window: { start: string; end: string }
  observeDays: number
  /** false = 客户还没设置哪些阶段算合格 */
  configured: boolean
  /** 设置里登记了、但客户阶段表里已经没有的阶段（计算时忽略） */
  staleStageKeys: string[]
  rows: QualifiedRow[]
  /** 合格、但对不上是哪个广告组带来的客人数 */
  unattributedQualified: number
}

export interface QualifiedComputeArgs {
  /** 巡察当天（账户时区的日期） */
  date: string
  /** 窗口第一天（日期） */
  windowStart: string
  /** 窗口结束的那一刻（巡察当天在账户时区的最后一刻，UTC 毫秒） */
  endUtcMs: number
  observeDays: number
  qualifiedStageKeys: string[]
  knownStageKeys: string[]
  contacts: QualifiedContact[]
  units: QualifiedUnitRef[]
}

const MS_PER_DAY = 86_400_000

function emptyByWriter(): QualifiedByWriter {
  return { human: 0, system: 0, ai: 0, unknown: 0 }
}

function buildUnitMap(units: QualifiedUnitRef[]): Map<string, QualifiedUnitRef> {
  const map = new Map<string, QualifiedUnitRef>()
  for (const unit of units) {
    map.set(unit.id, unit)
    for (const adsetId of unit.adsetIds) map.set(adsetId, unit)
  }
  return map
}

function resolveUnit(
  adsetId: string,
  unitMap: Map<string, QualifiedUnitRef>,
  synthetic: Map<string, QualifiedUnitRef>,
): QualifiedUnitRef {
  const found = unitMap.get(adsetId)
  if (found) return found
  const existing = synthetic.get(adsetId)
  if (existing) return existing
  const created: QualifiedUnitRef = {
    id: adsetId,
    name: null,
    level: 'adset',
    adsetIds: [adsetId],
    spentLast7d: false,
  }
  synthetic.set(adsetId, created)
  return created
}

function firstFollowupMs(contact: QualifiedContact): number | null {
  const createdMs = Date.parse(contact.createdAt)
  let first: number | null = null
  for (const touch of contact.touches) {
    if (!isHumanFollowup(touch)) continue
    const ms = Date.parse(touch.occurredAt)
    if (ms < createdMs) continue
    if (first === null || ms < first) first = ms
  }
  for (const event of contact.events) {
    if (classifyStageWriter(event.changedBy) !== 'human') continue
    const ms = Date.parse(event.createdAt)
    if (ms < createdMs) continue
    if (first === null || ms < first) first = ms
  }
  return first
}

interface ContactOutcome {
  qualified: boolean
  writer: StageWriterKind
  bucket: 'followedNotQualified' | 'noFollowup' | 'observing' | null
}

function classifyContact(
  contact: QualifiedContact,
  valid: Set<string>,
  endUtcMs: number,
  observeDays: number,
): ContactOutcome {
  const qualifyingEvents = contact.events
    .filter((e) => valid.has(e.toStage))
    .slice()
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))

  const isQualified =
    (contact.stage !== null && valid.has(contact.stage)) || qualifyingEvents.length > 0

  if (isQualified) {
    const writer =
      qualifyingEvents.length > 0 ? classifyStageWriter(qualifyingEvents[0].changedBy) : 'unknown'
    return { qualified: true, writer, bucket: null }
  }

  const first = firstFollowupMs(contact)
  if (first === null) return { qualified: false, writer: 'unknown', bucket: 'noFollowup' }
  if (first > endUtcMs - observeDays * MS_PER_DAY) {
    return { qualified: false, writer: 'unknown', bucket: 'observing' }
  }
  return { qualified: false, writer: 'unknown', bucket: 'followedNotQualified' }
}

interface RowAccumulator {
  unit: QualifiedUnitRef
  leads: number
  qualified: { total: number } & QualifiedByWriter
  followedNotQualified: number
  noFollowup: number
  observing: number
}

function newAccumulator(unit: QualifiedUnitRef): RowAccumulator {
  return {
    unit,
    leads: 0,
    qualified: { total: 0, ...emptyByWriter() },
    followedNotQualified: 0,
    noFollowup: 0,
    observing: 0,
  }
}

function applyOutcome(acc: RowAccumulator, outcome: ContactOutcome): void {
  acc.leads += 1
  if (outcome.qualified) {
    acc.qualified.total += 1
    acc.qualified[outcome.writer] += 1
    return
  }
  if (outcome.bucket === 'followedNotQualified') acc.followedNotQualified += 1
  else if (outcome.bucket === 'noFollowup') acc.noFollowup += 1
  else if (outcome.bucket === 'observing') acc.observing += 1
}

function toRow(acc: RowAccumulator): QualifiedRow {
  return {
    id: acc.unit.id,
    name: acc.unit.name,
    level: acc.unit.level,
    stoppedLast7d: !acc.unit.spentLast7d,
    leads: acc.leads,
    qualified: acc.qualified,
    followedNotQualified: acc.followedNotQualified,
    noFollowup: acc.noFollowup,
    observing: acc.observing,
  }
}

export function computeQualifiedBlock(args: QualifiedComputeArgs): QualifiedBlock {
  const known = new Set(args.knownStageKeys)
  const valid = new Set(args.qualifiedStageKeys.filter((k) => known.has(k)))
  const staleStageKeys = args.qualifiedStageKeys.filter((k) => !known.has(k))
  const configured = args.qualifiedStageKeys.length > 0

  const unitMap = buildUnitMap(args.units)
  const synthetic = new Map<string, QualifiedUnitRef>()
  const accumulators = new Map<string, RowAccumulator>()
  let unattributedQualified = 0

  for (const contact of args.contacts) {
    const outcome = classifyContact(contact, valid, args.endUtcMs, args.observeDays)

    if (contact.adsetId === null) {
      if (outcome.qualified) unattributedQualified += 1
      continue
    }

    const unit = resolveUnit(contact.adsetId, unitMap, synthetic)
    let acc = accumulators.get(unit.id)
    if (!acc) {
      acc = newAccumulator(unit)
      accumulators.set(unit.id, acc)
    }
    applyOutcome(acc, outcome)
  }

  const rows = Array.from(accumulators.values())
    .map(toRow)
    .sort((a, b) => (b.leads - a.leads) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  return {
    window: { start: args.windowStart, end: args.date },
    observeDays: args.observeDays,
    configured,
    staleStageKeys,
    rows,
    unattributedQualified,
  }
}
