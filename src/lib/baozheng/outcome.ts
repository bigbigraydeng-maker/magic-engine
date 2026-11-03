import { classifyStageWriter } from '@/lib/crm/actors'
import { levelOf, type BaozhengClientConfig, type StageCategory } from './config'

export const OBSERVE_DAYS = 14
export const BATCH_MIN = 5
const MS_PER_DAY = 86_400_000
/** The marker the CRM stage judge writes before the verbatim quote (stage-infer.ts). */
export const QUOTE_MARKER = '｜原话：「'

export interface StageEvent {
  id: string
  contactId: string
  fromStage: string | null
  toStage: string
  changedBy: string | null
  note: string | null
  createdAt: string // ISO
}

/** A judgment = written by the judge actor, from_stage null, note contains QUOTE_MARKER. */
export function isJudgment(e: StageEvent, judgeActor: string): boolean {
  if (e.fromStage !== null) return false
  if (e.changedBy === null) return false
  if (e.changedBy.trim() !== judgeActor) return false
  if (e.note === null) return false
  return e.note.includes(QUOTE_MARKER)
}

export type WriterKind = 'same_ai' | 'other_ai' | 'human' | 'system' | 'unknown'

/**
 * changedBy (trimmed) === judgeActor -> 'same_ai'.
 * Else k = classifyStageWriter(changedBy): 'ai' -> 'other_ai', 'system' -> 'system', 'human' -> 'human'.
 * k === 'unknown': if changedBy is a non-empty string and its lowercase starts with any lowercase prefix in humanWriterPrefixes -> 'human', else 'unknown'.
 */
export function classifyWriter(
  changedBy: string | null,
  judgeActor: string,
  humanWriterPrefixes: readonly string[],
): WriterKind {
  if (changedBy !== null && changedBy.trim() === judgeActor) return 'same_ai'
  const k = classifyStageWriter(changedBy)
  if (k === 'ai') return 'other_ai'
  if (k === 'system') return 'system'
  if (k === 'human') return 'human'
  if (changedBy !== null) {
    const lower = changedBy.toLowerCase()
    for (const prefix of humanWriterPrefixes) {
      if (lower.startsWith(prefix.toLowerCase())) return 'human'
    }
  }
  return 'unknown'
}

/**
 * Batch operations (mass manual changes). Group events whose writer kind is 'human' or 'unknown'
 * (NOT 'system', NOT 'same_ai', NOT 'other_ai') by key = `${changedBy}|${createdAt.slice(0, 16)}|${note ?? ''}`.
 * Every event in a group of size >= BATCH_MIN goes into the returned set (by id).
 */
export function findBatchEventIds(
  events: readonly StageEvent[],
  judgeActor: string,
  humanWriterPrefixes: readonly string[],
): Set<string> {
  const groups = new Map<string, string[]>()
  for (const e of events) {
    const w = classifyWriter(e.changedBy, judgeActor, humanWriterPrefixes)
    if (w !== 'human' && w !== 'unknown') continue
    const key = `${e.changedBy ?? ''}|${e.createdAt.slice(0, 16)}|${e.note ?? ''}`
    const bucket = groups.get(key)
    if (bucket === undefined) {
      groups.set(key, [e.id])
    } else {
      bucket.push(e.id)
    }
  }
  const out = new Set<string>()
  for (const ids of groups.values()) {
    if (ids.length >= BATCH_MIN) {
      for (const id of ids) out.add(id)
    }
  }
  return out
}

export type Outcome =
  | 'right'               // known right
  | 'wrong'               // known wrong
  | 'wrong_too_low'       // judged too low: the evidence that pushed it forward was ingested before the judgment
  | 'dev_fix'             // a correction script (same actor, from_stage not null) moved it lower
  | 'ai_disagree'         // another AI wrote a different stage
  | 'unknown_writer'      // deciding record written by an unrecognised writer -> not checked
  | 'stage_uncategorized' // a stage involved has no category in client config -> not checked
  | 'inconclusive'        // evidence exists but cannot tell
  | 'untouched'           // nothing after the judgment decided anything -> not checked

export interface OutcomeResult {
  outcome: Outcome
  decidingEventId: string | null
  reason: string
}

export interface JudgeOutcomeInput {
  judgment: StageEvent
  /** other events of the SAME contact, any order; may include the judgment itself and earlier events */
  events: readonly StageEvent[]
  config: BaozhengClientConfig
  judgeActor: string
  batchIds: ReadonlySet<string>
  observeDays: number
  /**
   * For a 'system' writer that moved the stage forward: ingest time (ISO) of the evidence that triggered it,
   * or null when it cannot be found.
   */
  evidenceIngestedAt: (e: StageEvent) => string | null
}

function categoryOf(config: BaozhengClientConfig, stage: string): StageCategory | undefined {
  // Own keys only: a stage key like "constructor" must not hit Object.prototype.
  return Object.prototype.hasOwnProperty.call(config.stageCategories, stage) ? config.stageCategories[stage] : undefined
}

function isLower(eCat: StageCategory, jCat: StageCategory): boolean {
  const el = levelOf(eCat)
  const jl = levelOf(jCat)
  if (el === null || jl === null) return false
  return el < jl
}

function isUntouchedOrLower(eCat: StageCategory, jCat: StageCategory): boolean {
  if (eCat === 'untouched') return true
  return isLower(eCat, jCat)
}

function decideByCategories(
  jCat: StageCategory,
  eCat: StageCategory,
  within: boolean,
  w: 'human' | 'system',
  e: StageEvent,
  judgment: StageEvent,
  evidenceIngestedAt: (e: StageEvent) => string | null,
): OutcomeResult {
  const id = e.id
  if (eCat === 'not_lead') return { outcome: 'wrong', decidingEventId: id, reason: 'moved to not_lead' }

  const jl = levelOf(jCat)
  const el = levelOf(eCat)
  if (jl !== null && el !== null) {
    if (el < jl) {
      return within
        ? { outcome: 'wrong', decidingEventId: id, reason: 'moved lower within window' }
        : { outcome: 'inconclusive', decidingEventId: id, reason: 'moved lower after window' }
    }
    // forward or same level, different stage
    if (w === 'system') {
      const t = evidenceIngestedAt(e)
      if (t === null) {
        return { outcome: 'inconclusive', decidingEventId: id, reason: 'evidence time unknown' }
      }
      if (Date.parse(t) <= Date.parse(judgment.createdAt)) {
        return { outcome: 'wrong_too_low', decidingEventId: id, reason: 'evidence ingested before judgment' }
      }
      return within
        ? { outcome: 'right', decidingEventId: id, reason: 'moved forward within window' }
        : { outcome: 'inconclusive', decidingEventId: id, reason: 'moved forward after window' }
    }
    // human
    return within
      ? { outcome: 'right', decidingEventId: id, reason: 'human moved forward within window' }
      : { outcome: 'inconclusive', decidingEventId: id, reason: 'human moved forward after window' }
  }

  if (jCat === 'won' && (eCat === 'no_reply' || eCat === 'declined')) {
    return within
      ? { outcome: 'wrong', decidingEventId: id, reason: 'won then lost within window' }
      : { outcome: 'inconclusive', decidingEventId: id, reason: 'won then lost after window' }
  }
  if (jCat === 'declined' && eCat === 'won') {
    return within
      ? { outcome: 'wrong', decidingEventId: id, reason: 'declined then won within window' }
      : { outcome: 'inconclusive', decidingEventId: id, reason: 'declined then won after window' }
  }
  if ((jCat === 'declined' || jCat === 'no_reply') && eCat === 'untouched') {
    return within
      ? { outcome: 'wrong', decidingEventId: id, reason: 'reset to untouched within window' }
      : { outcome: 'inconclusive', decidingEventId: id, reason: 'reset to untouched after window' }
  }
  if (jCat === 'declined' && eCat === 'declined') {
    return within
      ? { outcome: 'right', decidingEventId: id, reason: 'declined confirmed within window' }
      : { outcome: 'inconclusive', decidingEventId: id, reason: 'declined confirmed after window' }
  }
  return { outcome: 'inconclusive', decidingEventId: id, reason: 'no rule matched' }
}

export function judgeOutcome(input: JudgeOutcomeInput): OutcomeResult {
  const { judgment, events, config, judgeActor, batchIds, observeDays, evidenceIngestedAt } = input

  const jCat = categoryOf(config, judgment.toStage)
  if (jCat === undefined) {
    return { outcome: 'stage_uncategorized', decidingEventId: null, reason: 'judged stage has no category' }
  }

  const jTime = Date.parse(judgment.createdAt)
  const later = events
    .filter((e) => e.id !== judgment.id && Date.parse(e.createdAt) > jTime)
    .sort((a, b) => {
      const ta = Date.parse(a.createdAt)
      const tb = Date.parse(b.createdAt)
      if (ta !== tb) return ta - tb
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })

  for (const e of later) {
    const w = classifyWriter(e.changedBy, judgeActor, config.humanWriterPrefixes)

    // Any write by the same AI ends this judgment's story, even the same stage (a re-judgment takes over).
    if (w === 'same_ai' && e.fromStage !== null && e.toStage !== judgment.toStage) {
      const eCat = categoryOf(config, e.toStage)
      if (eCat !== undefined && isUntouchedOrLower(eCat, jCat)) {
        return { outcome: 'dev_fix', decidingEventId: e.id, reason: 'correction script moved lower' }
      }
      return { outcome: 'inconclusive', decidingEventId: e.id, reason: 'correction script, not lower' }
    }

    if (w === 'same_ai') {
      return { outcome: 'inconclusive', decidingEventId: e.id, reason: 'same AI wrote again' }
    }

    if (e.toStage === judgment.toStage) continue

    if (batchIds.has(e.id)) {
      return { outcome: 'inconclusive', decidingEventId: e.id, reason: 'batch operation' }
    }

    if (w === 'other_ai') {
      return { outcome: 'ai_disagree', decidingEventId: e.id, reason: 'another AI wrote a different stage' }
    }

    if (w === 'unknown') {
      return { outcome: 'unknown_writer', decidingEventId: e.id, reason: 'unrecognised writer' }
    }

    // human or system
    const eCat = categoryOf(config, e.toStage)
    if (eCat === undefined) {
      return { outcome: 'stage_uncategorized', decidingEventId: e.id, reason: 'later stage has no category' }
    }

    const within = Date.parse(e.createdAt) - jTime <= observeDays * MS_PER_DAY
    return decideByCategories(jCat, eCat, within, w, e, judgment, evidenceIngestedAt)
  }

  return { outcome: 'untouched', decidingEventId: null, reason: 'no later record decided' }
}
