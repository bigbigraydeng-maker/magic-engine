/**
 * Pure readers for weekly-plan inputs. Database calls live in the next step.
 * A blank or failed read stays blank or unreadable. It is never turned into zero.
 */

import type { ClientRecipeConfig } from '@/lib/social/recipe/synthesize'

import type { BuildInput, CountSignal, FlagSignal, GoalInput, PillarPick, ThemeInput, WeeklyQuotaInput } from './types'

const UNREAD_COUNT: CountSignal = { state: 'unreadable', value: 0 }
const UNREAD_FLAG: FlagSignal = { state: 'unreadable', value: false }

export function readWeeklyQuota(config: unknown): { quota: WeeklyQuotaInput; gaps: string[] } {
  const week = record(record(config)?.social_week)
  const gaps: string[] = []
  return {
    quota: {
      storyPerWeek: oneQuota(week?.story_per_week, 'Story', gaps),
      postPerWeek: oneQuota(week?.post_per_week, '图文', gaps),
      reelPerWeek: oneQuota(week?.reel_per_week, 'Reel', gaps),
    },
    gaps,
  }
}

function oneQuota(raw: unknown, label: string, gaps: string[]): number | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 999) return raw
  gaps.push(`${label}的每周条数不是可用的整数，这项没有采用。`)
  return null
}

export function readClientRecipe(config: unknown, pillars: readonly PillarPick[] | null): ClientRecipeConfig {
  const quota = record(record(config)?.quota)
  return {
    quota: quota
      ? {
          post_per_day: finiteOrNull(quota.post_per_day),
          reel_per_week: finiteOrNull(quota.reel_per_week),
          story_per_day: finiteOrNull(quota.story_per_day),
        }
      : null,
    content_pillars: pillars,
  }
}

function finiteOrNull(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null
}

export function emptyGoalInput(read: GoalInput['read'] = 'none'): GoalInput {
  return {
    read,
    title: null,
    reasoning: null,
    intent: null,
    subType: null,
    awarenessSubtype: null,
    draftBasis: [],
  }
}

const EMPTY_GOAL: GoalInput = {
  read: 'none',
  title: null,
  reasoning: null,
  intent: null,
  subType: null,
  awarenessSubtype: null,
  draftBasis: [],
}

export function readGoalCard(row: unknown, error: boolean): GoalInput {
  if (error) {
    return { ...EMPTY_GOAL, read: 'unreadable' }
  }
  const rec = record(row)
  if (!rec) return { ...EMPTY_GOAL }
  const title = plain(rec.title)
  const reasoning = goalParagraph(rec.fde_reasoning)
  const intent = goalToken(rec.intent)
  const subType = goalToken(rec.sub_type)
  const awarenessSubtype = goalToken(rec.awareness_subtype)
  const hasAny = Boolean(title || reasoning || intent || subType || awarenessSubtype)
  if (!hasAny) return { ...EMPTY_GOAL }
  const draftBasis = goalDraftBasis({ title, reasoning, intent, subType, awarenessSubtype })
  return { read: 'ok', title, reasoning, intent, subType, awarenessSubtype, draftBasis }
}

/** @deprecated use readGoalCard */
export const readGoalTitle = readGoalCard

export function goalDraftBasis(fields: {
  title: string | null
  reasoning: string | null
  intent: string | null
  subType: string | null
  awarenessSubtype: string | null
}): string[] {
  const lines: string[] = []
  if (fields.title) lines.push(`目标标题：${fields.title}`)
  if (fields.intent) lines.push(`目标意图：${fields.intent}`)
  if (fields.subType) lines.push(`目标类型：${fields.subType}`)
  if (fields.awarenessSubtype) lines.push(`曝光子类型：${fields.awarenessSubtype}`)
  if (fields.reasoning) lines.push(`战略说明：${fields.reasoning}`)
  return lines
}

export function readThemes(rows: unknown, error: boolean): ThemeInput {
  if (error) return { read: 'unreadable', items: [] }
  if (!Array.isArray(rows)) return { read: 'none', items: [] }
  const items = rows.flatMap((row) => {
    const rec = record(row)
    const label = plain(rec?.title) ?? plain(rec?.campaign_angle)
    const id = plain(rec?.id)
    return label && id ? [{ id, label }] : []
  }).slice(0, 8)
  return items.length > 0 ? { read: 'ok', items } : { read: 'none', items: [] }
}

export function readPillars(raw: unknown, error: boolean): { pillars: PillarPick[] | null; unreadable: boolean } {
  if (error) return { pillars: null, unreadable: true }
  if (!Array.isArray(raw)) return { pillars: null, unreadable: false }
  const pillars = raw.flatMap((item) => {
    const rec = record(item)
    const id = plain(rec?.id)
    const name = plain(rec?.name) ?? id
    const postRatio = rec?.post_ratio
    if (!id || typeof postRatio !== 'number' || !Number.isFinite(postRatio)) return []
    return [{ id, name: name ?? id, post_ratio: postRatio }]
  })
  return { pillars: pillars.length > 0 ? pillars : null, unreadable: false }
}

export function pillarNameMap(pillars: readonly PillarPick[] | null): Record<string, string> {
  const names: Record<string, string> = {}
  for (const pillar of pillars ?? []) names[pillar.id] = pillar.name
  return names
}

export function authFromStatuses(statuses: string[] | 'unreadable'): { auth: FlagSignal; authLost: FlagSignal } {
  if (statuses === 'unreadable') return { auth: UNREAD_FLAG, authLost: UNREAD_FLAG }
  const active = statuses.includes('active')
  const lost = statuses.some((status) => status === 'revoked' || status === 'expired')
  if (active) return { auth: { state: 'ok', value: true }, authLost: { state: 'ok', value: false } }
  if (lost) return { auth: { state: 'ok', value: false }, authLost: { state: 'ok', value: true } }
  return { auth: { state: 'ok', value: false }, authLost: { state: 'ok', value: false } }
}

export function unreadMeasurement(): Pick<BuildInput['stage'], 'onTimeWeeks' | 'receipts' | 'periods' | 'circuitBreaker' | 'complaintSpike'> {
  return {
    onTimeWeeks: UNREAD_COUNT,
    receipts: UNREAD_COUNT,
    periods: UNREAD_COUNT,
    circuitBreaker: UNREAD_FLAG,
    complaintSpike: UNREAD_FLAG,
  }
}

function plain(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.replace(/[{}[\]`]/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, 80) : null
}

function goalParagraph(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.replace(/[{}[\]`]/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, 360) : null
}

function goalToken(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.replace(/[^a-z0-9_\-]/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
  return text ? text.slice(0, 40) : null
}

function record(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null
}
