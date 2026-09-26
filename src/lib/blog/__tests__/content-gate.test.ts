/**
 * Unit tests for the content-duplicate gate (2026-08-01 root fix).
 * The first case IS the incident: the exact pair that slipped through.
 */

import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import {
  topicTokens,
  tokenJaccard,
  normalizeSlug,
  findDuplicate,
  checkContentDuplicate,
  type ExistingContent,
} from '../content-gate'

function page(partial: Partial<ExistingContent>): ExistingContent {
  return { source: 'site_page', title: null, slug: null, ref: 'x', keyword: null, ...partial }
}

describe('findDuplicate — the CTS incident', () => {
  it('catches the exact pair that slipped through on 2026-07-31', () => {
    // ME drafted this while the live site already had the article below.
    const candidate = { topic: 'How do I plan my first trip to China from New Zealand?' }
    const live = page({
      slug: 'https://www.ctstours.co.nz/blog/plan-your-first-trip-to-china-from-new-zealand',
      ref: 'https://www.ctstours.co.nz/blog/plan-your-first-trip-to-china-from-new-zealand',
    })
    expect(findDuplicate(candidate, [live])).toBe(live)
  })

  it('a published blog_post is a duplicate regardless of age (no 60-day window)', () => {
    const old = page({
      source: 'blog_post',
      title: 'How to Plan Your First Trip to China from New Zealand: A Step-by-Step Guide',
      slug: 'how-to-plan-first-trip-to-china-from-new-zealand',
    })
    expect(
      findDuplicate({ topic: 'How do I plan my first trip to China from New Zealand?' }, [old]),
    ).toBe(old)
  })
})

describe('findDuplicate — matching rules', () => {
  it('matches on exact primary keyword', () => {
    const item = page({ source: 'blog_post', title: 'totally different title', keyword: 'SPC Flooring Brisbane' })
    expect(findDuplicate({ topic: 'unrelated', primary_keyword: 'spc flooring brisbane' }, [item])).toBe(item)
  })

  it('matches on normalized slug equality', () => {
    const item = page({ slug: '/blog/best-tiles-brisbane/' })
    expect(findDuplicate({ topic: 'x', slug: 'best-tiles-brisbane' }, [item])).toBe(item)
  })

  it('does NOT flag genuinely different topics', () => {
    const item = page({
      source: 'blog_post',
      title: 'Best waterproof flooring for Brisbane homes',
    })
    expect(
      findDuplicate({ topic: 'How do I choose bathroom tiles for a Queenslander renovation?' }, [item]),
    ).toBeNull()
  })

  it('returns null on empty inventory', () => {
    expect(findDuplicate({ topic: 'anything' }, [])).toBeNull()
  })
})

describe('text primitives', () => {
  it('topicTokens drops stop words and punctuation', () => {
    expect(topicTokens("What's the best flooring in Brisbane?")).toEqual(
      new Set(['flooring', 'brisbane']),
    )
  })

  it('tokenJaccard is 1 for identical sets and 0 for disjoint', () => {
    expect(tokenJaccard(new Set(['a1', 'b1']), new Set(['a1', 'b1']))).toBe(1)
    expect(tokenJaccard(new Set(['a1']), new Set(['b1']))).toBe(0)
    expect(tokenJaccard(new Set(), new Set(['b1']))).toBe(0)
  })

  it('normalizeSlug strips path, extension and slashes', () => {
    expect(normalizeSlug('https://x.com/blog/my-post/')).toBe('my-post')
    expect(normalizeSlug('content/blog/my-post.md')).toBe('my-post')
    expect(normalizeSlug(null)).toBeNull()
  })
})

describe('checkContentDuplicate — firewall-blocked site pages still count (2026-09-26)', () => {
  // Type aliases (not interfaces) so rows stay assignable to Record<string, unknown>
  // without any double type assertion.
  type FakeSitePageRow = {
    client_id: string
    url: string
    title: string | null
    primary_keyword: string | null
    crawl_status: string
  }

  type FakeBlogPostRow = {
    client_id: string
    title: string | null
    topic: string | null
    slug: string | null
    status: string
    primary_keyword: string | null
  }

  type FakeRow = Record<string, unknown>

  interface FakeQuery {
    select(cols: string): FakeQuery
    eq(col: string, val: unknown): FakeQuery
    in(col: string, vals: readonly unknown[]): FakeQuery
    then<TResult>(
      resolve: (value: { data: FakeRow[]; error: null }) => TResult,
    ): Promise<TResult>
  }

  interface FakeSupabase {
    from(table: string): FakeQuery
  }

  function asClient(x: object): SupabaseClient {
    return x as SupabaseClient
  }

  function makeFakeClient(tables: Record<string, FakeRow[]>): FakeSupabase {
    return {
      from(table: string): FakeQuery {
        let rows: FakeRow[] = tables[table] ?? []
        const query: FakeQuery = {
          select() {
            return query
          },
          eq(col: string, val: unknown) {
            rows = rows.filter((r) => r[col] === val)
            return query
          },
          in(col: string, vals: readonly unknown[]) {
            rows = rows.filter((r) => vals.includes(r[col]))
            return query
          },
          then<TResult>(
            resolve: (value: { data: FakeRow[]; error: null }) => TResult,
          ): Promise<TResult> {
            return Promise.resolve({ data: rows, error: null }).then(resolve)
          },
        }
        return query
      },
    }
  }

  const sitePages: FakeSitePageRow[] = [
    {
      client_id: 'client-1',
      url: 'https://example.com/product-category/hybrid-flooring/',
      title: 'Hybrid Flooring',
      primary_keyword: null,
      crawl_status: 'antibot_challenged',
    },
    {
      client_id: 'client-1',
      url: 'https://example.com/product-category/wool-carpet/',
      title: 'Wool Carpet',
      primary_keyword: null,
      crawl_status: 'failed',
    },
    {
      client_id: 'client-1',
      url: 'https://example.com/about/',
      title: 'About Us',
      primary_keyword: null,
      crawl_status: 'crawled',
    },
  ]

  const blogPosts: FakeBlogPostRow[] = []

  function fakeClient(): SupabaseClient {
    return asClient(
      makeFakeClient({
        blog_posts: blogPosts,
        client_site_pages: sitePages,
      }),
    )
  }

  it('treats an antibot_challenged page as existing content', async () => {
    const verdict = await checkContentDuplicate(
      'client-1',
      { topic: 'Hybrid Flooring', primary_keyword: null, slug: null },
      fakeClient(),
    )
    expect(verdict).toEqual({
      verdict: 'duplicate',
      source: 'site_page',
      existing_title: 'Hybrid Flooring',
      existing_ref: 'https://example.com/product-category/hybrid-flooring/',
    })
  })

  it('still excludes pages whose crawl_status is failed', async () => {
    const verdict = await checkContentDuplicate(
      'client-1',
      { topic: 'Wool Carpet', primary_keyword: null, slug: null },
      fakeClient(),
    )
    expect(verdict).toEqual({ verdict: 'new' })
  })
})
