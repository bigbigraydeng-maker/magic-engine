/**
 * 自动打标的**落库**那一半 —— 判定逻辑在 qualified-buyer.test.ts，这里钉三件事：
 *   1. 审计真的写了，而且写的是「系统自动」那个标记（不然日后答不出 AI 标错了多少）
 *   2. 写库时**再判一次当前档**（取数到写库之间中介手工改过的，不许被盖掉）
 *   3. 没配「真买家」这一档的客户（比如 CTS 那套旅游漏斗）一步都不往下走
 *
 * 变异验证（2026-08-01 实跑）：
 *   把 applyDecision 里的 `.or(stillEligible)` 删掉
 *   → 「取数之后人手工改过 → 不许盖掉」变红（UPDATE 少了那道条件，人的判断被覆盖）
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import { autoTagQualifiedBuyers } from '../qualified-buyer-autotag'
import { AUTO_TAG_ACTOR } from '../qualified-buyer'

type Row = Record<string, unknown>

interface Fixture {
  stages: Row[]
  conversations: Row[]
  messages: Row[]
  briefs: Row[]
  contacts: Row[]
  /** 模拟「这一行在写库那一刻已经不满足放行条件了」。 */
  stageMovedUnderUs?: boolean
}

let fixture: Fixture
let updates: Row[]
let audits: Row[]

function baseFixture(): Fixture {
  return {
    stages: [{ client_id: 'agency', stage_key: 'qualified' }],
    conversations: [{ id: 'conv1', client_id: 'agency', contact_id: 'buyer1' }],
    messages: [
      { conversation_id: 'conv1', body: '这套还在吗' },
      { conversation_id: 'conv1', body: '几个卧室' },
      { conversation_id: 'conv1', body: '车位有几个' },
    ],
    briefs: [{ conversation_id: 'conv1', customer_needs: ['想了解户型'] }],
    contacts: [{ id: 'buyer1', stage: null }],
  }
}

/** 只实现本模块真正用到的链式调用。 */
function fakeFrom(table: string): unknown {
  const builder: Record<string, unknown> = {}
  let updatePatch: Row | null = null

  const rows = (): Row[] => {
    switch (table) {
      case 'client_pipeline_stages':
        return fixture.stages
      case 'conversations':
        return fixture.conversations
      case 'conversation_messages':
        return fixture.messages
      case 'conversation_briefs':
        return fixture.briefs
      case 'contacts':
        return fixture.contacts
      default:
        return []
    }
  }

  const passthrough = () => builder
  Object.assign(builder, {
    select: () => builder,
    eq: passthrough,
    in: passthrough,
    not: passthrough,
    order: passthrough,
    limit: passthrough,
    update: (patch: Row) => {
      updatePatch = patch
      return builder
    },
    // `.or()` 是并发保护那道条件。它被调用过 → 说明写库时又判了一次当前档。
    or: (expr: string) => {
      builder.__orCalled = expr
      return builder
    },
    insert: async (row: Row) => {
      audits.push(row)
      return { error: null }
    },
    then: (resolve: (v: { data: Row[] | null; error: null }) => unknown) => {
      if (updatePatch) {
        const blocked = fixture.stageMovedUnderUs && builder.__orCalled
        if (!blocked) updates.push(updatePatch)
        return resolve({ data: blocked ? [] : [{ id: 'buyer1' }], error: null })
      }
      return resolve({ data: rows(), error: null })
    },
  })

  return builder
}

beforeEach(() => {
  fixture = baseFixture()
  updates = []
  audits = []
  vi.mocked(supabaseAdmin.from).mockImplementation(fakeFrom as never)
})

const NOW = new Date('2026-08-01T09:00:00Z')

describe('自动打标 · 落库', () => {
  it('够格的人被标成「真买家」', async () => {
    const result = await autoTagQualifiedBuyers(NOW)
    expect(result).toMatchObject({ examined: 1, decided: 1, upgraded: 1, failed: 0 })
    expect(updates).toHaveLength(1)
    expect(updates[0].stage).toBe('qualified')
  })

  it('🔴 审计写明是自动标的，跟人工标的分得开', async () => {
    await autoTagQualifiedBuyers(NOW)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      client_id: 'agency',
      contact_id: 'buyer1',
      from_stage: null,
      to_stage: 'qualified',
      changed_by: AUTO_TAG_ACTOR,
    })
    // 依据也要留下 —— 以后要能一条一条回看凭什么标的。
    expect(String(audits[0].note)).toContain('3 条')
  })

  it('🔴 取数之后人手工改过 → 不许盖掉，也不留审计', async () => {
    fixture.stageMovedUnderUs = true
    const result = await autoTagQualifiedBuyers(NOW)
    expect(result).toMatchObject({ decided: 1, upgraded: 0, failed: 0 })
    expect(updates).toEqual([])
    expect(audits).toEqual([])
  })

  it('人已经手工推到「到场了」→ 压根不产生决定', async () => {
    fixture.contacts = [{ id: 'buyer1', stage: 'open_home_attended' }]
    const result = await autoTagQualifiedBuyers(NOW)
    expect(result).toMatchObject({ decided: 0, upgraded: 0 })
    expect(updates).toEqual([])
    expect(audits).toEqual([])
  })

  it('客户没配「真买家」这一档（CTS 那套旅游漏斗）→ 一步都不往下走', async () => {
    fixture.stages = []
    const result = await autoTagQualifiedBuyers(NOW)
    expect(result).toEqual({ examined: 0, decided: 0, upgraded: 0, failed: 0 })
    expect(updates).toEqual([])
  })

  it('客户只发了 1 条、我们回了一堆 → 不标（出站消息压根没查出来）', async () => {
    fixture.messages = [{ conversation_id: 'conv1', body: '你好' }]
    fixture.briefs = [{ conversation_id: 'conv1', customer_needs: ['问了价格'] }]
    const result = await autoTagQualifiedBuyers(NOW)
    expect(result).toMatchObject({ examined: 1, decided: 0, upgraded: 0 })
    expect(updates).toEqual([])
  })

  it('同一个人的多段对话合起来算 —— 阶段挂在人身上不是挂在对话上', async () => {
    fixture.conversations = [
      { id: 'conv1', client_id: 'agency', contact_id: 'buyer1' },
      { id: 'conv2', client_id: 'agency', contact_id: 'buyer1' },
    ]
    fixture.messages = [
      { conversation_id: 'conv1', body: '这套还在吗' },
      { conversation_id: 'conv2', body: '几个卧室' },
      { conversation_id: 'conv2', body: '车位有几个' },
    ]
    const result = await autoTagQualifiedBuyers(NOW)
    expect(result).toMatchObject({ examined: 1, decided: 1, upgraded: 1 })
  })

  it('没有任何对话 → 空跑，不炸', async () => {
    fixture.conversations = []
    const result = await autoTagQualifiedBuyers(NOW)
    expect(result).toEqual({ examined: 0, decided: 0, upgraded: 0, failed: 0 })
  })
})
