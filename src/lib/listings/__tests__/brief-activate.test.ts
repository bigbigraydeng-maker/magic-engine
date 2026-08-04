/**
 * 「让一版生效」的测试。
 *
 * 🔴 变异测试靶子:把 brief-queries.activateBrief 里那段「先把当前 active 置成
 *    superseded」整段删掉,本文件里带「🔴 顶掉」标记的用例必须变红。
 *
 * 为什么这段容易被顺手删:它看起来像清理旧数据,实际上是这个函数存在的理由。
 * 删掉之后 —— 数据库那条 partial unique index 会把第二步顶回来(生效按钮报错);
 * 万一索引没建上,就会出现两个 active,而「现在生效的是哪一版」是投放和内容的
 * 输入,有歧义的话下游全乱,而且没有任何报错。
 *
 * 顺带钉住另外两条:旧版本不能重新生效、置 superseded 失败时绝不往下走。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import { activateBrief } from '../brief-queries'

const LISTING = 'listing-1'
const BRIEF = 'brief-2'

interface Recorded {
  op: 'select' | 'update'
  payload: Record<string, unknown>
  filters: string[]
}

let recorded: Recorded[] = []
let targetRow: Record<string, unknown> | null = null
let supersedeError: { message: string } | null = null

/**
 * 一个够用的假 supabase 查询构造器:记录每一次 from().update()/select() 的
 * payload 和过滤条件,让测试能断言「第 ① 步到底发出去了没有、条件对不对」。
 */
function installMock() {
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const rec: Recorded = { op: 'select', payload: {}, filters: [] }

    const isSupersede = () => rec.payload.status === 'superseded'

    const chain = {
      select: () => chain,
      update: (payload: Record<string, unknown>) => {
        rec.op = 'update'
        rec.payload = payload
        recorded.push(rec)
        return chain
      },
      eq: (col: string, val: unknown) => { rec.filters.push(`eq:${col}=${String(val)}`); return chain },
      neq: (col: string, val: unknown) => { rec.filters.push(`neq:${col}=${String(val)}`); return chain },
      maybeSingle: () => Promise.resolve({ data: targetRow, error: null }),
      single: () =>
        Promise.resolve({ data: { ...(targetRow ?? {}), status: 'active' }, error: null }),
      // update 链没有 .single() 收尾时(第 ① 步就是这样)直接被 await。
      then: (resolve: (v: { data: null; error: unknown }) => unknown) =>
        Promise.resolve({ data: null, error: isSupersede() ? supersedeError : null }).then(resolve),
    }
    return chain
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  recorded = []
  supersedeError = null
  targetRow = { id: BRIEF, listing_id: LISTING, version: 2, status: 'draft' }
  installMock()
})

const updates = () => recorded.filter(r => r.op === 'update')
const supersedeCall = () => updates().find(r => r.payload.status === 'superseded')
const activateCall = () => updates().find(r => r.payload.status === 'active')

describe('activateBrief', () => {
  it('🔴 顶掉:生效前必须把这套房当前 active 的那版置成「旧版本」', async () => {
    const r = await activateBrief(LISTING, BRIEF)
    expect(r.ok).toBe(true)

    const supersede = supersedeCall()
    expect(supersede, '缺少「把旧的 active 置 superseded」这一步').toBeDefined()
    // 必须只影响这套房的、当前 active 的、且不是目标那一版。
    expect(supersede?.filters).toContain(`eq:listing_id=${LISTING}`)
    expect(supersede?.filters).toContain('eq:status=active')
    expect(supersede?.filters).toContain(`neq:id=${BRIEF}`)
  })

  it('🔴 顶掉:顺序不能反 —— 先置旧的,再置新的', async () => {
    await activateBrief(LISTING, BRIEF)
    const ops = updates().map(u => u.payload.status)
    expect(ops).toEqual(['superseded', 'active'])
  })

  it('🔴 顶掉:置「旧版本」失败时,绝不能继续把新的置成生效', async () => {
    supersedeError = { message: 'db down' }
    const r = await activateBrief(LISTING, BRIEF)

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(500)
    expect(activateCall(), '第 ① 步失败了却仍然把新版本置成了 active').toBeUndefined()
  })

  it('目标那版最终被置成 active,且限定在这套房下', async () => {
    await activateBrief(LISTING, BRIEF)
    const act = activateCall()
    expect(act?.filters).toContain(`eq:id=${BRIEF}`)
    expect(act?.filters).toContain(`eq:listing_id=${LISTING}`)
  })

  it('已经生效的那版再点一次 → 直接返回,不发任何写入', async () => {
    targetRow = { id: BRIEF, listing_id: LISTING, version: 2, status: 'active' }
    const r = await activateBrief(LISTING, BRIEF)
    expect(r.ok).toBe(true)
    expect(updates()).toHaveLength(0)
  })

  it('旧版本不能重新生效 —— 否则「当初以为什么」的时间线会乱', async () => {
    targetRow = { id: BRIEF, listing_id: LISTING, version: 1, status: 'superseded' }
    const r = await activateBrief(LISTING, BRIEF)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(400)
    expect(updates()).toHaveLength(0)
  })

  it('档案不属于这套房 → 404,不写任何东西(拿别人的档案 id 换不进来)', async () => {
    targetRow = null
    const r = await activateBrief(LISTING, BRIEF)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(404)
    expect(updates()).toHaveLength(0)
  })
})
