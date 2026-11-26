// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let query = new URLSearchParams('client=c1')
vi.mock('next/navigation', () => ({ useSearchParams: () => query }))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('../_components/ReviewInbox', () => ({ ReviewInbox: () => null }))
vi.mock('../_components/RecoveryQueue', () => ({ RecoveryQueue: () => null }))
vi.mock('../_components/VariantOrderPanel', () => ({ VariantOrderPanel: () => null }))

import FactoryCockpitPage from '../page'

let root: ReturnType<typeof createRoot> | null = null
let host: HTMLDivElement | null = null

async function mount() {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ orders: [], worker: null }) })))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root?.render(<FactoryCockpitPage />) })
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve() })
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  vi.unstubAllGlobals()
})

it('工厂页不再放样板面板，只留一个指向广告页「广告样板」标签的小链接', async () => {
  query = new URLSearchParams('client=c1')
  await mount()
  expect(document.body.textContent).not.toContain('当前广告样板（赢家）')
  const link = [...document.querySelectorAll('a')].find((a) => a.textContent?.includes('当前广告样板在广告页'))
  expect(link?.getAttribute('href')).toBe('/dashboard/clients/c1/ads-health?tab=winners')
})
