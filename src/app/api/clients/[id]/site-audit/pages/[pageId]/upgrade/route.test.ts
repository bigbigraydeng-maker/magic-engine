/**
 * Tests for POST /api/clients/[id]/site-audit/pages/[pageId]/upgrade
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/strategy/page-upgrader', () => ({
  upgradePage: vi.fn(),
}))

import { POST } from './route'
import { upgradePage } from '@/lib/strategy/page-upgrader'

const params = { id: 'client-1', pageId: 'page-1' }
const req = () =>
  new NextRequest('http://localhost/api/clients/x/site-audit/pages/y/upgrade', {
    method: 'POST',
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST upgrade route', () => {
  it('returns recommendation on success', async () => {
    vi.mocked(upgradePage).mockResolvedValue({
      page_id: 'page-1',
      page_url: 'u',
      current_word_count: 600,
      current_has_geo_block: false,
      what_to_add: ['x'],
      what_to_strengthen: [],
      meta_title_suggestion: null,
      meta_description_suggestion: null,
      upgraded_html_preview: '<h1>x</h1>',
      rationale: 'r',
      geo_directive_id: null,
      cost_usd: 0.01,
      model_used: 'gpt-4o',
    })

    const res = await POST(req(), { params })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.recommendation.upgraded_html_preview).toMatch(/<h1>/)
  })

  it('returns 404 when page not found', async () => {
    vi.mocked(upgradePage).mockRejectedValue(new Error('Site page x not found'))
    const res = await POST(req(), { params })
    expect(res.status).toBe(404)
  })

  it('returns 404 when page belongs to another client', async () => {
    vi.mocked(upgradePage).mockRejectedValue(
      new Error('Page x does not belong to client y')
    )
    const res = await POST(req(), { params })
    expect(res.status).toBe(404)
  })

  it('returns 500 on other failures', async () => {
    vi.mocked(upgradePage).mockRejectedValue(new Error('openai timeout'))
    const res = await POST(req(), { params })
    expect(res.status).toBe(500)
  })
})
