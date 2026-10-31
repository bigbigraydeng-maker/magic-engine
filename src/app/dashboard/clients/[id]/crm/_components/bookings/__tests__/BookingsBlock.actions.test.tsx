import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { BookingsBlock } from '../BookingsBlock'
import { nzToday } from '../booking-format'
import {
  BALANCE_UPDATED_AT,
  BOOKING_ID,
  BOOKING_UPDATED_AT,
  CLIENT,
  CONTACT,
  DEP_ID,
  DEPOSIT_UPDATED_AT,
  TOUR_ID,
  installFetch,
  jsonResponse,
  makeBooking,
  makeMilestone,
  makeWarning,
  route,
  type FetchCall,
  type FetchRoute,
} from './booking-test-data'

const SECOND_DEP_ID = '20000000-0000-4000-8000-0000000000a2'

const TOURS = [
  {
    id: TOUR_ID,
    name: '新西兰南北岛',
    durationText: '15 Days',
    departures: [
      { id: DEP_ID, departOn: '2027-03-12', returnOn: '2027-03-26', status: 'open' },
    ],
  },
]

const TOURS_TWO_DEPARTURES = [
  {
    id: TOUR_ID,
    name: '新西兰南北岛',
    durationText: '15 Days',
    departures: [
      { id: DEP_ID, departOn: '2027-03-12', returnOn: '2027-03-26', status: 'open' },
      { id: SECOND_DEP_ID, departOn: '2027-04-02', returnOn: '2027-04-16', status: 'open' },
    ],
  },
]

/** Renders the block with a mutable bookings list and returns the fetch calls. */
async function setup(
  bookings: ReturnType<typeof makeBooking>[],
  extraRoutes: FetchRoute[] = [],
): Promise<{ calls: FetchCall[] }> {
  let current = bookings
  const { calls } = installFetch([
    ...extraRoutes,
    route('GET', '/crm/bookings?contactId=', () => jsonResponse({ bookings: current })),
    // Default for every write: the server accepted it (tests override this with their own routes first).
    {
      match: (_url, method) => method !== 'GET',
      respond: () => jsonResponse({ ok: true, needsRefresh: true }),
    },
  ])
  render(<BookingsBlock clientId={CLIENT} contactId={CONTACT} />)
  await screen.findByTestId('booking-card')
  return { calls }
}

/** Non-GET calls whose url ends with the given suffix. */
function postsTo(calls: FetchCall[], suffix: string): FetchCall[] {
  return calls.filter((c) => c.method !== 'GET' && c.url.endsWith(suffix))
}

function getCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((c) => c.method === 'GET')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BookingsBlock payment actions', () => {
  it('marks the deposit paid with the deposit version and refetches', async () => {
    const { calls } = await setup([makeBooking()])

    fireEvent.click(screen.getByRole('button', { name: '定金已收到款' }))

    const panel = await screen.findByRole('group', { name: '确认定金已收到款' })
    const dateInput = within(panel).getByLabelText('收款日期') as HTMLInputElement
    expect(dateInput.value).toBe(nzToday())
    expect(postsTo(calls, '/milestones/deposit/paid')).toHaveLength(0)

    fireEvent.change(dateInput, { target: { value: '2026-10-08' } })
    fireEvent.click(within(panel).getByRole('button', { name: '确认已收到款' }))

    await waitFor(() => {
      expect(postsTo(calls, '/milestones/deposit/paid')).toHaveLength(1)
    })
    const post = postsTo(calls, '/milestones/deposit/paid')[0]
    expect(post.body).toEqual({
      expectedUpdatedAt: DEPOSIT_UPDATED_AT,
      paidOn: '2026-10-08',
    })

    await waitFor(() => {
      expect(getCalls(calls).length).toBeGreaterThanOrEqual(2)
    })
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: '确认定金已收到款' })).toBeNull()
    })
  })

  it('marks the balance paid with the balance version', async () => {
    const { calls } = await setup([makeBooking()])

    fireEvent.click(screen.getByRole('button', { name: '尾款已收到款' }))
    const panel = await screen.findByRole('group', { name: '确认尾款已收到款' })
    fireEvent.click(within(panel).getByRole('button', { name: '确认已收到款' }))

    await waitFor(() => {
      expect(postsTo(calls, '/milestones/balance/paid')).toHaveLength(1)
    })
    expect(postsTo(calls, '/milestones/balance/paid')[0].body).toEqual({
      expectedUpdatedAt: BALANCE_UPDATED_AT,
      paidOn: nzToday(),
    })
  })

  it('closes the paid panel without sending anything', async () => {
    const { calls } = await setup([makeBooking()])

    fireEvent.click(screen.getByRole('button', { name: '定金已收到款' }))
    const panel = await screen.findByRole('group', { name: '确认定金已收到款' })
    fireEvent.click(within(panel).getByRole('button', { name: '先不勾' }))

    await waitFor(() => {
      expect(screen.queryByRole('group', { name: '确认定金已收到款' })).toBeNull()
    })
    expect(postsTo(calls, '/milestones/deposit/paid')).toHaveLength(0)
  })

  it('undoes a paid deposit', async () => {
    const booking = makeBooking({
      milestones: [makeMilestone('deposit', { state: 'paid' }), makeMilestone('balance')],
    })
    const { calls } = await setup([booking])

    fireEvent.click(screen.getByRole('button', { name: '撤销定金收款' }))

    await waitFor(() => {
      expect(postsTo(calls, '/milestones/deposit/unpaid')).toHaveLength(1)
    })
    expect(postsTo(calls, '/milestones/deposit/unpaid')[0].body).toEqual({
      expectedUpdatedAt: DEPOSIT_UPDATED_AT,
    })
  })

  it('shows a friendly message and refetches on a stale conflict', async () => {
    const { calls } = await setup([makeBooking()], [
      route('POST', '/milestones/deposit/paid', () => jsonResponse({ error: 'stale' }, 409)),
    ])

    fireEvent.click(screen.getByRole('button', { name: '定金已收到款' }))
    const panel = await screen.findByRole('group', { name: '确认定金已收到款' })
    fireEvent.click(within(panel).getByRole('button', { name: '确认已收到款' }))

    expect(await screen.findByText('别人刚改过，已为你刷新')).toBeTruthy()
    expect(screen.queryByText('stale')).toBeNull()
    await waitFor(() => {
      expect(getCalls(calls).length).toBeGreaterThanOrEqual(2)
    })
  })

  it('shows a friendly message for a bad paid date', async () => {
    await setup([makeBooking()], [
      route('POST', '/milestones/deposit/paid', () =>
        jsonResponse({ error: 'invalid_paid_on' }, 400),
      ),
    ])

    fireEvent.click(screen.getByRole('button', { name: '定金已收到款' }))
    const panel = await screen.findByRole('group', { name: '确认定金已收到款' })
    fireEvent.click(within(panel).getByRole('button', { name: '确认已收到款' }))

    expect(await screen.findByText('收款日期不对，请重新选')).toBeTruthy()
    expect(screen.queryByText('invalid_paid_on')).toBeNull()
  })

  it('shows a generic message for an unknown 400 code', async () => {
    await setup([makeBooking()], [
      route('POST', '/milestones/deposit/paid', () =>
        jsonResponse({ error: 'something_else' }, 400),
      ),
    ])

    fireEvent.click(screen.getByRole('button', { name: '定金已收到款' }))
    const panel = await screen.findByRole('group', { name: '确认定金已收到款' })
    fireEvent.click(within(panel).getByRole('button', { name: '确认已收到款' }))

    expect(await screen.findByText('填写的内容有问题，请检查后再试')).toBeTruthy()
  })

  it('disables other actions while a payment request is in flight', async () => {
    let release: () => void = () => {}
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    await setup([makeBooking()], [
      route('POST', '/milestones/deposit/paid', async () => {
        await pending
        return jsonResponse({ booking: makeBooking() })
      }),
    ])

    fireEvent.click(screen.getByRole('button', { name: '定金已收到款' }))
    const panel = await screen.findByRole('group', { name: '确认定金已收到款' })
    fireEvent.click(within(panel).getByRole('button', { name: '确认已收到款' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '取消订单' })).toBeDisabled()
    })
    expect(screen.getByRole('button', { name: '＋ 加订单' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '改备注' })).toBeDisabled()

    release()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '取消订单' })).toBeEnabled()
    })
    expect(screen.getByRole('button', { name: '＋ 加订单' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '改备注' })).toBeEnabled()
  })

  it('confirms a changed departure date', async () => {
    const booking = makeBooking({
      warnings: [
        makeWarning('departure_changed', '出发日期变了，请确认', { needsConfirm: true }),
      ],
    })
    const { calls } = await setup([booking])

    fireEvent.click(screen.getByRole('button', { name: '确认新的出发日期' }))

    await waitFor(() => {
      expect(postsTo(calls, '/confirm-departure')).toHaveLength(1)
    })
    expect(postsTo(calls, '/confirm-departure')[0].body).toEqual({
      expectedUpdatedAt: BOOKING_UPDATED_AT,
    })
  })

  it('overrides the balance due date', async () => {
    const { calls } = await setup([makeBooking()])

    fireEvent.click(screen.getByRole('button', { name: '改到期日（尾款）' }))
    const panel = await screen.findByRole('group', { name: '修改尾款到期日' })
    const input = within(panel).getByLabelText('新的到期日')
    fireEvent.change(input, { target: { value: '2026-12-20' } })
    fireEvent.click(within(panel).getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(postsTo(calls, '/milestones/balance/override-due')).toHaveLength(1)
    })
    expect(postsTo(calls, '/milestones/balance/override-due')[0].body).toEqual({
      expectedUpdatedAt: BALANCE_UPDATED_AT,
      dueOn: '2026-12-20',
    })
  })

  it('restores the system due date', async () => {
    const booking = makeBooking({
      milestones: [
        makeMilestone('deposit'),
        makeMilestone('balance', { dueOverrideOn: '2026-12-20' }),
      ],
    })
    const { calls } = await setup([booking])

    fireEvent.click(screen.getByRole('button', { name: '改到期日（尾款）' }))
    const panel = await screen.findByRole('group', { name: '修改尾款到期日' })
    fireEvent.click(within(panel).getByRole('button', { name: '恢复系统算的日期' }))

    await waitFor(() => {
      expect(postsTo(calls, '/milestones/balance/override-due')).toHaveLength(1)
    })
    expect(postsTo(calls, '/milestones/balance/override-due')[0].body).toEqual({
      expectedUpdatedAt: BALANCE_UPDATED_AT,
      dueOn: null,
    })
  })
})

describe('BookingsBlock cancel', () => {
  it('requires a reason and sends only the note', async () => {
    const { calls } = await setup([makeBooking()])

    fireEvent.click(screen.getByRole('button', { name: '取消订单' }))
    const panel = await screen.findByRole('group', { name: '取消订单' })
    const confirm = within(panel).getByRole('button', { name: '确认取消订单' })
    expect(confirm).toBeDisabled()
    expect(postsTo(calls, '/cancel')).toHaveLength(0)

    const reason = within(panel).getByLabelText('取消原因（写一句话就行，不要写金额）')
    fireEvent.keyDown(reason, { key: 'Enter' })
    expect(await screen.findByText('请先写一句取消原因')).toBeTruthy()
    expect(postsTo(calls, '/cancel')).toHaveLength(0)

    fireEvent.change(reason, { target: { value: '客人改期，定金已线下处理' } })
    fireEvent.click(confirm)

    await waitFor(() => {
      expect(postsTo(calls, '/cancel')).toHaveLength(1)
    })
    const body = postsTo(calls, '/cancel')[0].body
    expect(body).toEqual({
      expectedUpdatedAt: BOOKING_UPDATED_AT,
      cancelNote: '客人改期，定金已线下处理',
    })
    expect(Object.keys(body ?? {})).toEqual(['expectedUpdatedAt', 'cancelNote'])
  })
})

describe('BookingsBlock add booking', () => {
  function addRoutes(createRespond: FetchRoute['respond']): FetchRoute[] {
    return [
      route('GET', '/bookings/options', () => jsonResponse({ tours: TOURS })),
      route('POST', '/crm/bookings', createRespond),
    ]
  }

  it('validates, reveals more fields and creates a booking', async () => {
    const { calls } = await setup([makeBooking()], addRoutes(() => jsonResponse({ booking: makeBooking() }, 201)))

    fireEvent.click(screen.getByRole('button', { name: '＋ 加订单' }))
    const form = await screen.findByRole('button', { name: '加订单' })

    fireEvent.click(form)
    expect(await screen.findByText('请先选一个团')).toBeTruthy()
    expect(postsTo(calls, '/crm/bookings')).toHaveLength(0)

    expect(screen.queryByLabelText('人数')).toBeNull()
    expect(screen.queryByLabelText('这是邮轮团')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    expect(await screen.findByLabelText('人数')).toBeTruthy()
    expect(screen.getByLabelText('这是邮轮团')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('团'), { target: { value: TOUR_ID } })
    const departure = screen.getByLabelText('出发日期')
    expect(within(departure).getByRole('option', { name: /2027-03-12/ })).toBeTruthy()
    fireEvent.change(departure, { target: { value: DEP_ID } })

    fireEvent.click(screen.getByRole('button', { name: '加订单' }))

    await waitFor(() => {
      expect(postsTo(calls, '/crm/bookings')).toHaveLength(1)
    })
    expect(postsTo(calls, '/crm/bookings')[0].body).toEqual({
      contactId: CONTACT,
      tourId: TOUR_ID,
      departureId: DEP_ID,
      bookedOn: nzToday(),
      isCruise: false,
    })
  })

  it('sends party size and cruise flag when set', async () => {
    const { calls } = await setup([makeBooking()], addRoutes(() => jsonResponse({ booking: makeBooking() }, 201)))

    fireEvent.click(screen.getByRole('button', { name: '＋ 加订单' }))
    await screen.findByRole('button', { name: '加订单' })
    fireEvent.change(screen.getByLabelText('团'), { target: { value: TOUR_ID } })
    fireEvent.change(screen.getByLabelText('出发日期'), { target: { value: DEP_ID } })
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.change(await screen.findByLabelText('人数'), { target: { value: '4' } })
    fireEvent.click(screen.getByLabelText('这是邮轮团'))
    fireEvent.click(screen.getByRole('button', { name: '加订单' }))

    await waitFor(() => {
      expect(postsTo(calls, '/crm/bookings')).toHaveLength(1)
    })
    expect(postsTo(calls, '/crm/bookings')[0].body).toEqual({
      contactId: CONTACT,
      tourId: TOUR_ID,
      departureId: DEP_ID,
      bookedOn: nzToday(),
      partySize: 4,
      isCruise: true,
    })
  })

  it('sends a null departure when none is chosen', async () => {
    const { calls } = await setup([makeBooking()], addRoutes(() => jsonResponse({ booking: makeBooking() }, 201)))

    fireEvent.click(screen.getByRole('button', { name: '＋ 加订单' }))
    await screen.findByRole('button', { name: '加订单' })
    fireEvent.change(screen.getByLabelText('团'), { target: { value: TOUR_ID } })
    fireEvent.click(screen.getByRole('button', { name: '加订单' }))

    await waitFor(() => {
      expect(postsTo(calls, '/crm/bookings')).toHaveLength(1)
    })
    expect(postsTo(calls, '/crm/bookings')[0].body).toEqual({
      contactId: CONTACT,
      tourId: TOUR_ID,
      departureId: null,
      bookedOn: nzToday(),
      isCruise: false,
    })
  })

  it('shows the server message for a duplicate booking', async () => {
    await setup([makeBooking()], addRoutes(() =>
      jsonResponse(
        {
          error: 'duplicate_booking',
          message: '这位客人已经有一张同一个团、同一个出发日期的订单',
        },
        409,
      ),
    ))

    fireEvent.click(screen.getByRole('button', { name: '＋ 加订单' }))
    await screen.findByRole('button', { name: '加订单' })
    fireEvent.change(screen.getByLabelText('团'), { target: { value: TOUR_ID } })
    fireEvent.change(screen.getByLabelText('出发日期'), { target: { value: DEP_ID } })
    fireEvent.click(screen.getByRole('button', { name: '加订单' }))

    expect(
      await screen.findByText('这位客人已经有一张同一个团、同一个出发日期的订单'),
    ).toBeTruthy()
    expect(screen.queryByText('duplicate_booking')).toBeNull()
  })
})

describe('BookingsBlock edit booking', () => {
  it('patches the tour and departure', async () => {
    const { calls } = await setup([makeBooking()], [
      route('GET', '/bookings/options', () => jsonResponse({ tours: TOURS_TWO_DEPARTURES })),
    ])

    fireEvent.click(screen.getByRole('button', { name: '改团/出发日期' }))
    const panel = await screen.findByRole('group', { name: '改团或出发日期' })
    expect(within(panel).getByText('已经收到的款会保留，不会清掉。')).toBeTruthy()

    const save = within(panel).getByRole('button', { name: '保存' })
    expect(save).toBeDisabled()

    fireEvent.change(within(panel).getByLabelText('出发日期'), {
      target: { value: SECOND_DEP_ID },
    })
    expect(save).toBeEnabled()
    fireEvent.click(save)

    await waitFor(() => {
      expect(postsTo(calls, `/bookings/${BOOKING_ID}`)).toHaveLength(1)
    })
    expect(postsTo(calls, `/bookings/${BOOKING_ID}`)[0].body).toEqual({
      expectedUpdatedAt: BOOKING_UPDATED_AT,
      patch: { tourId: TOUR_ID, departureId: SECOND_DEP_ID },
    })
  })

  it('patches the note and clears it', async () => {
    const { calls } = await setup([makeBooking()])

    fireEvent.click(screen.getByRole('button', { name: '改备注' }))
    const input = screen.getByLabelText('备注（可写同行人姓名；不要写金额、证件号）')
    fireEvent.change(input, { target: { value: '同行：Li 夫妇' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(postsTo(calls, `/bookings/${BOOKING_ID}`)).toHaveLength(1)
    })
    expect(postsTo(calls, `/bookings/${BOOKING_ID}`)[0].body).toEqual({
      expectedUpdatedAt: BOOKING_UPDATED_AT,
      patch: { note: '同行：Li 夫妇' },
    })

    fireEvent.click(screen.getByRole('button', { name: '改备注' }))
    const input2 = screen.getByLabelText('备注（可写同行人姓名；不要写金额、证件号）')
    fireEvent.change(input2, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(postsTo(calls, `/bookings/${BOOKING_ID}`)).toHaveLength(2)
    })
    expect(postsTo(calls, `/bookings/${BOOKING_ID}`)[1].body).toEqual({
      expectedUpdatedAt: BOOKING_UPDATED_AT,
      patch: { note: null },
    })
  })

  it('shows a plain error and retry when options fail to load', async () => {
    await setup([makeBooking()], [
      route('GET', '/bookings/options', () => jsonResponse({ error: 'boom' }, 500)),
    ])

    fireEvent.click(screen.getByRole('button', { name: '改团/出发日期' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toMatch(/boom/)
    expect(within(alert.parentElement as HTMLElement).getByRole('button', { name: '重试' })).toBeTruthy()
  })
})

describe('成交没记上时告诉员工原因', () => {
  const paidDeposit = makeBooking({
    milestones: [
      makeMilestone('deposit', { state: 'paid', paidOn: '2026-10-08' }),
      makeMilestone('balance'),
    ],
  })

  it('没配哪一笔记成成交时，不在订单上多一句', async () => {
    const { calls } = await setup([paidDeposit])
    await waitFor(() => expect(calls.some((c) => c.url.includes('leads-config'))).toBe(true))
    expect(screen.queryByText(/订单没有人数/)).toBeNull()
    expect(screen.queryByRole('button', { name: '保存人数并补记成交' })).toBeNull()
  })

  it('记下成交的那一笔，人数空着时先停住，填上才先保存人数再记收款', async () => {
    const { calls } = await setup([makeBooking()], [
      route('GET', '/leads-config', () => jsonResponse({ config: { capiDealMilestone: 'deposit' } })),
      route('GET', '/party-hint', () => jsonResponse({ size: 4, source: 'ai_summary' })),
    ])
    fireEvent.click(screen.getByRole('button', { name: '定金已收到款' }))
    const panel = await screen.findByRole('group', { name: '确认定金已收到款' })
    const input = await within(panel).findByLabelText('确认收款的人数') as HTMLInputElement
    await waitFor(() => expect(input.value).toBe('4'))
    expect(within(panel).getByText('人数来自对话摘要，可以改')).toBeTruthy()
    fireEvent.change(input, { target: { value: '' } })
    expect(within(panel).getByRole('button', { name: '确认已收到款' })).toBeDisabled()
    fireEvent.change(input, { target: { value: '2' } })
    fireEvent.click(within(panel).getByRole('button', { name: '确认已收到款' }))
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/deposit/paid'))).toBe(true)
    })
    const patchAt = calls.findIndex((c) => c.method === 'PATCH' && (c.body?.patch as { partySize?: number } | undefined)?.partySize === 2)
    const paidAt = calls.findIndex((c) => c.method === 'POST' && c.url.endsWith('/deposit/paid'))
    expect(patchAt).toBeGreaterThanOrEqual(0)
    expect(patchAt).toBeLessThan(paidAt)
  })

  it('人数提示回来时，不盖掉员工已经填上的数字', async () => {
    let releaseHint: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseHint = resolve
    })
    await setup([makeBooking()], [
      route('GET', '/leads-config', () => jsonResponse({ config: { capiDealMilestone: 'deposit' } })),
      route('GET', '/party-hint', async () => {
        await gate
        return jsonResponse({ size: 2, source: 'ai_summary' })
      }),
    ])
    fireEvent.click(screen.getByRole('button', { name: '定金已收到款' }))
    const panel = await screen.findByRole('group', { name: '确认定金已收到款' })
    const input = await within(panel).findByLabelText('确认收款的人数') as HTMLInputElement
    fireEvent.change(input, { target: { value: '4' } })
    releaseHint()
    await waitFor(() => expect(input.value).toBe('4'))
    expect(within(panel).queryByText('人数来自对话摘要，可以改')).toBeNull()
  })

  it('订单上已有人数时，确认收款不用再填', async () => {
    await setup([makeBooking({ partySize: 4 })], [
      route('GET', '/leads-config', () => jsonResponse({ config: { capiDealMilestone: 'deposit' } })),
    ])
    fireEvent.click(screen.getByRole('button', { name: '定金已收到款' }))
    const panel = await screen.findByRole('group', { name: '确认定金已收到款' })
    expect(within(panel).queryByLabelText('确认收款的人数')).toBeNull()
    expect(within(panel).getByRole('button', { name: '确认已收到款' })).toBeEnabled()
  })

  it('人数没填时写出原因，填上人数后再走原来的记下款接口', async () => {
    const { calls } = await setup([paidDeposit], [
      route('GET', '/leads-config', () => jsonResponse({ config: { capiDealMilestone: 'deposit' } })),
    ])
    expect(await screen.findByText(/订单没有人数/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('补记成交的人数'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '保存人数并补记成交' }))
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PATCH' && (c.body?.patch as { partySize?: number } | undefined)?.partySize === 2)).toBe(true)
    })
    const paid = calls.find((c) => c.method === 'POST' && c.url.endsWith('/deposit/paid'))
    expect(paid?.body).toMatchObject({ paidOn: '2026-10-08', expectedUpdatedAt: DEPOSIT_UPDATED_AT })
  })
})
