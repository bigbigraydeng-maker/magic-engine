/**
 * Tests for POST /api/clients/[id]/blog/[postId]/social-suggest
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/strategy/social-suggester', () => ({
  generateSocialSuggestions: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

import { POST } from './route'
import { generateSocialSuggestions } from '@/lib/strategy/social-suggester'
import { supabaseAdmin } from '@/lib/supabase'

const params = { id: 'client-1', postId: 'post-1' }
const req = () =>
  new NextRequest('http://localhost/api/clients/x/blog/y/social-suggest', {
    method: 'POST',
  })

function mockBlogPostLookup(payload: any) {
  const single = vi.fn().mockResolvedValue({ data: payload, error: null })
  const eq = vi.fn().mockReturnValue({ single })
  const select = vi.fn().mockReturnValue({ eq })
  vi.mocked(supabaseAdmin.from).mockReturnValue({ select } as any)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST social-suggest', () => {
  it('runs suggester and returns suggestions', async () => {
    mockBlogPostLookup({
      id: 'post-1',
      client_id: 'client-1',
      title: 'T',
      html_body: '<p>x</p>',
      primary_keyword: 'k',
    })
    vi.mocked(generateSocialSuggestions).mockResolvedValue({
      suggestions: [
        { platform: 'facebook', headline: 'h', body: 'b' },
      ],
      inserted: 1,
      cost_usd: 0.001,
    } as any)

    const res = await POST(req(), { params })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.suggestions.length).toBe(1)
    expect(generateSocialSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({ blog_post_id: 'post-1', client_id: 'client-1' })
    )
  })

  it('returns 404 when post missing', async () => {
    mockBlogPostLookup(null)
    const res = await POST(req(), { params })
    expect(res.status).toBe(404)
  })

  it('returns 404 when post belongs to different client', async () => {
    mockBlogPostLookup({
      id: 'post-1',
      client_id: 'other',
      title: 't',
      html_body: '',
      primary_keyword: null,
    })
    const res = await POST(req(), { params })
    expect(res.status).toBe(404)
  })

  it('returns 500 when suggester throws', async () => {
    mockBlogPostLookup({
      id: 'post-1',
      client_id: 'client-1',
      title: 't',
      html_body: '',
      primary_keyword: null,
    })
    vi.mocked(generateSocialSuggestions).mockRejectedValue(new Error('boom'))
    const res = await POST(req(), { params })
    expect(res.status).toBe(500)
  })
})
