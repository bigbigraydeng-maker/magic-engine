import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Ga4Panel } from '../Ga4Panel'
import type { PlatformConnectionSummary } from '@/lib/platform-oauth/vocabulary'

const CLIENT_ID = 'client-ga4-panel-test'

const ACTIVE_CONNECTION: PlatformConnectionSummary = {
  id: 'connection-1',
  provider: 'google_ga4',
  display_name: 'owner@example.com',
  account_id: 'owner@example.com',
  location_name: null,
  status: 'active',
  scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
  last_synced_at: null,
  error_message: null,
}

let connectorStatus: 'connected' | 'error' | null
let currentProperty: string | null
let oauthConnections: PlatformConnectionSummary[]
let tokenAvailable: boolean

beforeEach(() => {
  connectorStatus = null
  currentProperty = null
  oauthConnections = [ACTIVE_CONNECTION]
  tokenAvailable = true
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/ga4-properties')) {
      return {
        ok: true,
        json: async () => ({
          connected: tokenAvailable,
          connector_status: connectorStatus,
          current: currentProperty,
          options: [],
        }),
      } as Response
    }
    if (url.endsWith('/platform/ga4')) {
      return {
        ok: true,
        json: async () => ({ connections: oauthConnections }),
      } as Response
    }
    throw new Error(`unexpected fetch: ${url}`)
  }) as typeof fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Ga4Panel state invariant', () => {
  it('shows OAuth as authorized — not GA4 connected — until a Property is verified', async () => {
    render(<Ga4Panel clientId={CLIENT_ID} />)

    expect(await screen.findByText('Google 账号已授权')).toBeInTheDocument()
    expect(screen.queryByText('已连接')).not.toBeInTheDocument()
  })

  it('shows GA4 connected only when client_connectors reports a verified Property', async () => {
    connectorStatus = 'connected'
    currentProperty = 'properties/550203806'

    render(<Ga4Panel clientId={CLIENT_ID} />)

    expect(await screen.findByText('已连接')).toBeInTheDocument()
    expect(screen.getByText('properties/550203806')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '断开连接' })).not.toBeInTheDocument()
  })

  it('keeps a historical verified connection visible when it uses the shared Google token', async () => {
    connectorStatus = 'connected'
    currentProperty = 'properties/550203806'
    oauthConnections = []

    render(<Ga4Panel clientId={CLIENT_ID} />)

    expect(await screen.findByText('已连接')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '断开连接' })).not.toBeInTheDocument()
  })

  it('shows a historical shared token as authorized while Property selection is pending', async () => {
    oauthConnections = []

    render(<Ga4Panel clientId={CLIENT_ID} />)

    expect(await screen.findByText('Google 账号已授权')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /连接 Google 网站数据/ })).not.toBeInTheDocument()
  })

  it('shows shared-token verification failure as authorized, not disconnected', async () => {
    oauthConnections = []
    connectorStatus = 'error'
    currentProperty = 'properties/550203806'

    render(<Ga4Panel clientId={CLIENT_ID} />)

    expect(await screen.findByText('Google 账号已授权')).toBeInTheDocument()
    expect(screen.getByText(/Property 验证没有通过/)).toBeInTheDocument()
  })

  it('uses the working shared-token truth when a dedicated row is errored', async () => {
    oauthConnections = [{ ...ACTIVE_CONNECTION, status: 'error', error_message: 'old refresh failed' }]
    connectorStatus = 'connected'
    currentProperty = 'properties/550203806'

    render(<Ga4Panel clientId={CLIENT_ID} />)

    expect(await screen.findByText('已连接')).toBeInTheDocument()
    expect(screen.queryByText(/连接中断/)).not.toBeInTheDocument()
  })

  it('does not show connected without a valid Property even when the connector row says connected', async () => {
    connectorStatus = 'connected'
    currentProperty = null

    render(<Ga4Panel clientId={CLIENT_ID} />)

    expect(await screen.findByText('Google 账号已授权')).toBeInTheDocument()
    expect(screen.queryByText('已连接')).not.toBeInTheDocument()
  })

  it('refreshes the top card after the Property panel reports a successful save', async () => {
    render(<Ga4Panel clientId={CLIENT_ID} />)
    expect(await screen.findByText('Google 账号已授权')).toBeInTheDocument()

    connectorStatus = 'connected'
    currentProperty = 'properties/550203806'
    act(() => {
      window.dispatchEvent(new CustomEvent('ga4-property-changed', { detail: { clientId: CLIENT_ID } }))
    })

    await waitFor(() => expect(screen.getByText('已连接')).toBeInTheDocument())
    expect(screen.getByText('properties/550203806')).toBeInTheDocument()
  })

  it('does not show a stale connected connector as live when no Google token resolves', async () => {
    connectorStatus = 'connected'
    currentProperty = 'properties/550203806'
    oauthConnections = []
    tokenAvailable = false

    render(<Ga4Panel clientId={CLIENT_ID} />)

    expect(await screen.findByRole('link', { name: /连接 Google 网站数据/ })).toBeInTheDocument()
    expect(screen.queryByText('已连接')).not.toBeInTheDocument()
  })
})
