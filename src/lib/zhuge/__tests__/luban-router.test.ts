import { describe, it, expect } from 'vitest'
import { getLubanRoute } from '../luban-router'

const CLIENT_ID = 'client-abc-123'

describe('getLubanRoute()', () => {
  it('routes generate_blog_post to blog page', () => {
    const r = getLubanRoute('luban.generate_blog_post', CLIENT_ID)
    expect(r.kind).toBe('navigate')
    if (r.kind === 'navigate') {
      expect(r.href).toBe(`/dashboard/clients/${CLIENT_ID}/blog`)
      expect(r.label).toBeTruthy()
    }
  })

  it('routes generate_geo_directive to geo composer', () => {
    const r = getLubanRoute('luban.generate_geo_directive', CLIENT_ID)
    expect(r.kind).toBe('navigate')
    if (r.kind === 'navigate') {
      expect(r.href).toBe(`/dashboard/geo-composer/${CLIENT_ID}`)
      expect(r.label).toBeTruthy()
    }
  })

  it('routes publish_geo_snippet to geo composer (same as generate_geo_directive)', () => {
    const r = getLubanRoute('luban.publish_geo_snippet', CLIENT_ID)
    expect(r.kind).toBe('navigate')
    if (r.kind === 'navigate') {
      expect(r.href).toBe(`/dashboard/geo-composer/${CLIENT_ID}`)
    }
  })

  it('routes generate_social_campaign to client page', () => {
    const r = getLubanRoute('luban.generate_social_campaign', CLIENT_ID)
    expect(r.kind).toBe('navigate')
    if (r.kind === 'navigate') {
      expect(r.href).toBe(`/dashboard/clients/${CLIENT_ID}`)
    }
  })

  it('routes generate_social_post to client page (same as campaign)', () => {
    const r = getLubanRoute('luban.generate_social_post', CLIENT_ID)
    expect(r.kind).toBe('navigate')
    if (r.kind === 'navigate') {
      expect(r.href).toBe(`/dashboard/clients/${CLIENT_ID}`)
    }
  })

  it('returns none for null tool (FDE or external action)', () => {
    const r = getLubanRoute(null, CLIENT_ID)
    expect(r.kind).toBe('none')
    if (r.kind === 'none') {
      expect(r.reason).toBeTruthy()
    }
  })

  it('returns none for unrecognised tool name', () => {
    const r = getLubanRoute('luban.unknown_future_tool', CLIENT_ID)
    expect(r.kind).toBe('none')
    if (r.kind === 'none') {
      expect(r.reason).toContain('luban.unknown_future_tool')
    }
  })

  it('embeds clientId correctly in all navigate hrefs', () => {
    const tools = [
      'luban.generate_blog_post',
      'luban.generate_geo_directive',
      'luban.publish_geo_snippet',
      'luban.generate_social_campaign',
      'luban.generate_social_post',
    ]
    for (const tool of tools) {
      const r = getLubanRoute(tool, CLIENT_ID)
      expect(r.kind).toBe('navigate')
      if (r.kind === 'navigate') {
        expect(r.href).toContain(CLIENT_ID)
      }
    }
  })
})
