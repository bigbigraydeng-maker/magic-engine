import { describe, expect, it } from 'vitest'
import { parseBaozhengConfig, type BaozhengClientConfig } from '../config'
import {
  OBSERVE_DAYS,
  classifyWriter,
  findBatchEventIds,
  isJudgment,
  judgeOutcome,
  type StageEvent,
} from '../outcome'

const JUDGE = 'ai:conversation-read'
const DAY = 86_400_000
const T0 = Date.parse('2026-09-01T00:00:00Z')

const config: BaozhengClientConfig = parseBaozhengConfig({
  baozheng: {
    enabled: true,
    stage_categories: {
      new: 'untouched',
      contacted: 'engaged',
      quoted: 'deep',
      deposit_paid: 'won',
      paid_full: 'won',
      traveling_soon: 'won',
      trip_completed: 'won',
      no_response: 'no_reply',
      deferred: 'declined',
      not_interested: 'declined',
      not_enquiry: 'not_lead',
    },
    human_writer_prefixes: ['PM-'],
  },
})

let seq = 0
function ev(partial: Partial<StageEvent> & { toStage: string; daysAfter: number }): StageEvent {
  seq += 1
  return {
    id: partial.id ?? `e${seq}`,
    contactId: 'c1',
    fromStage: partial.fromStage ?? null,
    toStage: partial.toStage,
    changedBy: partial.changedBy ?? 'human:pm@example.com',
    note: partial.note ?? null,
    createdAt: new Date(T0 + partial.daysAfter * DAY).toISOString(),
  }
}

function judgment(toStage: string): StageEvent {
  return ev({ id: 'j', toStage, daysAfter: 0, changedBy: JUDGE, note: `读往来记录判的：x｜原话：「hello there friend」` })
}

function judge(j: StageEvent, later: StageEvent[], opts: { batch?: string[]; evidence?: (e: StageEvent) => string | null } = {}) {
  return judgeOutcome({
    judgment: j,
    events: [j, ...later],
    config,
    judgeActor: JUDGE,
    batchIds: new Set(opts.batch ?? []),
    observeDays: OBSERVE_DAYS,
    evidenceIngestedAt: opts.evidence ?? (() => null),
  })
}

describe('isJudgment (BZ-01)', () => {
  it('needs judge actor, empty from_stage and a quote', () => {
    expect(isJudgment(judgment('contacted'), JUDGE)).toBe(true)
    expect(isJudgment({ ...judgment('contacted'), fromStage: 'contacted' }, JUDGE)).toBe(false)
    expect(isJudgment({ ...judgment('contacted'), note: '读往来记录判的：他还没跟我们说过话' }, JUDGE)).toBe(false)
    expect(isJudgment({ ...judgment('contacted'), changedBy: 'ai:enquiry-screen' }, JUDGE)).toBe(false)
  })
})

describe('classifyWriter (BZ-05)', () => {
  it('maps writers, and client prefixes rescue unknown ones as human', () => {
    expect(classifyWriter(JUDGE, JUDGE, [])).toBe('same_ai')
    expect(classifyWriter('ai:enquiry-screen', JUDGE, [])).toBe('other_ai')
    expect(classifyWriter('system:quote-email-sent', JUDGE, [])).toBe('system')
    expect(classifyWriter('bigbig@example.com', JUDGE, [])).toBe('human')
    expect(classifyWriter('PM-2026-10-12 via claude (74号)', JUDGE, [])).toBe('unknown')
    expect(classifyWriter('PM-2026-10-12 via claude (74号)', JUDGE, ['pm-'])).toBe('human')
    expect(classifyWriter(null, JUDGE, ['PM-'])).toBe('unknown')
  })
})

describe('findBatchEventIds (BZ-05 ③)', () => {
  const at = (min: number) => new Date(T0 + min * 60_000).toISOString()
  const mk = (i: number, changedBy: string, note: string, minute = 0): StageEvent => ({
    id: `b${changedBy}${i}`, contactId: `c${i}`, fromStage: 'contacted', toStage: 'quoted', changedBy, note, createdAt: at(minute),
  })

  it('five identical manual writes in one minute are a batch', () => {
    const rows = [0, 1, 2, 3, 4].map((i) => mk(i, 'human:pm@x.com', 'same reason'))
    expect(findBatchEventIds(rows, JUDGE, []).size).toBe(5)
  })

  it('four is not a batch; different notes are not a batch; system writes are never a batch', () => {
    expect(findBatchEventIds([0, 1, 2, 3].map((i) => mk(i, 'human:pm@x.com', 'same')), JUDGE, []).size).toBe(0)
    expect(findBatchEventIds([0, 1, 2, 3, 4].map((i) => mk(i, 'human:pm@x.com', `paid ${i}`)), JUDGE, []).size).toBe(0)
    expect(findBatchEventIds([0, 1, 2, 3, 4].map((i) => mk(i, 'system:quote-email-sent', 'same')), JUDGE, []).size).toBe(0)
  })

  it('same writer and note but spread over two minutes is not a batch', () => {
    const rows = [0, 1, 2, 3, 4].map((i) => mk(i, 'human:pm@x.com', 'same', i < 3 ? 0 : 1))
    expect(findBatchEventIds(rows, JUDGE, []).size).toBe(0)
  })
})

describe('judgeOutcome — reading order (BZ-06)', () => {
  it('no later record → untouched', () => {
    expect(judge(judgment('contacted'), []).outcome).toBe('untouched')
  })

  it('judged stage without a category → stage_uncategorized', () => {
    expect(judge(judgment('mystery'), []).outcome).toBe('stage_uncategorized')
  })

  it('a stage key named like an Object.prototype member is uncategorized, not crashing', () => {
    expect(judge(judgment('constructor'), []).outcome).toBe('stage_uncategorized')
  })

  it('same-stage rewrites are skipped and the next record decides', () => {
    const r = judge(judgment('quoted'), [
      ev({ toStage: 'quoted', daysAfter: 1, note: 'merge duplicate card' }),
      ev({ id: 'd', toStage: 'deposit_paid', daysAfter: 2 }),
    ])
    expect(r).toMatchObject({ outcome: 'right', decidingEventId: 'd' })
  })

  it('stops at the first other record: a later demotion cannot be pinned on the old judgment', () => {
    // 子牙 P0-2: quoted → (day 30) deposit_paid → (day 60) contacted must not become "wrong".
    const r = judge(judgment('quoted'), [
      ev({ id: 'late', toStage: 'deposit_paid', daysAfter: 30 }),
      ev({ toStage: 'contacted', daysAfter: 60 }),
    ])
    expect(r).toMatchObject({ outcome: 'inconclusive', decidingEventId: 'late' })
  })

  it('correction script (same actor, from_stage set) moving lower → dev_fix', () => {
    const r = judge(judgment('contacted'), [ev({ toStage: 'new', fromStage: 'contacted', changedBy: JUDGE, daysAfter: 70 })])
    expect(r.outcome).toBe('dev_fix')
  })

  it('same AI writing again without from_stage (re-run into pool) stops as inconclusive, never wrong', () => {
    // 魏征 P0-1: the 12 re-runs into "new" are not errors.
    const r = judge(judgment('quoted'), [
      ev({ toStage: 'new', changedBy: JUDGE, daysAfter: 0.01, note: '读往来记录判的：他还没跟我们说过话' }),
      ev({ toStage: 'not_enquiry', daysAfter: 1 }),
    ])
    expect(r.outcome).toBe('inconclusive')
  })

  it('a batch that changed the stage stops as inconclusive', () => {
    const r = judge(judgment('contacted'), [
      ev({ id: 'bat', toStage: 'quoted', daysAfter: 3 }),
      ev({ toStage: 'new', daysAfter: 4 }),
    ], { batch: ['bat'] })
    expect(r).toMatchObject({ outcome: 'inconclusive', decidingEventId: 'bat' })
  })

  it('another AI → ai_disagree; unrecognised writer → unknown_writer', () => {
    expect(judge(judgment('deferred'), [ev({ toStage: 'not_enquiry', changedBy: 'ai:enquiry-screen', daysAfter: 1 })]).outcome).toBe('ai_disagree')
    expect(judge(judgment('quoted'), [ev({ toStage: 'deposit_paid', changedBy: 'someone weird', daysAfter: 1 })]).outcome).toBe('unknown_writer')
  })

  it('later stage without a category → stage_uncategorized', () => {
    expect(judge(judgment('quoted'), [ev({ toStage: 'mystery', daysAfter: 1 })]).outcome).toBe('stage_uncategorized')
  })
})

describe('judgeOutcome — category rules (BZ-08 … BZ-11)', () => {
  it('not_lead is wrong at any time (BZ-08)', () => {
    expect(judge(judgment('contacted'), [ev({ toStage: 'not_enquiry', daysAfter: 90 })]).outcome).toBe('wrong')
  })

  it('moving lower is wrong inside the window and inconclusive after it (BZ-09, returning customers)', () => {
    expect(judge(judgment('quoted'), [ev({ toStage: 'contacted', daysAfter: OBSERVE_DAYS })]).outcome).toBe('wrong')
    expect(judge(judgment('quoted'), [ev({ toStage: 'contacted', daysAfter: OBSERVE_DAYS + 1 })]).outcome).toBe('inconclusive')
  })

  it('human forward push: right inside the window, inconclusive after (BZ-10)', () => {
    expect(judge(judgment('traveling_soon'), [ev({ toStage: 'trip_completed', daysAfter: 5 })]).outcome).toBe('right')
    expect(judge(judgment('contacted'), [ev({ toStage: 'quoted', daysAfter: 40 })]).outcome).toBe('inconclusive')
  })

  it('system forward push with evidence ingested before the judgment → wrong_too_low even after the window (BZ-10)', () => {
    const evidence = () => new Date(T0 - 4 * DAY).toISOString()
    const r = judge(judgment('contacted'), [ev({ toStage: 'quoted', changedBy: 'system:quote-email-sent', daysAfter: 60 })], { evidence })
    expect(r.outcome).toBe('wrong_too_low')
  })

  it('system forward push: evidence time unknown → inconclusive, never right (R2)', () => {
    const r = judge(judgment('contacted'), [ev({ toStage: 'quoted', changedBy: 'system:quote-email-sent', daysAfter: 2 })])
    expect(r.outcome).toBe('inconclusive')
  })

  it('system forward push with later evidence inside the window → right', () => {
    const evidence = () => new Date(T0 + 1 * DAY).toISOString()
    const r = judge(judgment('contacted'), [ev({ toStage: 'quoted', changedBy: 'system:quote-email-sent', daysAfter: 2 })], { evidence })
    expect(r.outcome).toBe('right')
  })

  it('other combinations (BZ-11)', () => {
    expect(judge(judgment('traveling_soon'), [ev({ toStage: 'no_response', daysAfter: 3 })]).outcome).toBe('wrong')
    expect(judge(judgment('deferred'), [ev({ toStage: 'deposit_paid', daysAfter: 3 })]).outcome).toBe('wrong')
    expect(judge(judgment('no_response'), [ev({ toStage: 'new', daysAfter: 3 })]).outcome).toBe('wrong')
    expect(judge(judgment('deferred'), [ev({ toStage: 'not_interested', daysAfter: 3 })]).outcome).toBe('right')
    expect(judge(judgment('contacted'), [ev({ toStage: 'no_response', daysAfter: 3 })]).outcome).toBe('inconclusive')
    expect(judge(judgment('no_response'), [ev({ toStage: 'quoted', daysAfter: 3 })]).outcome).toBe('inconclusive')
  })

  it('earlier records do not count', () => {
    const earlier = ev({ toStage: 'not_enquiry', daysAfter: -3 })
    expect(judge(judgment('contacted'), [earlier]).outcome).toBe('untouched')
  })
})

describe('parseBaozhengConfig', () => {
  it('is disabled unless enabled === true, and drops bad entries', () => {
    expect(parseBaozhengConfig(null).enabled).toBe(false)
    expect(parseBaozhengConfig({ baozheng: { enabled: 'true' } }).enabled).toBe(false)
    const c = parseBaozhengConfig({
      baozheng: { enabled: true, stage_categories: { a: 'deep', b: 'nonsense', '': 'won' }, human_writer_prefixes: [' PM- ', '', 3] },
    })
    expect(c).toEqual({ enabled: true, stageCategories: { a: 'deep' }, humanWriterPrefixes: ['PM-'] })
  })
})
