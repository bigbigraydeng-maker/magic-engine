/**
 * 抽屉里的「选模板 → 预览 → 改 → 发」面板。
 *
 * 钉死的事：
 *  · 选模板就请求预览；发送带上预览返回的模板版本 / 目录版本 / 所选团 / 手填内容 / 通话依据
 *  · 同一个面板里重试发送用同一个 requestId（网络出错、被拦后重发都不会换号）
 *  · 不能发的各种原因都把按钮锁住（被拦、频次到顶、没选团、缺值、收件人不可用）
 *  · 销售改过的字不会被自动重新生成覆盖；点「按模板重新生成」才覆盖
 *  · 模板或目录刚更新（409）→ 重新生成，旧稿留在「旧稿」里
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TemplateEmailPanel } from '../TemplateEmailPanel'

type Json = Record<string, unknown>

const templates = [
  { key: 'post-call', version: 3, name: 'Post-call single tour', pickMode: 'one' as const, factSource: 'published_tours' as const },
  { key: 'thanks', version: 1, name: 'Thank you', pickMode: 'none' as const, factSource: 'none' as const },
]

const option = (over: Json = {}) => ({
  tourId: 't1',
  slug: 'essentials',
  destination: 'china',
  tier: 'discovery',
  name: 'China Discovery',
  durationText: '15 Days',
  priceText: 'From NZD $4,080',
  requiresDeparture: true,
  departures: [
    { departOn: '2027-03-11', displayDate: '11 March 2027', status: 'open', priceText: null },
    { departOn: '2027-05-13', displayDate: '13 May 2027', status: 'limited', priceText: null },
  ],
  ...over,
})

function previewOk(over: Json = {}): Json {
  return {
    ok: true,
    template: { key: 'thanks', version: 1, name: 'Thank you', pickMode: 'none', factSource: 'none' },
    catalogVersion: null,
    options: [],
    pickProblem: null,
    rendered: { subject: 'Hello Amy', body: 'Kia ora Amy', missing: [], problems: [] },
    blocks: [],
    warnings: [],
    callBasis: 'none',
    callEvidenceAt: null,
    frequency: { state: 'ok', count: 1, max: 2, windowDays: 7, nextAllowedAt: null, items: [], error: null },
    send: { canCompose: true, recipient: 'amy@gmail.com', mailbox: 'info@cts.example', sentToContactLast7Days: 1 },
    ...over,
  }
}

const tourPreview = (over: Json = {}) =>
  previewOk({
    template: { key: 'post-call', version: 3, name: 'Post-call single tour', pickMode: 'one', factSource: 'published_tours' },
    catalogVersion: 7,
    options: [option()],
    ...over,
  })

interface Reply {
  status?: number
  body: unknown
}

/** Routes fetch by address: preview and compose each get their own queue of replies. */
function routeFetch(replies: { preview?: Reply[]; compose?: Array<Reply | Error> }) {
  const preview = [...(replies.preview ?? [])]
  const compose = [...(replies.compose ?? [])]
  const calls: Array<{ url: string; body: Json }> = []
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Json) : {}
    calls.push({ url, body })
    const queue = url.endsWith('/template-preview') ? preview : compose
    const next = queue.shift()
    if (next === undefined) throw new Error(`unexpected request to ${url}`)
    if (next instanceof Error) throw next
    const status = next.status ?? 200
    return { ok: status >= 200 && status < 300, status, json: async () => next.body } as Response
  })
  vi.stubGlobal('fetch', f)
  return { f, calls, previews: () => calls.filter((c) => c.url.endsWith('/template-preview')), composes: () => calls.filter((c) => c.url.endsWith('/compose')) }
}

const draw = (over: Partial<React.ComponentProps<typeof TemplateEmailPanel>> = {}) => {
  const onClose = vi.fn()
  const onSent = vi.fn()
  render(<TemplateEmailPanel clientId="c1" contactId="p1" templates={templates} initialCallBasis="none" onClose={onClose} onSent={onSent} {...over} />)
  return { onClose, onSent }
}

const pickTemplate = async (name: string) => {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }))
  await screen.findByLabelText('邮件主题')
}
const sendButton = () => screen.getByRole('button', { name: '发送模板邮件' })
const subject = () => screen.getByLabelText('邮件主题') as HTMLInputElement
const bodyBox = () => screen.getByLabelText('邮件正文') as HTMLTextAreaElement

beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.123456))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('choosing a template', () => {
  it('lists the templates and asks for a preview with the claimed call basis', async () => {
    const r = routeFetch({ preview: [{ body: previewOk() }] })
    draw({ initialCallBasis: 'staff_attested' })
    await pickTemplate('Thank you')
    expect(r.previews()).toHaveLength(1)
    expect(r.previews()[0].url).toBe('/api/clients/c1/crm/contacts/p1/email/template-preview')
    expect(r.previews()[0].body).toEqual({ key: 'thanks', picks: [], inputs: {}, callBasis: 'staff_attested' })
    expect(subject().value).toBe('Hello Amy')
    expect(bodyBox().value).toBe('Kia ora Amy')
  })

  it('shows who it will be sent to and how many he has had this week', async () => {
    routeFetch({ preview: [{ body: previewOk() }] })
    draw()
    await pickTemplate('Thank you')
    expect(screen.getByText('将用 info@cts.example 发给 amy@gmail.com')).toBeInTheDocument()
    expect(screen.getByText(/最近 7 天已给他发了 1 封（上限 2）/)).toBeInTheDocument()
  })

  it('says so when there are no templates, and the close button works', () => {
    const { onClose } = draw({ templates: [] })
    expect(screen.getByText('现在没有启用中的模板。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows the server\'s reason when the preview fails', async () => {
    routeFetch({ preview: [{ status: 409, body: { error: '这个模板现在不能用了', reason: 'template_unavailable' } }] })
    draw()
    fireEvent.click(screen.getByRole('button', { name: /Thank you/ }))
    expect(await screen.findByText('这个模板现在不能用了')).toBeInTheDocument()
  })

  it('says the feature is off instead of a raw error', async () => {
    routeFetch({ preview: [{ status: 409, body: { error: 'raw', reason: 'feature_off' } }] })
    draw()
    fireEvent.click(screen.getByRole('button', { name: /Thank you/ }))
    expect(await screen.findByText('邮件功能还没开通或设置无效。')).toBeInTheDocument()
  })
})

describe('sending', () => {
  it('sends the preview\'s template version, catalog version, picks, inputs and call basis, to the previewed recipient', async () => {
    const r = routeFetch({
      preview: [{ body: tourPreview() }, { body: tourPreview({ callBasis: 'staff_attested' }) }],
      compose: [{ body: { ok: true, messageId: 'm1', conversationId: 'c1', duplicate: false } }],
    })
    const { onSent } = draw({ initialCallBasis: 'staff_attested' })
    await pickTemplate('Post-call single tour')
    fireEvent.click(screen.getByRole('radio'))
    await waitFor(() => expect(r.previews()).toHaveLength(2))
    expect(r.previews()[1].body).toMatchObject({ key: 'post-call', picks: [{ tourId: 't1', departOn: '2027-03-11' }] })
    await waitFor(() => expect(sendButton()).not.toBeDisabled())
    fireEvent.click(sendButton())
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1))
    const sent = r.composes()[0]
    expect(sent.url).toBe('/api/clients/c1/crm/contacts/p1/email/compose')
    expect(sent.body).toEqual({
      subject: 'Hello Amy',
      body: 'Kia ora Amy',
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      expectedRecipient: 'amy@gmail.com',
      template: {
        key: 'post-call',
        version: 3,
        catalogVersion: 7,
        picks: [{ tourId: 't1', departOn: '2027-03-11' }],
        inputs: {},
        callBasis: 'staff_attested',
      },
    })
    expect(await screen.findByText('✓ 邮件已发出')).toBeInTheDocument()
  })

  it('closes itself shortly after a successful send', async () => {
    routeFetch({ preview: [{ body: previewOk() }], compose: [{ body: { ok: true, messageId: 'm1', conversationId: 'c1' } }] })
    const { onClose } = draw()
    await pickTemplate('Thank you')
    fireEvent.click(sendButton())
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), { timeout: 3000 })
  })

  it('a retry after a refusal or a network failure reuses the SAME request id', async () => {
    const r = routeFetch({
      preview: [{ body: previewOk() }],
      compose: [new Error('offline'), { status: 429, body: { error: '发得太多了', reason: 'quota' } }, { body: { ok: true, messageId: 'm1', conversationId: 'c1' } }],
    })
    draw()
    await pickTemplate('Thank you')
    fireEvent.click(sendButton())
    expect(await screen.findByText(/发送状态不明/)).toBeInTheDocument()
    fireEvent.click(sendButton())
    expect(await screen.findByText('发得太多了')).toBeInTheDocument()
    fireEvent.click(sendButton())
    await screen.findByText('✓ 邮件已发出')
    const ids = r.composes().map((c) => c.body.requestId)
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(1)
  })

  it('keeps what the staff member wrote when the send is refused', async () => {
    routeFetch({ preview: [{ body: previewOk() }], compose: [{ status: 409, body: { error: '他最近收到的邮件已达上限', reason: 'frequency_cap' } }] })
    draw()
    await pickTemplate('Thank you')
    fireEvent.change(bodyBox(), { target: { value: 'My own words' } })
    fireEvent.click(sendButton())
    expect(await screen.findByText('他最近收到的邮件已达上限')).toBeInTheDocument()
    expect(bodyBox().value).toBe('My own words')
  })
})

describe('when the send button must stay locked', () => {
  const locked = async (over: Json, edit = false) => {
    routeFetch({ preview: [{ body: previewOk(over) }] })
    draw()
    await pickTemplate('Thank you')
    if (edit) fireEvent.change(bodyBox(), { target: { value: 'Typed by hand' } })
    return sendButton()
  }

  it('the guest cannot be written to from here', async () => {
    const button = await locked({ send: { canCompose: false, reason: 'do_not_contact', message: '他说过别再联系' } })
    expect(button).toBeDisabled()
    expect(screen.getByText('不能发：他说过别再联系')).toBeInTheDocument()
  })

  it('a red line is hit', async () => {
    const button = await locked({ blocks: [{ code: 'content_blocked', detail: '免签说法不能写', ruleId: 'no-visa-free' }] })
    expect(button).toBeDisabled()
    expect(screen.getByText('不能发：免签说法不能写')).toBeInTheDocument()
  })

  it('amber warnings are shown but do not lock', async () => {
    const button = await locked({ warnings: [{ code: 'content_warning', detail: '别约电话', ruleId: 'no-call' }] })
    expect(button).not.toBeDisabled()
    expect(screen.getByText('提醒：别约电话')).toBeInTheDocument()
  })

  it.each([
    ['capped', { state: 'capped', count: 2, max: 2, windowDays: 7, nextAllowedAt: '2026-11-03T01:00:00Z', items: [{ source: 'sent_items', at: '2026-10-27T01:00:00Z', subject: 'Earlier mail' }], error: null }, /已到上限 2/],
    ['unverifiable', { state: 'unverifiable', count: null, max: 2, windowDays: 7, nextAllowedAt: null, items: [], error: 'graph down' }, /暂时数不清/],
  ])('the weekly cap is %s', async (_name, frequency, text) => {
    const button = await locked({ frequency })
    expect(button).toBeDisabled()
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('shows the evidence behind the count so a wrong block can be understood', async () => {
    await locked({
      frequency: { state: 'capped', count: 2, max: 2, windowDays: 7, nextAllowedAt: '2026-11-03T01:00:00Z', items: [{ source: 'sent_items', at: '2026-10-27T01:00:00Z', subject: 'Earlier mail' }], error: null },
    })
    fireEvent.click(screen.getByText('看明细'))
    expect(screen.getByText(/邮箱已发送 · Earlier mail/)).toBeInTheDocument()
  })

  it('placeholders are still missing: locked until the staff member has written the text themselves', async () => {
    const button = await locked({ rendered: { subject: 'Hello', body: 'Kia ora {{first_name}}', missing: ['first_name'], problems: [] } })
    expect(button).toBeDisabled()
    expect(screen.getByText('还缺：first_name')).toBeInTheDocument()
    fireEvent.change(bodyBox(), { target: { value: 'Kia ora Amy, thank you for the call.' } })
    expect(sendButton()).not.toBeDisabled()
  })

  it('while a new preview is being generated, so the screen may be out of date', async () => {
    let release: (value: Response) => void = () => undefined
    const pending = new Promise<Response>((resolve) => {
      release = resolve
    })
    const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response
    const answers: Array<Promise<Response> | Response> = [reply(previewOk()), pending]
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(answers.shift() as Promise<Response> | Response)))
    draw()
    await pickTemplate('Thank you')
    expect(sendButton()).not.toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '检查' }))
    await waitFor(() => expect(sendButton()).toBeDisabled())
    release(reply(previewOk()))
    await waitFor(() => expect(sendButton()).not.toBeDisabled())
  })

  it('a tour must be picked first when the template needs one', async () => {
    routeFetch({ preview: [{ body: tourPreview() }] })
    draw()
    await pickTemplate('Post-call single tour')
    expect(sendButton()).toBeDisabled()
  })

  it('a pick the server rejected is shown and locks sending', async () => {
    const r = routeFetch({ preview: [{ body: tourPreview() }, { body: tourPreview({ pickProblem: '所选班期已不再售卖' }) }] })
    draw()
    await pickTemplate('Post-call single tour')
    fireEvent.click(screen.getByRole('radio'))
    expect(await screen.findByText('所选班期已不再售卖')).toBeInTheDocument()
    expect(sendButton()).toBeDisabled()
    expect(r.previews()).toHaveLength(2)
  })
})

describe('editing', () => {
  it('a later preview does not overwrite what was typed; "regenerate" does', async () => {
    const r = routeFetch({
      preview: [
        { body: previewOk() },
        { body: previewOk({ rendered: { subject: 'Fresh subject', body: 'Fresh body', missing: [], problems: [] } }) },
        { body: previewOk({ rendered: { subject: 'Regenerated subject', body: 'Regenerated body', missing: [], problems: [] } }) },
      ],
    })
    draw()
    await pickTemplate('Thank you')
    fireEvent.change(bodyBox(), { target: { value: 'My words' } })
    fireEvent.click(screen.getByRole('button', { name: '检查' }))
    await waitFor(() => expect(r.previews()).toHaveLength(2))
    expect(r.previews()[1].body).toMatchObject({ subject: 'Hello Amy', body: 'My words' })
    await waitFor(() => expect(screen.getByRole('button', { name: '检查' })).not.toBeDisabled())
    expect(bodyBox().value).toBe('My words')

    fireEvent.click(screen.getByRole('button', { name: /按模板重新生成/ }))
    await waitFor(() => expect(bodyBox().value).toBe('Regenerated body'))
    expect(subject().value).toBe('Regenerated subject')
    expect(r.previews()[2].body).not.toHaveProperty('body')
  })

  it('asks for a typed-in value when the template needs one, and re-renders with it', async () => {
    const r = routeFetch({
      preview: [
        { body: previewOk({ rendered: { subject: 'S', body: 'B {{input.destination}}', missing: ['input.destination'], problems: [] } }) },
        { body: previewOk({ rendered: { subject: 'S', body: 'B China', missing: [], problems: [] } }) },
      ],
    })
    draw()
    await pickTemplate('Thank you')
    const box = screen.getByLabelText('填写 destination')
    fireEvent.change(box, { target: { value: 'China' } })
    fireEvent.blur(box)
    await waitFor(() => expect(r.previews()).toHaveLength(2))
    expect(r.previews()[1].body).toMatchObject({ inputs: { destination: 'China' } })
    await waitFor(() => expect(bodyBox().value).toBe('B China'))
  })

  it('an answer that arrives late for an older request is ignored', async () => {
    let releaseSlow: (value: Response) => void = () => undefined
    const slow = new Promise<Response>((resolve) => {
      releaseSlow = resolve
    })
    const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response
    const answers: Array<Promise<Response> | Response> = [
      reply(tourPreview()),
      slow,
      reply(tourPreview({ rendered: { subject: 'Third', body: 'Third body', missing: [], problems: [] } })),
    ]
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(answers.shift() as Promise<Response> | Response)))
    draw()
    await pickTemplate('Post-call single tour')
    fireEvent.click(screen.getByRole('radio')) // request 2: slow
    const select = await screen.findByLabelText('China Discovery 出发日期')
    fireEvent.change(select, { target: { value: '2027-05-13' } }) // request 3: fast
    await waitFor(() => expect(subject().value).toBe('Third'))
    releaseSlow(reply(tourPreview({ rendered: { subject: 'Second (late)', body: 'Late body', missing: [], problems: [] } })))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(subject().value).toBe('Third')
    expect(bodyBox().value).toBe('Third body')
  })
})

describe('a template or catalog that changed while the panel was open', () => {
  it.each(['template_outdated', 'catalog_outdated'])('%s: regenerates and keeps the old draft', async (reason) => {
    const r = routeFetch({
      preview: [{ body: previewOk() }, { body: previewOk({ rendered: { subject: 'New subject', body: 'New body', missing: [], problems: [] } }) }],
      compose: [{ status: 409, body: { error: '模板刚更新了', reason } }],
    })
    draw()
    await pickTemplate('Thank you')
    fireEvent.change(bodyBox(), { target: { value: 'What I had typed' } })
    fireEvent.click(sendButton())
    await waitFor(() => expect(r.previews()).toHaveLength(2))
    await waitFor(() => expect(bodyBox().value).toBe('New body'))
    expect(screen.getByText(/模板或团目录刚更新了/)).toBeInTheDocument()
    const details = screen.getByText('旧稿').closest('details') as HTMLElement
    expect(within(details).getByText('What I had typed')).toBeInTheDocument()
  })
})

describe('picking tours', () => {
  const two = [option(), option({ tourId: 't2', name: 'Japan Cherry Blossoms', requiresDeparture: false, departures: [] })]
  const manyPreview = (over: Json = {}) =>
    tourPreview({ template: { key: 'spring', version: 2, name: 'Spring', pickMode: 'many', factSource: 'published_tours' }, options: two, ...over })
  const manyTemplates = [{ key: 'spring', version: 2, name: 'Spring', pickMode: 'many' as const, factSource: 'published_tours' as const }]

  it('a departure is chosen with the select and sent with the preview request', async () => {
    const r = routeFetch({ preview: [{ body: tourPreview() }, { body: tourPreview() }, { body: tourPreview() }] })
    draw()
    await pickTemplate('Post-call single tour')
    fireEvent.click(screen.getByRole('radio'))
    const select = await screen.findByLabelText('China Discovery 出发日期')
    expect(within(select).getByText('13 May 2027（余位不多）')).toBeInTheDocument()
    fireEvent.change(select, { target: { value: '2027-05-13' } })
    await waitFor(() => expect(r.previews()).toHaveLength(3))
    expect(r.previews()[2].body).toMatchObject({ picks: [{ tourId: 't1', departOn: '2027-05-13' }] })
  })

  it('in "many" mode a tour can be unticked even after its departure was changed, without leaving a stray pick', async () => {
    const r = routeFetch({ preview: [{ body: manyPreview() }, { body: manyPreview() }, { body: manyPreview() }, { body: manyPreview() }] })
    draw({ templates: manyTemplates })
    await pickTemplate('Spring')
    const boxes = screen.getAllByRole('checkbox')
    fireEvent.click(boxes[0])
    const select = await screen.findByLabelText('China Discovery 出发日期')
    fireEvent.change(select, { target: { value: '2027-05-13' } })
    await waitFor(() => expect(r.previews()).toHaveLength(3))
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    await waitFor(() => expect(r.previews()).toHaveLength(4))
    expect(r.previews()[3].body).toMatchObject({ picks: [] })
  })

  it('in "many" mode no more than three tours can be ticked', async () => {
    const four = [1, 2, 3, 4].map((n) => option({ tourId: `t${n}`, name: `Tour ${n}`, requiresDeparture: false, departures: [] }))
    const r = routeFetch({ preview: Array.from({ length: 6 }, () => ({ body: manyPreview({ options: four }) })) })
    draw({ templates: manyTemplates })
    await pickTemplate('Spring')
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box)
    await waitFor(() => expect(r.previews().length).toBeGreaterThanOrEqual(4))
    const last = r.previews()[r.previews().length - 1].body.picks as unknown[]
    expect(last).toHaveLength(3)
  })

  it('says so when nothing is on sale', async () => {
    routeFetch({ preview: [{ body: tourPreview({ options: [] }) }] })
    draw()
    await pickTemplate('Post-call single tour')
    expect(screen.getByText('现在没有可选的团（目录里没有在售的）。')).toBeInTheDocument()
  })
})

describe('call line', () => {
  it.each([
    ['system_call', '📞 系统记录了刚才的通话'],
    ['staff_attested', '📞 按你点的「刚和他通过电话」写'],
  ])('%s', async (basis, text) => {
    routeFetch({ preview: [{ body: previewOk({ callBasis: basis }) }] })
    draw()
    await pickTemplate('Thank you')
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('shows nothing about a call when there was none', async () => {
    routeFetch({ preview: [{ body: previewOk() }] })
    draw()
    await pickTemplate('Thank you')
    expect(screen.queryByText(/📞/)).toBeNull()
  })
})
