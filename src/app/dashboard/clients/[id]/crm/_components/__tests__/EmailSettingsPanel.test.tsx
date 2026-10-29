/**
 * 发信设置表单（仅全局管理员）。
 *
 * 钉死的事：
 *  · 读失败 / 没权限显示原因，不显示空表单
 *  · 全新（还没设置）时的表单是「关着、只允许发给试跑名单（空 = 谁都不行）」，第一次保存 baseVersion 为 null
 *  · 功能开着又选「对所有客人放开」必须先勾「我确认」，请求里才带 confirmUnrestricted；其他情况永远不带
 *  · 存的是服务端认的那套键（snake_case），空的目录链接不生成 providers.published_tours
 *  · 数字填错不能保存；400 列出问题；409 让人重新载入
 */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EmailSettingsPanel } from '../EmailSettingsPanel'

const stored = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  send_mailbox: 'info@cts.example',
  allow_unsolicited: false,
  footer: null,
  limits: { per_user_per_hour: 30, per_user_per_day: 100, per_mailbox_per_day: 200 },
  frequency_cap: { max: 2, window_days: 7 },
  recipient_allowlist: ['hello@magicengine.cloud'],
  same_template_cooldown_hours: 24,
  call_prompt_hours: 24,
  guardrails: { allowed_link_hosts: ['www.example.com'], rules: [{ id: 'no-visa-free', phrases: ['visa-free', 'visa free'], message: '不能写免签', severity: 'block' }] },
  providers: { published_tours: { url_pattern: 'https://www.example.com/tours/{destination}/{tier}/{slug}', all_tours_url: 'https://www.example.com/tours' } },
  ...over,
})

const okPayload = (over: Record<string, unknown> = {}) => ({
  state: 'ok',
  version: 4,
  settings: stored(),
  errors: [],
  history: [{ version: 4, createdBy: 'boss@magiclab.example', createdAt: '2026-10-28T01:00:00Z', changeNote: '试跑名单' }],
  ...over,
})
const nonePayload = { state: 'none', version: null, settings: null, errors: [], history: [] }

type Reply = { status?: number; body: unknown }

function routes(get: Reply[], put: Reply[] = []) {
  const gets = [...get]
  const puts = [...put]
  const sent: Array<Record<string, unknown>> = []
  const f = vi.fn(async (_url: string, init?: RequestInit) => {
    const queue = init?.method === 'PUT' ? puts : gets
    if (init?.method === 'PUT') sent.push(JSON.parse(String(init.body)) as Record<string, unknown>)
    const next = queue.length > 1 ? queue.shift()! : queue[0]
    const status = next.status ?? 200
    return { ok: status < 300, status, json: async () => next.body } as Response
  })
  vi.stubGlobal('fetch', f)
  return { f, sent }
}

const settingsOf = (sent: Array<Record<string, unknown>>, i = 0) => sent[i].settings as Record<string, unknown>
const saveButton = () => screen.getByRole('button', { name: '保存发信设置' })
const ready = async () => screen.findByLabelText('发信邮箱')

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('reading the settings', () => {
  it('403: says only global administrators may see them, with no form', async () => {
    routes([{ status: 403, body: { error: 'no' } }])
    render(<EmailSettingsPanel clientId="c1" />)
    expect(await screen.findByText('发信设置只有 Magic Lab 的全局管理员能看和改。')).toBeInTheDocument()
    expect(screen.queryByLabelText('发信邮箱')).toBeNull()
  })

  it('another failure is an error with a retry, not an empty form', async () => {
    const { f } = routes([{ status: 503, body: {} }, { body: okPayload() }])
    render(<EmailSettingsPanel clientId="c1" />)
    expect(await screen.findByText(/暂时读不到发信设置：服务器返回 503/)).toBeInTheDocument()
    expect(screen.queryByLabelText('发信邮箱')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await ready()
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('shows the stored values', async () => {
    routes([{ body: okPayload() }])
    render(<EmailSettingsPanel clientId="c1" />)
    await ready()
    expect((screen.getByLabelText('发信邮箱') as HTMLInputElement).value).toBe('info@cts.example')
    expect((screen.getByLabelText('允许发送的地址列表') as HTMLTextAreaElement).value).toBe('hello@magicengine.cloud')
    expect((screen.getByLabelText('每人每小时') as HTMLInputElement).value).toBe('30')
    expect((screen.getByLabelText('允许出现的链接域名') as HTMLTextAreaElement).value).toBe('www.example.com')
    expect((screen.getByLabelText('第 1 条规则的词语') as HTMLTextAreaElement).value).toBe('visa-free\nvisa free')
    expect((screen.getByLabelText('团页链接格式') as HTMLInputElement).value).toContain('{destination}')
    expect(screen.getByText(/第 4 版 · .* · boss@magiclab.example · 试跑名单/)).toBeInTheDocument()
  })

  it('settings that do not parse are shown in red, and the form starts from safe defaults', async () => {
    routes([{ body: { state: 'invalid', version: 6, settings: null, errors: ['frequency_cap: bad'], history: [] } }])
    render(<EmailSettingsPanel clientId="c1" />)
    expect(await screen.findByText('现有设置有问题，发不出去：')).toBeInTheDocument()
    expect(screen.getByText('frequency_cap: bad')).toBeInTheDocument()
    expect((screen.getByLabelText('每人每小时') as HTMLInputElement).value).toBe('30')
  })
})

describe('the first settings', () => {
  it('start switched off, to a trial list that is empty (nobody), and are saved on top of no version', async () => {
    const { sent } = routes([{ body: nonePayload }, { body: okPayload({ version: 1 }) }], [{ body: { ok: true, version: 1 } }])
    render(<EmailSettingsPanel clientId="c1" />)
    await ready()
    fireEvent.click(saveButton())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].baseVersion).toBeNull()
    expect(sent[0]).not.toHaveProperty('confirmUnrestricted')
    expect(settingsOf(sent)).toEqual({
      enabled: false,
      send_mailbox: null,
      allow_unsolicited: false,
      footer: null,
      limits: { per_user_per_hour: 30, per_user_per_day: 100, per_mailbox_per_day: 200 },
      frequency_cap: { max: 2, window_days: 7 },
      recipient_allowlist: [],
      same_template_cooldown_hours: 24,
      call_prompt_hours: 24,
      guardrails: { allowed_link_hosts: [], rules: [] },
      providers: {},
    })
  })
})

describe('saving changes', () => {
  it('sends the whole settings in the server\'s shape, on top of the version that was loaded', async () => {
    const { sent } = routes([{ body: okPayload() }, { body: okPayload({ version: 5 }) }], [{ body: { ok: true, version: 5 } }])
    render(<EmailSettingsPanel clientId="c1" />)
    await ready()
    fireEvent.change(screen.getByLabelText('允许发送的地址列表'), { target: { value: ' hello@magicengine.cloud \n\n second@example.com ' } })
    fireEvent.change(screen.getByLabelText('变更说明'), { target: { value: ' added a second tester ' } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toMatchObject({ baseVersion: 4, changeNote: 'added a second tester' })
    expect(settingsOf(sent)).toMatchObject({
      enabled: true,
      send_mailbox: 'info@cts.example',
      recipient_allowlist: ['hello@magicengine.cloud', 'second@example.com'],
      guardrails: {
        allowed_link_hosts: ['www.example.com'],
        rules: [{ id: 'no-visa-free', severity: 'block', message: '不能写免签', phrases: ['visa-free', 'visa free'] }],
      },
      providers: { published_tours: { url_pattern: 'https://www.example.com/tours/{destination}/{tier}/{slug}', all_tours_url: 'https://www.example.com/tours' } },
    })
  })

  it('after a save it re-reads and says which version it became', async () => {
    const { f } = routes([{ body: okPayload() }, { body: okPayload({ version: 5 }) }], [{ body: { ok: true, version: 5 } }])
    render(<EmailSettingsPanel clientId="c1" />)
    await ready()
    fireEvent.click(saveButton())
    expect(await screen.findByText('✓ 已保存为第 5 版')).toBeInTheDocument()
    expect(f.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method !== 'PUT')).toHaveLength(2)
  })

  it('turning the frequency limit off saves a null cap; both catalog links empty saves no provider block', async () => {
    const { sent } = routes([{ body: okPayload() }, { body: okPayload() }], [{ body: { ok: true, version: 5 } }])
    render(<EmailSettingsPanel clientId="c1" />)
    await ready()
    fireEvent.click(screen.getByLabelText('限制频次'))
    fireEvent.change(screen.getByLabelText('团页链接格式'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('全部团页面'), { target: { value: '' } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(settingsOf(sent)).toMatchObject({ frequency_cap: null, providers: {} })
  })

  it('adds and removes red-line rules', async () => {
    const { sent } = routes([{ body: okPayload() }, { body: okPayload() }], [{ body: { ok: true, version: 5 } }])
    render(<EmailSettingsPanel clientId="c1" />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: '加一条规则' }))
    fireEvent.change(screen.getByLabelText('第 2 条规则的 ID'), { target: { value: 'no-call' } })
    fireEvent.change(screen.getByLabelText('第 2 条规则的严重度'), { target: { value: 'warn' } })
    fireEvent.change(screen.getByLabelText('第 2 条规则的说明'), { target: { value: '别约电话' } })
    fireEvent.change(screen.getByLabelText('第 2 条规则的词语'), { target: { value: 'give me a call\ncall me' } })
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0])
    fireEvent.click(saveButton())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect((settingsOf(sent).guardrails as { rules: unknown[] }).rules).toEqual([
      { id: 'no-call', severity: 'warn', message: '别约电话', phrases: ['give me a call', 'call me'] },
    ])
  })
})

describe('opening the feature to everybody', () => {
  it('needs the explicit confirmation, and only then sends confirmUnrestricted', async () => {
    const { sent } = routes([{ body: okPayload() }, { body: okPayload() }], [{ body: { ok: true, version: 5 } }])
    render(<EmailSettingsPanel clientId="c1" />)
    await ready()
    fireEvent.click(screen.getByRole('radio', { name: '对所有客人放开' }))
    expect(screen.getByText('选这个等于对所有客人放开。')).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
    fireEvent.click(screen.getByLabelText('我确认：对所有客人放开'))
    expect(saveButton()).not.toBeDisabled()
    fireEvent.click(saveButton())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].confirmUnrestricted).toBe(true)
    expect(settingsOf(sent).recipient_allowlist).toBeNull()
  })

  it('a switched-off feature needs no confirmation and never sends the flag', async () => {
    const { sent } = routes([{ body: okPayload({ settings: stored({ enabled: false }) }) }, { body: okPayload() }], [{ body: { ok: true, version: 5 } }])
    render(<EmailSettingsPanel clientId="c1" />)
    await ready()
    fireEvent.click(screen.getByRole('radio', { name: '对所有客人放开' }))
    expect(screen.queryByLabelText('我确认：对所有客人放开')).toBeNull()
    fireEvent.click(saveButton())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).not.toHaveProperty('confirmUnrestricted')
  })

  it('going back to the trial list drops the confirmation again', async () => {
    const { sent } = routes([{ body: okPayload() }, { body: okPayload() }], [{ body: { ok: true, version: 5 } }])
    render(<EmailSettingsPanel clientId="c1" />)
    await ready()
    fireEvent.click(screen.getByRole('radio', { name: '对所有客人放开' }))
    fireEvent.click(screen.getByLabelText('我确认：对所有客人放开'))
    fireEvent.click(screen.getByRole('radio', { name: '只允许发给下面这些地址' }))
    fireEvent.click(saveButton())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).not.toHaveProperty('confirmUnrestricted')
    expect(settingsOf(sent).recipient_allowlist).toEqual(['hello@magicengine.cloud'])
  })
})

describe('when the save does not go through', () => {
  it.each([
    ['发送上限 is not a number', '每人每小时', 'abc', /发送上限要填大于 0 的整数/],
    ['发送上限 is zero', '每人每天', '0', /发送上限要填大于 0 的整数/],
    ['频次 is zero', '最多 N 封', '0', /频次上限要填大于 0 的整数/],
    ['冷却 is negative', '同一模板冷却小时数', '-1', /防重复的小时数要填整数/],
  ])('%s: the button is locked and the reason shown', async (_name, label, value, hint) => {
    routes([{ body: okPayload() }])
    render(<EmailSettingsPanel clientId="c1" />)
    await ready()
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
    expect(saveButton()).toBeDisabled()
    expect(screen.getByText(hint)).toBeInTheDocument()
  })

  it('a zero cooldown is allowed', async () => {
    routes([{ body: okPayload() }])
    render(<EmailSettingsPanel clientId="c1" />)
    await ready()
    fireEvent.change(screen.getByLabelText('同一模板冷却小时数'), { target: { value: '0' } })
    expect(saveButton()).not.toBeDisabled()
  })

  it('400 lists the problems and keeps the form', async () => {
    routes([{ body: okPayload() }], [{ status: 400, body: { error: 'x', errors: ['guardrails.rules[0].id: bad', 'footer: too long'] } }])
    render(<EmailSettingsPanel clientId="c1" />)
    await ready()
    fireEvent.click(saveButton())
    expect(await screen.findByText('guardrails.rules[0].id: bad')).toBeInTheDocument()
    expect(screen.getByText('footer: too long')).toBeInTheDocument()
    expect((screen.getByLabelText('发信邮箱') as HTMLInputElement).value).toBe('info@cts.example')
  })

  it('409 says someone else saved first and reloads on request', async () => {
    const { f } = routes([{ body: okPayload() }], [{ status: 409, body: { error: 'stale' } }])
    render(<EmailSettingsPanel clientId="c1" />)
    await ready()
    fireEvent.click(saveButton())
    expect(await screen.findByText('设置刚被别人改过，请重新载入后再改。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新载入' }))
    await waitFor(() => expect(f.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method !== 'PUT')).toHaveLength(2))
  })

  it('a network failure says the outcome is not certain', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => okPayload() })
      .mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', f)
    render(<EmailSettingsPanel clientId="c1" />)
    await ready()
    fireEvent.click(saveButton())
    expect(await screen.findByText('网络出错，保存状态不明。请重新载入后再确认。')).toBeInTheDocument()
  })
})
