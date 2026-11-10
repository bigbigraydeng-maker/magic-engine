/**
 * 连邮箱这一块 UI（2026-09-15 重新设计）。
 *
 * PM 反馈旧版「第 1 步 / 第 2 步」并排显示，看不出「多数人只需要做第 2 步，
 * 第 1 步是极少数人才需要的补救」——两个圆圈一样大、一样黑，像是所有人都要
 * 从 1 走到 2。这里钉的是新设计实际解决了那个问题：
 *
 *   1. 直接连邮箱是唯一显眼的主操作，不用先看到「第 1 步」
 *   2. 管理员那条路默认收起，只有真撞墙的人会去点开
 *   3. 管理员批准回来之后，「卡住了」区块自动展开，不用再找一次收起的入口
 *   4. 两条路径各自说清楚「这一步该找谁做」
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitForElementToBeRemoved } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

let searchParams: Record<string, string>

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => searchParams[key] ?? null,
  }),
}))

import { MailboxPanel } from '../MailboxPanel'

function mockFetch(connections: unknown[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ connections }),
    }),
  )
}

async function renderPanel(params: Record<string, string> = {}) {
  searchParams = params
  const utils = render(<MailboxPanel clientId="client-a" />)
  // 等首次 fetch 落地，避免测试跑在「读取中…」那一帧。等这行消失，而不是
  // 等某句正文出现——「还没连」这种短语在已连接/管理员批准等好几种状态的
  // 文案里都会重复出现，挑正文当信号容易撞见多个匹配。
  await waitForElementToBeRemoved(() => screen.queryByText('读取中…'))
  return utils
}

describe('还没连任何邮箱 —— 主操作是直接连，不是先看两个并排的步骤', () => {
  it('只显示一个主操作框：填地址 + 连接这个邮箱', async () => {
    mockFetch([])
    await renderPanel()

    expect(screen.getByPlaceholderText(/要连哪个邮箱/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '连接这个邮箱' })).toBeInTheDocument()
  })

  it('「卡住了」区块默认收起，不会让人以为要先做管理员那一步', async () => {
    mockFetch([])
    await renderPanel()

    expect(screen.queryByRole('button', { name: /复制链接/ })).not.toBeInTheDocument()
    expect(screen.getByText(/卡住了/)).toBeInTheDocument()
  })

  it('点开「卡住了」才看到复制链接的入口，并说清楚这一步该找谁', async () => {
    mockFetch([])
    await renderPanel()

    await userEvent.click(screen.getByText(/卡住了/))

    expect(screen.getByRole('button', { name: /复制链接/ })).toBeInTheDocument()
    expect(screen.getByText(/贵公司管 Microsoft 365 的 IT 同事/)).toBeInTheDocument()
  })

  it('复制链接这一步同时留一个「我自己点」的路——这次批准的人可能就是当前这位', async () => {
    mockFetch([])
    await renderPanel()

    await userEvent.click(screen.getByText(/卡住了/))

    const selfClickLink = screen.getByRole('link', { name: '我自己点' })
    expect(selfClickLink).toHaveAttribute('href', expect.stringContaining('admin=1'))
  })

  it('点「复制链接」把完整地址（带域名）写进剪贴板，不是相对路径——相对路径发去微信打不开', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    mockFetch([])
    await renderPanel()

    await userEvent.click(screen.getByText(/卡住了/))
    await userEvent.click(screen.getByRole('button', { name: /复制链接/ }))

    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/^https?:\/\/.*\/api\/auth\/microsoft\/mail\/start\?clientId=client-a&admin=1$/),
    )
    expect(await screen.findByRole('button', { name: '✓ 已复制' })).toBeInTheDocument()
  })

  it('地址没填时连接按钮不能点', async () => {
    mockFetch([])
    await renderPanel()

    const connectLink = screen.getByRole('link', { name: '连接这个邮箱' })
    expect(connectLink).toHaveAttribute('aria-disabled', 'true')
  })

  it('填了地址，连接链接带上这个地址当 loginHint —— 防止连错到当前登着的账号', async () => {
    mockFetch([])
    await renderPanel()

    await userEvent.type(screen.getByPlaceholderText(/要连哪个邮箱/), 'sales@nalexpress.com')

    const connectLink = screen.getByRole('link', { name: '连接这个邮箱' })
    expect(connectLink).toHaveAttribute(
      'href',
      expect.stringContaining(`loginHint=${encodeURIComponent('sales@nalexpress.com')}`),
    )
    expect(connectLink).not.toHaveAttribute('aria-disabled', 'true')
  })
})

describe('管理员刚批准完回来 —— 不用再找一次收起的入口', () => {
  it('「卡住了」区块自动展开，显示批准成功、还没连上邮箱', async () => {
    mockFetch([])
    await renderPanel({ mail: 'admin_ok' })

    expect(screen.getByText(/管理员已经批准过了/)).toBeInTheDocument()
    // 已经批准过了，不该再看到复制链接这个入口——门已经开了，用不上了。
    expect(screen.queryByRole('button', { name: /复制链接/ })).not.toBeInTheDocument()
  })

  it('顶部不再重复一条「管理员批准了」的横幅 —— 同一件事只说一遍', async () => {
    mockFetch([])
    await renderPanel({ mail: 'admin_ok' })

    // 旧版这句话会在顶部横幅和向导里各出现一次，措辞还不一样。
    expect(screen.queryByText('✓ 管理员批准了')).not.toBeInTheDocument()
  })
})

describe('刚连上一个邮箱', () => {
  it('显示地址，并提示「地址不对现在断开」', async () => {
    mockFetch([])
    await renderPanel({ mail: 'ok', addr: 'sales@nalexpress.com' })

    expect(screen.getByText(/连上了：sales@nalexpress.com/)).toBeInTheDocument()
    expect(screen.getByText(/现在点「断开」/)).toBeInTheDocument()
  })
})

describe('已经连了邮箱 —— 显示列表，不是向导', () => {
  it('不显示「还没连」的向导，改显示已连接的邮箱和「再连一个」', async () => {
    mockFetch([{ id: 'c1', display_name: 'sales@nalexpress.com', status: 'active', last_synced_at: null }])
    await renderPanel()

    expect(screen.getByText(/sales@nalexpress.com/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '断开' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '再连一个邮箱' })).toBeInTheDocument()
    expect(screen.queryByText(/连上要收信的那个邮箱/)).not.toBeInTheDocument()
  })
})
