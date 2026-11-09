/**
 * `advanceContactStage()` 测试——从 `crm/contacts/[cid]/stage/route.ts` 抽出来的
 * 纯逻辑（2026-09-15）。行为要跟原路由完全一致（那边有 7 条既有测试锁着），这里
 * 额外锁住 `nal-mark-won` 端点依赖的那个具体契约：`changed:false` 不是错误，
 * 只是"阶段没有新东西要记"。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { advanceContactStage } from '../advance-contact-stage'

type Row = Record<string, unknown>

const CONTACTS: Row[] = [
  { id: 'a1', client_id: 'client-a', stage: 'new' },
  { id: 'a2', client_id: 'client-a', stage: 'won' },
  { id: 'b1', client_id: 'client-b', stage: 'new' },
  // 刚导入、还没人标过阶段——「大家的跟进到哪步都还空着」是常态，不是异常。
  { id: 'a3', client_id: 'client-a', stage: null },
]

const STAGES: Row[] = [
  { client_id: 'client-a', stage_key: 'won' },
  { client_id: 'client-b', stage_key: 'won' },
]

let updates: Array<{ patch: Row; filters: Array<[string, unknown]> }>
let inserts: Row[]

function fakeDb(table: string) {
  const filters: Array<[string, unknown]> = []
  const rowsOf = (): Row[] => {
    const src = table === 'contacts' ? CONTACTS : table === 'client_pipeline_stages' ? STAGES : []
    return src.filter((r) => filters.every(([c, v]) => r[c] === v))
  }
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      filters.push([col, val])
      return builder
    },
    maybeSingle: async () => ({ data: rowsOf()[0] ?? null, error: null }),
    update: (patch: Row) => {
      updates.push({ patch, filters })
      return builder
    },
    insert: (row: Row) => {
      inserts.push(row)
      return {
        select: () => ({ single: async () => ({ data: { id: 'evt-1' }, error: null }) }),
        then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
      }
    },
    then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
  }
  return builder
}

/**
 * 实测核实：`advanceContactStage()` 源码里对传入的 `supabase` 参数只调用
 * `.from(table)`（4 次：contacts 两次、client_pipeline_stages 一次、
 * contact_stage_events 一次），不调用 `SupabaseClient` 的其它方法——这个假件
 * 只需要实现 `.from`，跟原 `stage/route.test.ts` 已验证过的假件是同一份实现搬过来。
 */
function asSupabase(fromFn: ReturnType<typeof vi.fn>): Parameters<typeof advanceContactStage>[0] {
  return { from: fromFn } as unknown as Parameters<typeof advanceContactStage>[0]
}

const fromFn = vi.fn()
const supabase = asSupabase(fromFn)

beforeEach(() => {
  updates = []
  inserts = []
  fromFn.mockImplementation(fakeDb)
})

describe('advanceContactStage', () => {
  it('正常推进：写事件、更新阶段、changed:true', async () => {
    const r = await advanceContactStage(supabase, 'client-a', 'a1', 'won', 'note', 'fde@example.com')
    expect(r).toMatchObject({ ok: true, stage: 'won', changed: true })
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({ from_stage: 'new', to_stage: 'won', changed_by: 'fde@example.com' })
    expect(updates).toHaveLength(1)
  })

  it('已经在目标阶段：changed:false，不写重复事件——这不是错误，调用方必须继续往下走', async () => {
    const r = await advanceContactStage(supabase, 'client-a', 'a2', 'won', null, 'fde@example.com')
    expect(r).toMatchObject({ ok: true, stage: 'won', changed: false })
    expect(inserts).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })

  it('IDOR：contact 不属于这个 client → 404，不写库', async () => {
    const r = await advanceContactStage(supabase, 'client-a', 'b1', 'won', null, 'fde@example.com')
    expect(r).toMatchObject({ ok: false, status: 404 })
    expect(inserts).toHaveLength(0)
  })

  it('目标阶段不存在于该客户 → 400', async () => {
    const r = await advanceContactStage(supabase, 'client-a', 'a1', 'no-such-stage', null, 'fde@example.com')
    expect(r).toMatchObject({ ok: false, status: 400 })
  })

  describe('expectedFromStage（2026-09-28 并发保护）', () => {
    it('不传这个参数 → 老行为逐字不变，正常写库', async () => {
      const r = await advanceContactStage(supabase, 'client-a', 'a1', 'won', 'note', 'fde@example.com')
      expect(r).toMatchObject({ ok: true, changed: true })
      expect(inserts).toHaveLength(1)
    })

    it('传了、跟库里现在的阶段一致 → 照常写库', async () => {
      const r = await advanceContactStage(supabase, 'client-a', 'a1', 'won', 'note', 'fde@example.com', 'new')
      expect(r).toMatchObject({ ok: true, changed: true })
      expect(inserts).toHaveLength(1)
    })

    it('🔴 传了、跟库里现在的阶段不一致（别人已经先改过）→ 409，不写事件、不改库', async () => {
      // a1 库里实际是 'new'，调用方却以为是 'contacted'——说明中间被别人动过了。
      const r = await advanceContactStage(supabase, 'client-a', 'a1', 'won', 'note', 'fde@example.com', 'contacted')
      expect(r).toMatchObject({ ok: false, status: 409, actualStage: 'new' })
      expect(inserts).toHaveLength(0)
      expect(updates).toHaveLength(0)
    })

    it('并发闸排在合法值闸前面：目标阶段不存在 + 并发不一致，报的是 409 不是 400', async () => {
      const r = await advanceContactStage(supabase, 'client-a', 'a1', 'no-such-stage', null, 'fde@example.com', 'contacted')
      expect(r).toMatchObject({ ok: false, status: 409 })
    })

    /**
     * 🔴 魏征 2026-09-28 复审 B2 实现时查出：`null` 不是"等价于不传"——它是
     * 「我看到这个人还没标过任何阶段」这句真话，路由层曾经把它跟"整个字段没传"
     * 都塌成 undefined，于是对这批人并发闸形同虚设。这里锁住正确行为。
     */
    it('expectedFromStage: null，且库里这个人确实还没标过 → 照常写库（两边都是"还没标"，没有冲突）', async () => {
      const r = await advanceContactStage(supabase, 'client-a', 'a3', 'won', null, 'fde@example.com', null)
      expect(r).toMatchObject({ ok: true, changed: true })
    })

    it('🔴 expectedFromStage: null，但库里这个人其实已经被标过阶段了 → 409，null 照样要触发检查', async () => {
      // a1 库里实际是 'new'，调用方却传 null（以为还没人标过）——同一种"两人抢第一下"的场景。
      const r = await advanceContactStage(supabase, 'client-a', 'a1', 'won', null, 'fde@example.com', null)
      expect(r).toMatchObject({ ok: false, status: 409, actualStage: 'new' })
      expect(inserts).toHaveLength(0)
    })
  })
})
