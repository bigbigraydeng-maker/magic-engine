import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Ga4PropertyPanel } from '../Ga4PropertyPanel'

const CLIENT_ID = 'client-ga4-property-panel-test'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Ga4PropertyPanel', () => {
  it('notifies the GA4 status card after a Property is verified and saved', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          connected: true,
          connector_status: null,
          current: null,
          options: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, property: 'properties/550203806', status: 'connected' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          connected: true,
          connector_status: 'connected',
          current: 'properties/550203806',
          options: [],
        }),
      }) as unknown as typeof fetch
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    render(<Ga4PropertyPanel clientId={CLIENT_ID} />)

    const input = await screen.findByPlaceholderText(/550203806/)
    fireEvent.change(input, { target: { value: '550203806' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并验证' }))

    await waitFor(() => {
      expect(dispatchSpy.mock.calls.some(([event]) => (
        event.type === 'ga4-property-changed' &&
        (event as CustomEvent<{ clientId: string }>).detail.clientId === CLIENT_ID
      ))).toBe(true)
    })
  })
})
