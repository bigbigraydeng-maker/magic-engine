/**
 * 唯一写入口的测试。
 *
 * 守一条：**脱敏没过就必须写不进去**。
 * 这条闸原来零个生产调用方 —— 库里 11 条全是手敲 SQL 塞进去的，5 条在漏客户数据。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { writeGlobalLesson, writeGlobalLessonOrThrow, type LessonInput } from '../write-lesson'

const CLEAN: LessonInput = {
  lessonKey: 'test-lesson',
  scope: 'global',
  lesson: '重定向组必须显式关掉自动放宽，否则名单形同虚设',
  rationale: '平台会自作主张扩量，名字写着重定向不等于真在做重定向',
  confidence: 0.8,
}

let upserted: Record<string, unknown>[] = []
let dbError: string | null = null

function fakeSupabase(clientNames: string[] = [], personNames: string[] = []): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === 'clients') {
        return { select: async () => ({ data: clientNames.map((name) => ({ name })), error: null }) }
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
        }
      }
      return {
        upsert: async (row: Record<string, unknown>) => {
          if (dbError) return { error: { message: dbError } }
          upserted.push(row)
          return { error: null }
        },
      }
    },
  } as unknown as SupabaseClient
}

beforeEach(() => {
  upserted = []
  dbError = null
})

describe('writeGlobalLesson — 脱敏没过就写不进去', () => {
  it('干净的经验写得进去', async () => {
    const r = await writeGlobalLesson(fakeSupabase(), CLEAN)
    expect(r.ok).toBe(true)
    expect(upserted).toHaveLength(1)
    expect(upserted[0].lesson_key).toBe('test-lesson')
  })

  it('正文带金额 → 不写，并逐条给出命中', async () => {
    const r = await writeGlobalLesson(fakeSupabase(), {
      ...CLEAN,
      lesson: '每条线索 $6.35，比私信便宜',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    if (r.reason !== 'not_shareable') throw new Error('应该按脱敏没过拦下')
    expect(r.verdict.findings.some((f) => f.kind === 'money')).toBe(true)
    expect(upserted).toHaveLength(0)
  })

  it('金额藏在 rationale 里也拦得住（两个字段都会进提示词）', async () => {
    const r = await writeGlobalLesson(fakeSupabase(), {
      ...CLEAN,
      rationale: '实测花了 86.57 NZD',
    })
    expect(r.ok).toBe(false)
    expect(upserted).toHaveLength(0)
  })

  it('客户名从库里查，不由调用方决定查得严不严', async () => {
    const r = await writeGlobalLesson(fakeSupabase(['Roman HU']), {
      ...CLEAN,
      lesson: 'Roman HU 那条广告证明了学区词有效',
    })
    expect(r.ok).toBe(false)
    if (r.ok || r.reason !== 'not_shareable') throw new Error('应该按脱敏没过拦下')
    expect(r.verdict.findings.some((f) => f.kind === 'client_name')).toBe(true)
  })

  it('买家真名拦得住', async () => {
    const r = await writeGlobalLesson(fakeSupabase([], ['Boris Brown']), {
      ...CLEAN,
      lesson: 'Boris Brown 收到中文问候语后直接拉黑',
    })
    expect(r.ok).toBe(false)
    if (r.ok || r.reason !== 'not_shareable') throw new Error('应该按脱敏没过拦下')
    expect(r.verdict.findings.some((f) => f.kind === 'person_name')).toBe(true)
  })

  it('个案放 evidence 就能过 —— evidence 不进提示词', async () => {
    const r = await writeGlobalLesson(fakeSupabase(['Roman HU']), {
      ...CLEAN,
      evidence: { client: 'Roman HU', costPerLead: 6.35, leads: 13 },
    })
    expect(r.ok).toBe(true)
    expect(upserted[0].evidence).toMatchObject({ costPerLead: 6.35 })
  })
})

describe('writeGlobalLesson — 参数本身的坑', () => {
  it('行业作用域没给行业 → 拒（否则静默变成谁都读得到）', async () => {
    const r = await writeGlobalLesson(fakeSupabase(), { ...CLEAN, scope: 'industry' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('invalid')
  })

  it('非行业作用域不写 industry 字段', async () => {
    await writeGlobalLesson(fakeSupabase(), CLEAN)
    expect(upserted[0].industry).toBeNull()
  })

  it('置信度超范围 → 拒', async () => {
    expect((await writeGlobalLesson(fakeSupabase(), { ...CLEAN, confidence: 1.5 })).ok).toBe(false)
    expect((await writeGlobalLesson(fakeSupabase(), { ...CLEAN, confidence: -1 })).ok).toBe(false)
  })

  it('空正文 → 拒', async () => {
    expect((await writeGlobalLesson(fakeSupabase(), { ...CLEAN, lesson: '  ' })).ok).toBe(false)
  })

  it('库报错如实返回，不当成写成功', async () => {
    dbError = 'permission denied'
    const r = await writeGlobalLesson(fakeSupabase(), CLEAN)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('db')
  })
})

describe('writeGlobalLessonOrThrow — 给 cron / 后台 agent 的强制版', () => {
  it('脱敏没过就抛，不是返回', async () => {
    await expect(
      writeGlobalLessonOrThrow(fakeSupabase(), { ...CLEAN, lesson: '每条线索 $6.35' }),
    ).rejects.toThrow(/拒绝写入公共经验池/)
  })

  it('干净的正常写入', async () => {
    await expect(writeGlobalLessonOrThrow(fakeSupabase(), CLEAN)).resolves.toBeUndefined()
    expect(upserted).toHaveLength(1)
  })
})
