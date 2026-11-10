import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataSnapshotPanel } from '../DataSnapshotPanel'

const CLIENT_ID = 'client-ga4-snapshot-test'
let connectorStatus: 'connected' | 'error'
let tokenAvailable: boolean
let currentProperty: string | null

beforeEach(() => {
  connectorStatus = 'error'
  tokenAvailable = true
  currentProperty = 'properties/550203806'
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/ga4/snapshots')) {
      return { ok: true, json: async () => ({ latest: null }) } as Response
    }
    if (url.endsWith('/ga4-properties')) {
      return {
        ok: true,
        json: async () => ({
          connected: tokenAvailable,
          connector_status: connectorStatus,
          current: currentProperty,
        }),
      } as Response
    }
    throw new Error(`unexpected fetch: ${url}`)
  }) as typeof fetch
})

afterEach(() => vi.restoreAllMocks())

describe('DataSnapshotPanel GA4 readiness', () => {
  it('refreshes readiness after a Property is saved successfully on the same page', async () => {
    render(<DataSnapshotPanel anchor="ga4" clientId={CLIENT_ID} />)

    const button = await screen.findByRole('button', { name: '立即同步' })
    expect(button).toBeDisabled()

    connectorStatus = 'connected'
    act(() => {
      window.dispatchEvent(new CustomEvent('ga4-property-changed', { detail: { clientId: CLIENT_ID } }))
    })

    await waitFor(() => expect(button).toBeEnabled())
    expect(screen.getByText('点击「立即同步」拉取最近 28 天数据')).toBeInTheDocument()
  })

  it('stays disabled after a failed Property verification event', async () => {
    render(<DataSnapshotPanel anchor="ga4" clientId={CLIENT_ID} />)
    const button = await screen.findByRole('button', { name: '立即同步' })

    act(() => {
      window.dispatchEvent(new CustomEvent('ga4-property-changed', { detail: { clientId: CLIENT_ID } }))
    })

    await waitFor(() => expect(button).toBeDisabled())
  })

  it('stays disabled for a stale connected connector without a usable token', async () => {
    connectorStatus = 'connected'
    tokenAvailable = false

    render(<DataSnapshotPanel anchor="ga4" clientId={CLIENT_ID} />)

    expect(await screen.findByRole('button', { name: '立即同步' })).toBeDisabled()
  })

  it.each([null, 'properties/not-a-number'])('stays disabled without a valid Property: %s', async (current) => {
    connectorStatus = 'connected'
    currentProperty = current

    render(<DataSnapshotPanel anchor="ga4" clientId={CLIENT_ID} />)

    expect(await screen.findByRole('button', { name: '立即同步' })).toBeDisabled()
  })
})
