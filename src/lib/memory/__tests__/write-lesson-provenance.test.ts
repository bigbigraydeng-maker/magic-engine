/**
 * V18（契约 4.8）：带 provenance 的 lesson 必须**一次写完**。
 *
 * 守两条：
 * ① 来源字段不全 / 有效期不是未来 / 正文只是规则编号 → 当场 `invalid`，
 *    **连一次 `from()` 都不发生**，更不会有 upsert。这是"写入中断不出现可注入半成品"的第一层。
 * ② `sanitized_at` 与 `shareability_verdict` 只能由函数自己填，调用方给的一律不认（防伪造）。
 *
 * 另有一条：没有 provenance 的老调用，写进去的列必须与改动前逐列一致 ——
 * 新列在迁移执行前不存在，多发一列就会让老路径报错。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { writeGlobalLesson, writeGlobalLessonOrThrow, validateProvenance, type LessonInput, type LessonProvenance } from '../write-lesson'

const NOW = Date.now()
const FUTURE = new Date(NOW + 90 * 24 * 3600 * 1000).toISOString()
const PAST = new Date(NOW - 24 * 3600 * 1000).toISOString()
const REVIEWED = new Date(NOW - 60 * 60 * 1000).toISOString()

const CLEAN: LessonInput = {
  lessonKey: 'distill:card-x#p1',
  scope: 'global',
  lesson: '重定向组要显式关掉自动放宽，否则名单形同虚设',
  rationale: '平台会自作主张扩量，名字写着重定向不等于真在做重定向',
  confidence: 0.8,
}

const PROV: LessonProvenance = {
  sourcePointKey: 'card-x#p1',
  sourceCardId: 'card-x',
  pillar: 'ads',
  validUntil: FUTURE,
}

/** 老路径写进去的列，一列不多一列不少。 */
const LEGACY_COLUMNS = [
  'confidence',
  'evidence',
  'flywheel',
  'industry',
  'is_active',
  'lesson',
  'lesson_key',
  'rationale',
  'scope',
  'updated_at',
]

type UpsertRow = Record<string, unknown>
type UpdateCall = { table: string; payload: unknown }

let upserted: UpsertRow[] = []
let upsertAttempts = 0
let updates: UpdateCall[] = []
let fromCalls = 0
let dbError: string | null = null

/**
 * 替身：记录 upsert 行与次数、记录 update（应当永远是空的）、
 * 数 `from()` 被调了几次（用来断言"完全没碰库"）。
 */
function fakeSupabase(clientNames: string[] = [], personNames: string[] = []): SupabaseClient {
  return {
    from: (table: string) => {
      fromCalls += 1
      const recordUpdate = (payload: unknown) => {
        updates.push({ table, payload })
        return { eq: async () => ({ error: null }) }
      }

      if (table === 'clients') {
        return {
          select: async () => ({ data: clientNames.map((name) => ({ name })), error: null }),
          update: recordUpdate,
        }
      }
      if (table === 'contacts') {
        return {
          select: () => ({
            not: () => ({
              limit: async () => ({
                data: personNames.map((full_name) => ({ full_name })),
                error: null,
              }),
            }),
          }),
          update: recordUpdate,
        }
      }
      return {
        upsert: async (row: UpsertRow) => {
          upsertAttempts += 1
          if (dbError) return { error: { message: dbError } }
          upserted.push(row)
          return { error: null }
        },
        update: recordUpdate,
      }
    },
  } as unknown as SupabaseClient
}

function sanitizedAtOf(row: UpsertRow): string {
  const value = row.sanitized_at
  if (typeof value !== 'string') throw new Error('sanitized_at 应该是 ISO 字符串')
  return value
}

beforeEach(() => {
  upserted = []
  upsertAttempts = 0
  updates = []
  fromCalls = 0
  dbError = null
})

describe('writeGlobalLesson — provenance 字段不全就不写（V18 第 1 组）', () => {
  const broken: Array<{ label: string; prov: LessonProvenance }> = [
    { label: '来源点为空', prov: { ...PROV, sourcePointKey: '' } },
    { label: '来源卡只有空白', prov: { ...PROV, sourceCardId: '   ' } },
    { label: '支柱取值不合法', prov: { ...PROV, pillar: 'nonsense' as LessonProvenance['pillar'] } },
    { label: '有效期在过去', prov: { ...PROV, validUntil: PAST } },
    { label: '有效期不是日期', prov: { ...PROV, validUntil: 'not-a-date' } },
    { label: '复核时间不是日期', prov: { ...PROV, lastReviewedAt: 'garbage' } },
  ]

  for (const { label, prov } of broken) {
    it(`${label} → invalid，且完全不碰库`, async () => {
      const r = await writeGlobalLesson(fakeSupabase(), { ...CLEAN, provenance: prov })

      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.reason).toBe('invalid')
      expect(upserted).toHaveLength(0)
      expect(upsertAttempts).toBe(0)
      expect(updates).toHaveLength(0)
      expect(fromCalls).toBe(0)
    })
  }
})

describe('writeGlobalLesson — 正文只是规则编号就不写（V18 第 1 组延伸）', () => {
  for (const lesson of ['C-13', ' RL-01 ']) {
    it(`正文是编号「${lesson}」→ invalid，且完全不碰库`, async () => {
      const r = await writeGlobalLesson(fakeSupabase(), { ...CLEAN, lesson, provenance: PROV })

      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.reason).toBe('invalid')
      expect(upserted).toHaveLength(0)
      expect(upsertAttempts).toBe(0)
      expect(fromCalls).toBe(0)
    })
  }
})

describe('writeGlobalLesson — 完整来源只发一次 upsert（V18 第 2 组）', () => {
  it('一次写入，载荷同时含正文、来源字段、脱敏时间与结论', async () => {
    const before = Date.now()
    const r = await writeGlobalLesson(fakeSupabase(), { ...CLEAN, provenance: PROV })
    const after = Date.now()

    expect(r.ok).toBe(true)
    expect(upsertAttempts).toBe(1)
    expect(upserted).toHaveLength(1)
    expect(updates).toHaveLength(0)

    const row = upserted[0]
    expect(row.lesson_key).toBe('distill:card-x#p1')
    expect(row.lesson).toBe(CLEAN.lesson)
    expect(row.rationale).toBe(CLEAN.rationale)
    expect(row.is_active).toBe(true)
    expect(row.source_point_key).toBe('card-x#p1')
    expect(row.source_card_id).toBe('card-x')
    expect(row.pillar).toBe('ads')
    expect(row.valid_until).toBe(new Date(FUTURE).toISOString())

    const sanitizedAt = sanitizedAtOf(row)
    const sanitizedMs = Date.parse(sanitizedAt)
    expect(Number.isFinite(sanitizedMs)).toBe(true)
    expect(sanitizedMs).toBeGreaterThanOrEqual(before - 5000)
    expect(sanitizedMs).toBeLessThanOrEqual(after + 5000)

    // updated_at 与 sanitized_at 同源（一次调用只取一次时钟）。
    expect(row.updated_at).toBe(sanitizedAt)

    // 脱敏结论由函数自己填，必须是本次通过的那一份。
    expect(row).toMatchObject({ shareability_verdict: { shareable: true } })

    // 没给复核时间就不写这一列。
    expect(row.last_reviewed_at).toBeUndefined()
  })

  it('给了复核时间就写成 ISO', async () => {
    const r = await writeGlobalLesson(fakeSupabase(), {
      ...CLEAN,
      provenance: { ...PROV, lastReviewedAt: REVIEWED },
    })

    expect(r.ok).toBe(true)
    expect(upsertAttempts).toBe(1)
    expect(upserted[0].last_reviewed_at).toBe(new Date(REVIEWED).toISOString())
    expect(updates).toHaveLength(0)
  })
})

describe('writeGlobalLesson — 调用方不能伪造脱敏时间与结论（V18 第 3 组）', () => {
  it('传进来的 sanitized_at / shareabilityVerdict 被忽略', async () => {
    // 先存成变量：这样 TS 的"多余属性"检查不生效，模拟绕过类型往里塞字段。
    const forged = {
      ...PROV,
      sanitizedAt: '2000-01-01T00:00:00.000Z',
      sanitized_at: '2000-01-01T00:00:00.000Z',
      shareabilityVerdict: { shareable: false },
    }

    const r = await writeGlobalLesson(fakeSupabase(), { ...CLEAN, provenance: forged })

    expect(r.ok).toBe(true)
    const row = upserted[0]
    expect(sanitizedAtOf(row)).not.toBe('2000-01-01T00:00:00.000Z')
    expect(row).toMatchObject({ shareability_verdict: { shareable: true } })
  })
})

describe('writeGlobalLesson — 写库失败与脱敏拦截（V18 第 4/5 组）', () => {
  it('upsert 报错如实返回，且没有第二次写', async () => {
    dbError = 'boom'
    const r = await writeGlobalLesson(fakeSupabase(), { ...CLEAN, provenance: PROV })

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('db')
    if (r.reason !== 'db') throw new Error('应该是写库失败')
    expect(r.error).toBe('boom')
    expect(upsertAttempts).toBe(1)
    expect(upserted).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })

  it('正文含客户名 → not_shareable，一次 upsert 都没有', async () => {
    const r = await writeGlobalLesson(fakeSupabase(['Acme Travel']), {
      ...CLEAN,
      lesson: 'Acme Travel 的重定向组要显式关掉自动放宽',
      provenance: PROV,
    })

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('not_shareable')
    expect(upsertAttempts).toBe(0)
    expect(upserted).toHaveLength(0)
    expect(fromCalls).toBeGreaterThan(0)
  })
})

describe('writeGlobalLesson — 没有 provenance 的老路径逐列不变（V18 第 6 组）', () => {
  it('只写老十列，一个来源字段都不多发', async () => {
    const r = await writeGlobalLesson(fakeSupabase(), CLEAN)

    expect(r.ok).toBe(true)
    expect(upsertAttempts).toBe(1)
    expect(upserted).toHaveLength(1)
    expect(updates).toHaveLength(0)

    const row = upserted[0]
    expect(Object.keys(row).sort()).toEqual(LEGACY_COLUMNS)
    expect(row.lesson_key).toBe('distill:card-x#p1')
    expect(row.scope).toBe('global')
    expect(row.industry).toBeNull()
    expect(row.flywheel).toBeNull()
    expect(row.lesson).toBe(CLEAN.lesson)
    expect(row.rationale).toBe(CLEAN.rationale)
    expect(row.confidence).toBe(0.8)
    expect(row.evidence).toBeNull()
    expect(row.is_active).toBe(true)
    expect(typeof row.updated_at).toBe('string')
  })
})

describe('validateProvenance — 纯函数，不读库不写库', () => {
  it('合格的来源返回 null', () => {
    expect(validateProvenance(PROV, CLEAN.lesson, new Date(NOW))).toBeNull()
  })

  it('有效期在过去返回中文原因', () => {
    const message = validateProvenance({ ...PROV, validUntil: PAST }, CLEAN.lesson, new Date(NOW))
    expect(message).not.toBeNull()
    if (message === null) throw new Error('过去的有效期应该被拒')
    expect(message.length).toBeGreaterThan(0)
  })
})

describe('writeGlobalLessonOrThrow — 带来源的强制版', () => {
  it('干净的正常写入，来源字段落在同一条 upsert 里', async () => {
    await expect(
      writeGlobalLessonOrThrow(fakeSupabase(), { ...CLEAN, provenance: PROV }),
    ).resolves.toBeUndefined()

    expect(upsertAttempts).toBe(1)
    expect(upserted).toHaveLength(1)
    expect(upserted[0].source_point_key).toBe('card-x#p1')
  })
})
