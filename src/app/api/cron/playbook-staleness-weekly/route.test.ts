import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { validateFindingsPayload } from '@/lib/pm-todo/playbook-staleness-validation'

const VALID_FINDING = {
  playbook_name: 'SEO通用经验手册',
  playbook_path: 'playbook-seo-general.md',
  quoted_line: '封装在 src/lib/dataforseo/ 的 serp.ts — getSerpPage(query, ...)',
  reference_text: 'getSerpPage',
  suspected_reason: 'grep src/ 找不到这个函数了',
  how_to_verify: '在本地仓库 grep 一下还在不在',
}

describe('validateFindingsPayload（纯函数，独立于 Supabase/Next）', () => {
  it('合法的一条 finding → 通过', () => {
    const result = validateFindingsPayload({ findings: [VALID_FINDING] })
    expect(result.ok).toBe(true)
    expect(result.findings).toHaveLength(1)
  })

  it('空数组 → 通过（这周查下来一条问题都没有，是合法状态）', () => {
    const result = validateFindingsPayload({ findings: [] })
    expect(result.ok).toBe(true)
    expect(result.findings).toHaveLength(0)
  })

  it('body 不是 { findings: [...] } 形状 → 拒绝', () => {
    expect(validateFindingsPayload(null).ok).toBe(false)
    expect(validateFindingsPayload({}).ok).toBe(false)
    expect(validateFindingsPayload({ findings: 'not-an-array' }).ok).toBe(false)
  })

  it('playbook_path 不在 7 本手册白名单里 → 整批拒绝，不是丢掉这一条', () => {
    const result = validateFindingsPayload({
      findings: [{ ...VALID_FINDING, playbook_path: 'playbook-does-not-exist.md' }],
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('playbook_path')
  })

  it('缺字段 → 拒绝', () => {
    const { how_to_verify: _drop, ...missing } = VALID_FINDING
    const result = validateFindingsPayload({ findings: [missing] })
    expect(result.ok).toBe(false)
  })

  it('字段超长 → 拒绝（不许一条巨大的字符串把表撑爆）', () => {
    const result = validateFindingsPayload({
      findings: [{ ...VALID_FINDING, quoted_line: 'x'.repeat(3000) }],
    })
    expect(result.ok).toBe(false)
  })

  it('超过条数上限 → 整批拒绝', () => {
    const many = Array.from({ length: 201 }, () => VALID_FINDING)
    const result = validateFindingsPayload({ findings: many })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('上限')
  })

  it('批内同一本手册出现重复的 reference_text → 整批拒绝（否则 upsert 会在 Postgres 层报错）', () => {
    const result = validateFindingsPayload({ findings: [VALID_FINDING, { ...VALID_FINDING }] })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('重复')
  })

  it('不同手册里出现同名引用 → 允许（playbook_path 不同，不算重复）', () => {
    const result = validateFindingsPayload({
      findings: [VALID_FINDING, { ...VALID_FINDING, playbook_path: 'playbook-geo-general.md' }],
    })
    expect(result.ok).toBe(true)
    expect(result.findings).toHaveLength(2)
  })
})

describe('POST /api/cron/playbook-staleness-weekly', () => {
  // callOrder 记录 delete/upsert 的真实调用顺序——只断言"各调用了一次"抓不出
  // "谁先谁后被写反了"这类回归（实施后复审 2026-09-24 指出的缺口），必须记顺序。
  const mocks = vi.hoisted(() => ({ deleteFn: vi.fn(), upsertFn: vi.fn(), finish: vi.fn(), callOrder: [] as string[] }))

  vi.mock('@/lib/supabase', () => ({
    supabaseAdmin: {
      from: vi.fn(() => ({
        delete: () => ({ not: mocks.deleteFn }),
        upsert: mocks.upsertFn,
      })),
    },
  }))
  vi.mock('@/lib/cron/run-logger', () => ({ startCronRun: async () => ({ finish: mocks.finish }) }))

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
    mocks.callOrder.length = 0
  })

  function req(body: unknown, auth = 'Bearer local-test') {
    return new NextRequest('http://localhost/api/cron/playbook-staleness-weekly', {
      method: 'POST',
      headers: { authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('没有 Bearer CRON_SECRET → 401，不落库', async () => {
    vi.stubEnv('CRON_SECRET', 'local-test')
    mocks.deleteFn.mockResolvedValue({ error: null })
    mocks.upsertFn.mockResolvedValue({ error: null })
    const { POST } = await import('./route')
    const res = await POST(req({ findings: [] }, 'Bearer wrong'))
    expect(res.status).toBe(401)
    expect(mocks.deleteFn).not.toHaveBeenCalled()
  })

  it('payload 不合规 → 400，不落库', async () => {
    vi.stubEnv('CRON_SECRET', 'local-test')
    mocks.deleteFn.mockResolvedValue({ error: null })
    mocks.upsertFn.mockResolvedValue({ error: null })
    const { POST } = await import('./route')
    const res = await POST(req({ findings: [{ ...VALID_FINDING, playbook_path: 'nope.md' }] }))
    expect(res.status).toBe(400)
    expect(mocks.deleteFn).not.toHaveBeenCalled()
  })

  it('合法 payload → 先清空整张表再写入本周结果（全量替换，顺序不能反）', async () => {
    vi.stubEnv('CRON_SECRET', 'local-test')
    mocks.deleteFn.mockImplementation(async () => {
      mocks.callOrder.push('delete')
      return { error: null }
    })
    mocks.upsertFn.mockImplementation(async () => {
      mocks.callOrder.push('upsert')
      return { error: null }
    })
    const { POST } = await import('./route')
    const res = await POST(req({ findings: [VALID_FINDING] }))
    expect(res.status).toBe(200)
    expect((await res.json()).count).toBe(1)
    expect(mocks.deleteFn).toHaveBeenCalledTimes(1)
    expect(mocks.upsertFn).toHaveBeenCalledTimes(1)
    // 顺序反了的话（先 upsert 后 delete）会把刚写进去的这一批也删掉——
    // 这正是"全量替换=自愈"这个设计的不变量，必须锁住调用顺序，不能只锁次数。
    expect(mocks.callOrder).toEqual(['delete', 'upsert'])
    expect(mocks.upsertFn.mock.calls[0][1]).toMatchObject({ onConflict: 'playbook_path,reference_text' })
  })

  it('空 findings（这周没查到问题）→ 清空表，但不调用 upsert', async () => {
    vi.stubEnv('CRON_SECRET', 'local-test')
    mocks.deleteFn.mockResolvedValue({ error: null })
    mocks.upsertFn.mockResolvedValue({ error: null })
    const { POST } = await import('./route')
    const res = await POST(req({ findings: [] }))
    expect(res.status).toBe(200)
    expect(mocks.deleteFn).toHaveBeenCalledTimes(1)
    expect(mocks.upsertFn).not.toHaveBeenCalled()
  })

  it('delete 失败 → 500，记进 cron_run_logs 的 finish 带 failed', async () => {
    vi.stubEnv('CRON_SECRET', 'local-test')
    mocks.deleteFn.mockResolvedValue({ error: { message: '模拟清空失败' } })
    const { POST } = await import('./route')
    const res = await POST(req({ findings: [] }))
    expect(res.status).toBe(500)
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ failed: 1 }))
  })
})
