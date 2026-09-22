/**
 * 核对页的行为测试（Issue #1397 PR3）。
 *
 * 只测板桥复审列为必改的那几条 —— 它们不是"好看"，是**点错了会造成不可逆后果**：
 *   · 「告诉广告平台」必须二次确认（发出去撤不回）
 *   · 「不发送」必须选原因（将来客人问起要能查）
 *   · 超过 7 天的不许点发送（平台不收，点了也是白点）
 *   · 页面上不许出现完整邮箱电话（会被截图、会投屏）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import ConversionsPage from '../page'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'

function outcome(over: Record<string, unknown> = {}) {
  return {
    id: 'o-1',
    outcome_kind: 'purchase',
    order_ref: '84191',
    amount_minor: 2350000,
    currency: 'NZD',
    occurred_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    review_status: 'pending_review',
    reject_reason: null,
    redacted_at: null,
    source_kind: 'inbox_extract',
    created_at: new Date().toISOString(),
    ...over,
  }
}

let fetchMock: ReturnType<typeof vi.fn>

function mountWith(outcomes: unknown[]) {
  fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url.includes('/review')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ review_status: 'approved', send_status: 'confirmed', message: '已发给广告平台并收到确认' }),
      })
    }
    return Promise.resolve({ ok: true, json: async () => ({ outcomes, count: outcomes.length }) })
  })
  vi.stubGlobal('fetch', fetchMock)
  window.history.pushState({}, '', `/dashboard/conversions?client=${CLIENT}`)
  return render(<ConversionsPage />)
}

beforeEach(() => {
  vi.restoreAllMocks()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('🔴 撤不回的动作必须二次确认', () => {
  it('用户取消确认框 → 一个请求都不发', async () => {
    mountWith([outcome()])
    await screen.findByText(/收到定金/)

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByText('✓ 告诉广告平台'))

    expect(confirmSpy).toHaveBeenCalled()
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/review'))
      expect(calls, '用户点了取消，绝不能发出去').toHaveLength(0)
    })
  })

  it('确认框里写明了撤不回', async () => {
    mountWith([outcome()])
    await screen.findByText(/收到定金/)

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByText('✓ 告诉广告平台'))

    expect(confirmSpy.mock.calls[0][0]).toContain('撤不回')
  })

  it('确认之后才真的发，且带上 confirm 标记', async () => {
    mountWith([outcome()])
    await screen.findByText(/收到定金/)

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByText('✓ 告诉广告平台'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/review'))
      expect(call).toBeTruthy()
      const body = JSON.parse((call![1] as RequestInit).body as string)
      expect(body).toMatchObject({ decision: 'approve', confirm: true })
    })
  })
})

describe('🔴 不发送必须给原因', () => {
  it('没选原因时确认按钮点不动', async () => {
    mountWith([outcome()])
    await screen.findByText(/收到定金/)

    fireEvent.click(screen.getByText('✕ 不发送'))
    const submit = await screen.findByText('确认不发送')
    expect(submit).toBeDisabled()
  })

  it('选了原因才能提交，且原因随请求发出', async () => {
    mountWith([outcome()])
    await screen.findByText(/收到定金/)

    fireEvent.click(screen.getByText('✕ 不发送'))
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'duplicate' } })
    fireEvent.click(screen.getByText('确认不发送'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/review'))
      const body = JSON.parse((call![1] as RequestInit).body as string)
      expect(body).toMatchObject({ decision: 'reject', rejectReason: 'duplicate' })
    })
  })
})

describe('🔴 超过 7 天的不许发（平台不收，点了白点）', () => {
  it('发送按钮变灰且点不动', async () => {
    mountWith([outcome({ occurred_at: new Date(Date.now() - 35 * 86_400_000).toISOString() })])
    await screen.findByText(/收到定金/)
    expect(screen.getByText('✓ 告诉广告平台')).toBeDisabled()
  })

  it('直说早了几天，不让人自己算', async () => {
    mountWith([outcome({ occurred_at: new Date(Date.now() - 35 * 86_400_000).toISOString() })])
    expect(await screen.findByText(/已过去 35 天/)).toBeTruthy()
  })
})

describe('🔴 页面不留客户明文（会被截图、会投屏）', () => {
  it('接口不返回邮箱电话，页面上自然也没有', async () => {
    // 列表接口刻意不 select 那两列。这条测试同时钉住"页面没有别的地方偷偷显示它们"。
    mountWith([outcome()])
    await screen.findByText(/收到定金/)
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/@/)
    // 连号数字（电话，规范化后一律 9 位以上，如 NZ「64215551234」11 位）。
    // 门槛从 8 提到 9——名单下载区块（下载文件名带 YYYYMMDD 日期）现在会自动
    // 统计并渲染，8 位的日期字符串不是客户数据，不该被这条测试当成电话误判。
    expect(text).not.toMatch(/\d{9,}/)
  })
})

describe('回写表还没建时优雅降级（不弹红）', () => {
  it('接口报"表不存在"→显示"尚未启用"而不是报错', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('review_status')) {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: 'relation "me_sale_outcomes" does not exist' }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => ({ outcomes: [] }) })
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState({}, '', `/dashboard/conversions?client=${CLIENT}`)
    render(<ConversionsPage />)

    expect(await screen.findByText(/尚未启用/)).toBeTruthy()
    // 不该出现"读取出错"的红色报错
    expect(screen.queryByText(/读取出错/)).toBeNull()
    // 名单下载那块照常在（不受影响）
    expect(screen.getAllByText(/重新统计人数/).length).toBeGreaterThanOrEqual(1)
  })
})

describe('看得懂', () => {
  it('金额显示成人能读的形式，不是最小单位', async () => {
    // 卡片里一处、顶部汇总一处，两处都该是人能读的写法（不是 2350000）
    mountWith([outcome()])
    const hits = await screen.findAllByText(/NZD 23,500\.00/)
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(document.body.textContent).not.toContain('2350000')
  })

  it('三种类型都用大白话', async () => {
    mountWith([
      outcome({ id: 'a', outcome_kind: 'purchase' }),
      outcome({ id: 'b', outcome_kind: 'balance' }),
      outcome({ id: 'c', outcome_kind: 'lead', amount_minor: null, currency: null }),
    ])
    expect(await screen.findByText(/收到定金/)).toBeTruthy()
    expect(screen.getByText(/收到尾款/)).toBeTruthy()
    expect(screen.getByText(/有效咨询/)).toBeTruthy()
  })

  it('页面上不出现内部黑话', async () => {
    mountWith([outcome()])
    await screen.findByText(/收到定金/)
    const text = document.body.textContent ?? ''
    for (const jargon of ['CAPI', '回写', 'writeback', 'pixel', 'event_id', 'in_doubt']) {
      expect(text, `不该出现内部说法「${jargon}」`).not.toContain(jargon)
    }
  })

  it('没有待办时说清楚是"都处理完了"，不是空白页', async () => {
    mountWith([])
    expect(await screen.findByText(/都处理完了/)).toBeTruthy()
  })
})

describe('查看这个客人（否则一屏记录长得都一样，没法判断该不该批）', () => {
  it('有 contact_id 时给出跳转链接，指向客户管理页的直达地址', async () => {
    mountWith([
      outcome({ outcome_kind: 'lead', amount_minor: null, currency: null, contact_id: 'ct-1' }),
    ])
    const link = (await screen.findByText('查看这个客人 →')) as HTMLAnchorElement
    expect(link.closest('a')?.getAttribute('href')).toBe(
      `/dashboard/clients/${CLIENT}/crm/all?contact=ct-1`,
    )
  })

  it('没有 contact_id 时不出现这个链接（没东西可查）', async () => {
    mountWith([outcome({ contact_id: null })])
    await screen.findByText(/收到定金/)
    expect(screen.queryByText('查看这个客人 →')).toBeNull()
  })
})

describe('看得见名字（PM 反馈：一屏记录都长一样，看不出是谁没法判断该不该批）', () => {
  it('customer_first 有值时显示名字，且首字母大写（库里存的是全小写规范化形式）', async () => {
    mountWith([outcome({ customer_first: 'dundee montealegre tan' })])
    expect(await screen.findByText('Dundee Montealegre Tan')).toBeTruthy()
  })

  it('没有 customer_first 时不显示名字那一行，也不报错', async () => {
    mountWith([outcome({ customer_first: null })])
    await screen.findByText(/收到定金/)
    // 没有名字可显示——不应该出现空字符串或 "null" 这类渲染事故
    expect(document.body.textContent).not.toContain('null')
  })
})

describe('键盘批量', () => {
  it('按 Y 触发确认框（一天十来条要能连着批）', async () => {
    mountWith([outcome()])
    await screen.findByText(/收到定金/)

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.keyDown(window, { key: 'y' })
    expect(confirmSpy).toHaveBeenCalled()
  })

  it('按 N 打开原因选择', async () => {
    mountWith([outcome()])
    await screen.findByText(/收到定金/)
    fireEvent.keyDown(window, { key: 'n' })
    expect(await screen.findByText('确认不发送')).toBeTruthy()
  })
})

/**
 * 邮件深链参数：审计 PR #1467 抓到 conversion_needs_review /
 * conversion_send_in_doubt 两条 kind 的 href 都带 ?focus= 或 ?status=in_doubt，
 * 但落地页之前完全忽略这两个 param —— PM 从邮件点进来只看到一个空白页要
 * 自己找那笔。这里补上跳转/滚动行为。
 */
describe('邮件深链 ?focus= 和 ?status= 支持', () => {
  it('?focus=<outcomeId> 把 cursor 跳到那条待办', async () => {
    // scrollIntoView 在 jsdom 里没实现，spy 掉别让它抛
    Element.prototype.scrollIntoView = vi.fn()

    fetchMock = vi.fn().mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          outcomes: [
            outcome({ id: 'first-o' }),
            outcome({ id: 'target-o', order_ref: 'TARGET' }),
            outcome({ id: 'third-o' }),
          ],
          count: 3,
        }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState({}, '', `/dashboard/conversions?client=${CLIENT}&focus=target-o`)
    render(<ConversionsPage />)

    // 三条都渲染出来
    await screen.findByText(/单号 TARGET/)

    // cursor 跳到 target-o（第 2 条，index=1）→ 该行会带上 focus 描边（border-me-ochre）
    // 找到那条卡片 wrapper 并断言它的 class
    const targetCard = screen.getByText(/单号 TARGET/).closest('.cursor-pointer') as HTMLElement | null
    expect(targetCard).toBeTruthy()
    expect(targetCard!.className).toContain('border-me-ochre')

    // scrollIntoView 被调过
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('?focus= 指向不存在的 id → 静默不动，不弹错', async () => {
    Element.prototype.scrollIntoView = vi.fn()

    mountWithFocus('ghost-that-was-processed')

    await screen.findByText(/收到定金/)

    // cursor 保持 0（第一条），不弹错
    expect(screen.queryByText(/读取出错/)).toBeNull()
    expect(screen.queryByText(/找不到/)).toBeNull()
  })
})

function mountWithFocus(focusId: string) {
  fetchMock = vi.fn().mockImplementation(() => {
    return Promise.resolve({
      ok: true,
      json: async () => ({ outcomes: [outcome({ id: 'only-one' })], count: 1 }),
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  window.history.pushState({}, '', `/dashboard/conversions?client=${CLIENT}&focus=${focusId}`)
  return render(<ConversionsPage />)
}
