/**
 * Tests for client_site_pages database operations (Phase 8.D.0)
 *
 * Covers:
 * - listSitePages with optional filters (page_type, topic, crawl_status)
 * - upsertSitePage (insert or update by client_id + url)
 * - getSitePageByUrl
 * - markCrawlFailed
 * - countSitePages (for dashboard stats)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => {
  const fromMock = vi.fn()
  return {
    supabaseAdmin: { from: fromMock },
    supabase: { from: fromMock },
  }
})

import {
  listSitePages,
  upsertSitePage,
  getSitePageByUrl,
  markCrawlFailed,
  countSitePages,
} from './site-pages'
import { supabaseAdmin } from '@/lib/supabase'
import type { SitePage } from '@/types/magic-engine'

const CLIENT_ID = 'client-abc'

const samplePage: SitePage = {
  id: 'page-1',
  client_id: CLIENT_ID,
  url: 'https://example.com/services',
  path: '/services',
  page_type: 'service',
  title: 'Our Services',
  h1: 'Services',
  meta_description: null,
  content_summary: 'We provide …',
  word_count: 800,
  topics: ['services', 'consulting'],
  primary_keyword: 'china tour services',
  has_geo_block: false,
  geo_block_version: null,
  crawl_status: 'crawled',
  last_crawled_at: '2026-05-05T00:00:00Z',
  crawl_error: null,
  created_at: '2026-05-05T00:00:00Z',
  updated_at: '2026-05-05T00:00:00Z',
}

describe('Site Pages DB', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('listSitePages', () => {
    it('returns pages filtered by client_id', async () => {
      const order = vi.fn().mockResolvedValue({ data: [samplePage], error: null })
      const eq2 = vi.fn().mockReturnValue({ order })
      const eq1 = vi.fn().mockReturnValue({ eq: eq2, order })
      const select = vi.fn().mockReturnValue({ eq: eq1 })
      vi.mocked(supabaseAdmin.from).mockReturnValue({ select } as any)

      const result = await listSitePages(CLIENT_ID)

      expect(supabaseAdmin.from).toHaveBeenCalledWith('client_site_pages')
      expect(eq1).toHaveBeenCalledWith('client_id', CLIENT_ID)
      expect(result).toEqual([samplePage])
    })

    it('applies page_type filter when provided', async () => {
      const order = vi.fn().mockResolvedValue({ data: [], error: null })
      const eq2 = vi.fn().mockReturnValue({ order })
      const eq1 = vi.fn().mockReturnValue({ eq: eq2, order })
      const select = vi.fn().mockReturnValue({ eq: eq1 })
      vi.mocked(supabaseAdmin.from).mockReturnValue({ select } as any)

      await listSitePages(CLIENT_ID, { page_type: 'blog' })

      expect(eq2).toHaveBeenCalledWith('page_type', 'blog')
    })

    it('throws when supabase returns error', async () => {
      const order = vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'db down' } })
      const eq1 = vi.fn().mockReturnValue({ order })
      const select = vi.fn().mockReturnValue({ eq: eq1 })
      vi.mocked(supabaseAdmin.from).mockReturnValue({ select } as any)

      await expect(listSitePages(CLIENT_ID)).rejects.toThrow(/db down/)
    })
  })

  describe('upsertSitePage', () => {
    it('upserts on conflict of (client_id, url)', async () => {
      const single = vi
        .fn()
        .mockResolvedValue({ data: samplePage, error: null })
      const select = vi.fn().mockReturnValue({ single })
      const upsert = vi.fn().mockReturnValue({ select })
      vi.mocked(supabaseAdmin.from).mockReturnValue({ upsert } as any)

      const result = await upsertSitePage({
        client_id: CLIENT_ID,
        url: samplePage.url,
        path: samplePage.path,
        page_type: 'service',
        title: 'Our Services',
        crawl_status: 'crawled',
      })

      expect(supabaseAdmin.from).toHaveBeenCalledWith('client_site_pages')
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          client_id: CLIENT_ID,
          url: samplePage.url,
          path: '/services',
        }),
        expect.objectContaining({ onConflict: 'client_id,url' })
      )
      expect(result).toEqual(samplePage)
    })

    it('throws when upsert returns error', async () => {
      const single = vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'unique violation' } })
      const select = vi.fn().mockReturnValue({ single })
      const upsert = vi.fn().mockReturnValue({ select })
      vi.mocked(supabaseAdmin.from).mockReturnValue({ upsert } as any)

      await expect(
        upsertSitePage({
          client_id: CLIENT_ID,
          url: samplePage.url,
          path: samplePage.path,
        })
      ).rejects.toThrow(/unique violation/)
    })
  })

  describe('getSitePageByUrl', () => {
    it('returns single page matching client_id + url', async () => {
      const maybeSingle = vi
        .fn()
        .mockResolvedValue({ data: samplePage, error: null })
      const eq2 = vi.fn().mockReturnValue({ maybeSingle })
      const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
      const select = vi.fn().mockReturnValue({ eq: eq1 })
      vi.mocked(supabaseAdmin.from).mockReturnValue({ select } as any)

      const result = await getSitePageByUrl(CLIENT_ID, samplePage.url)

      expect(eq1).toHaveBeenCalledWith('client_id', CLIENT_ID)
      expect(eq2).toHaveBeenCalledWith('url', samplePage.url)
      expect(result).toEqual(samplePage)
    })

    it('returns null when no match', async () => {
      const maybeSingle = vi
        .fn()
        .mockResolvedValue({ data: null, error: null })
      const eq2 = vi.fn().mockReturnValue({ maybeSingle })
      const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
      const select = vi.fn().mockReturnValue({ eq: eq1 })
      vi.mocked(supabaseAdmin.from).mockReturnValue({ select } as any)

      const result = await getSitePageByUrl(CLIENT_ID, 'https://nope')

      expect(result).toBeNull()
    })
  })

  describe('markCrawlFailed', () => {
    it('upserts a failed entry with error message', async () => {
      const single = vi
        .fn()
        .mockResolvedValue({ data: { ...samplePage, crawl_status: 'failed' }, error: null })
      const select = vi.fn().mockReturnValue({ single })
      const upsert = vi.fn().mockReturnValue({ select })
      vi.mocked(supabaseAdmin.from).mockReturnValue({ upsert } as any)

      await markCrawlFailed(CLIENT_ID, 'https://example.com/broken', 'timeout')

      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          client_id: CLIENT_ID,
          url: 'https://example.com/broken',
          path: '/broken',
          crawl_status: 'failed',
          crawl_error: 'timeout',
        }),
        expect.objectContaining({ onConflict: 'client_id,url' })
      )
    })
  })

  describe('countSitePages', () => {
    it('returns count for the client', async () => {
      const eq1 = vi.fn().mockResolvedValue({ count: 42, error: null })
      const select = vi.fn().mockReturnValue({ eq: eq1 })
      vi.mocked(supabaseAdmin.from).mockReturnValue({ select } as any)

      const result = await countSitePages(CLIENT_ID)

      expect(select).toHaveBeenCalledWith('id', { count: 'exact', head: true })
      expect(eq1).toHaveBeenCalledWith('client_id', CLIENT_ID)
      expect(result).toBe(42)
    })

    it('returns 0 when count is null', async () => {
      const eq1 = vi.fn().mockResolvedValue({ count: null, error: null })
      const select = vi.fn().mockReturnValue({ eq: eq1 })
      vi.mocked(supabaseAdmin.from).mockReturnValue({ select } as any)

      const result = await countSitePages(CLIENT_ID)

      expect(result).toBe(0)
    })
  })
})
