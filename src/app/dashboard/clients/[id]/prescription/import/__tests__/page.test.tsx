import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ManualPrescriptionImportPage from '../page'

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'client-1' }),
  useSearchParams: () => new URLSearchParams(),
}))

const PASTE = JSON.stringify({
  goal_id: 'goal-1',
  content: {
    summary: '只给人看的摘要',
    kpi_targets: [],
    budget_allocation: [],
    phases: [{
      phase_number: 1,
      name: '准备',
      duration_weeks: 1,
      actions: [{
        id: 'a1',
        phase: 1,
        title: '建成暂停',
        description: '说明',
        dimension: 'ads',
        fix_type: 'fde_manual',
        module: 'manual',
        execution_target: { flywheel: 'ads', mode: 'external_manual', vendor: 'fde' },
        effort: 'low',
        impact: 'high',
        finding_ids: [],
      }],
    }],
  },
})

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('贴入处方草稿', () => {
  it('starts with an empty box and does not save before preview', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<ManualPrescriptionImportPage />)

    const box = screen.getByLabelText('处方 JSON')
    expect(box).toHaveValue('')
    expect(box).not.toHaveAttribute('placeholder')
    expect(screen.queryByRole('button', { name: '保存为草稿' })).not.toBeInTheDocument()

    fireEvent.change(box, { target: { value: '{' } })
    expect(box).toHaveValue('{')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('previews manual actions, then posts a draft', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        view_path: '/dashboard/clients/client-1/prescription/new?goal_id=goal-1',
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<ManualPrescriptionImportPage />)

    await user.click(screen.getByLabelText('处方 JSON'))
    await user.paste(PASTE)
    await user.click(screen.getByRole('button', { name: '预览' }))

    expect(screen.getByText('只给人看的摘要')).toBeInTheDocument()
    expect(screen.getByText('人工执行')).toBeInTheDocument()
    expect(screen.getByText('建成暂停')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '保存为草稿' }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { method: string; body: string }]
    expect(url).toBe('/api/clients/client-1/prescriptions/manual')
    expect(init.method).toBe('POST')
    const sent = JSON.parse(init.body) as { status?: string; goal_id: string; content: { summary: string } }
    expect(sent.goal_id).toBe('goal-1')
    expect(sent.content.summary).toBe('只给人看的摘要')
    expect(sent.status).toBeUndefined()
    expect(await screen.findByText('已存成草稿。')).toBeInTheDocument()
  })

  it('shows the validation error and does not post when an action is not manual', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<ManualPrescriptionImportPage />)
    const bad = JSON.parse(PASTE) as { content: { phases: Array<{ actions: Array<{ fix_type: string }> }> } }
    bad.content.phases[0].actions[0].fix_type = 'me_auto'

    await user.click(screen.getByLabelText('处方 JSON'))
    await user.paste(JSON.stringify(bad))
    await user.click(screen.getByRole('button', { name: '预览' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('不是人工执行')
    expect(screen.queryByRole('button', { name: '保存为草稿' })).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
