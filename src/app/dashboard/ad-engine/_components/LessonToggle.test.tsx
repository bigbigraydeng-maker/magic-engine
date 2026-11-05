import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import LessonToggle from './LessonToggle'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

beforeEach(() => {
  refresh.mockReset()
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ success: true }),
  })))
})

describe('LessonToggle', () => {
  it('恢复 opens the lesson for every client', async () => {
    render(<LessonToggle lessonKey="expert-sample-1" isActive={false} clients={[{ id: CLIENT_A, name: 'Sample Tours' }]} />)
    fireEvent.click(screen.getByRole('button', { name: '恢复' }))
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body as string)
    expect(body).toEqual({ lessonKey: 'expert-sample-1', mode: 'all' })
  })

  it('只给某个客户开 sends that one client and not the all-clients switch', async () => {
    render(<LessonToggle lessonKey="expert-sample-1" isActive={false} clients={[{ id: CLIENT_A, name: 'Sample Tours' }]} />)
    fireEvent.click(screen.getByRole('button', { name: '只给某个客户开' }))
    expect(screen.getByRole('button', { name: '只给这个客户开' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('客户'), { target: { value: CLIENT_A } })
    fireEvent.click(screen.getByRole('button', { name: '只给这个客户开' }))
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body as string)
    expect(body).toEqual({ lessonKey: 'expert-sample-1', mode: 'one', clientId: CLIENT_A })
  })

  it('hides the one-client control once the lesson is on', () => {
    render(<LessonToggle lessonKey="expert-sample-1" isActive clients={[{ id: CLIENT_A, name: 'Sample Tours' }]} />)
    expect(screen.getByRole('button', { name: '停用' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '只给某个客户开' })).toBeNull()
  })
})
