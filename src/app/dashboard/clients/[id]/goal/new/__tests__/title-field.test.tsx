import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const EXAMPLE = '春节后促销 60 天集中获客'
const push = vi.hoisted(() => vi.fn())

vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ id: 'client-1' }),
}))

import { NewGoalClient } from '../_client'

void React

function installFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/clients/client-1/goals' && init?.method === 'POST') {
      return { ok: true, json: async () => ({ goal: { id: 'goal-new' } }) }
    }
    return { ok: true, json: async () => ({ client: { country: 'NZ' } }) }
  }))
}

async function chooseEventDriven() {
  const user = userEvent.setup()
  render(<NewGoalClient />)
  await user.click(screen.getByRole('button', { name: /获客 Acquisition/ }))
  await user.click(screen.getByRole('button', { name: /事件驱动/ }))
  return user
}

beforeEach(() => {
  push.mockReset()
  installFetch()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('New goal title', () => {
  it('starts empty, shows the card example only as a placeholder, and blocks Next', async () => {
    await chooseEventDriven()

    const title = screen.getByRole('textbox', { name: /Goal 标题/ })
    expect(title).toHaveValue('')
    expect(title).toHaveAttribute('placeholder', EXAMPLE)
    expect(title).toBeRequired()
    expect(screen.getByRole('button', { name: 'Next →' })).toBeDisabled()
    expect(screen.getByText('请填 Goal 标题')).toBeInTheDocument()
  })

  it('still blocks Next when the title is only spaces', async () => {
    const user = await chooseEventDriven()
    await user.type(screen.getByRole('textbox', { name: /Goal 标题/ }), '   ')
    expect(screen.getByRole('button', { name: 'Next →' })).toBeDisabled()
  })

  it('does not replace a typed title with the next card example', async () => {
    const user = await chooseEventDriven()
    const title = screen.getByRole('textbox', { name: /Goal 标题/ })
    await user.type(title, '亲手起的名字')
    await user.click(screen.getByRole('button', { name: /持续获客/ }))

    expect(title).toHaveValue('亲手起的名字')
    expect(title).toHaveAttribute('placeholder', 'Oztop Brisbane 月询盘 20 → 50')
  })

  it('submits the trimmed typed title and not the placeholder', async () => {
    const user = await chooseEventDriven()
    await user.type(screen.getByRole('textbox', { name: /Goal 标题/ }), '  亲手起的名字  ')
    await user.click(screen.getByRole('button', { name: 'Next →' }))

    await user.click(screen.getByRole('button', { name: /新增线索\/询盘/ }))
    const [baseline, target] = screen.getAllByRole('spinbutton')
    await user.type(baseline, '20')
    await user.type(target, '50')
    await user.click(screen.getByRole('button', { name: 'Next →' }))
    await user.click(screen.getByRole('button', { name: 'Next →' }))

    expect(screen.getByText('亲手起的名字')).toBeInTheDocument()
    expect(screen.queryByText(EXAMPLE)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save Draft' }))

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const post = fetchMock.mock.calls.find((call) => {
      const init = call[1] as RequestInit | undefined
      return String(call[0]).endsWith('/goals') && init?.method === 'POST'
    })
    expect(post).toBeTruthy()
    const body = JSON.parse(String((post?.[1] as RequestInit).body)) as {
      title: string
      baseline_value: number
      target_value: number
      fde_reasoning?: string
      budget_amount?: number
    }
    expect(body.title).toBe('亲手起的名字')
    expect(body.title).not.toBe(EXAMPLE)
    expect(JSON.stringify(body)).not.toContain(EXAMPLE)
    expect(body.baseline_value).toBe(20)
    expect(body.target_value).toBe(50)
    expect(body.fde_reasoning).toBeUndefined()
    expect(body.budget_amount).toBeUndefined()
  })
})
