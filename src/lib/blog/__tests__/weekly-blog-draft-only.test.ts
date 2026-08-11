/**
 * 反向断言：这条生成线**只产草稿**。
 *
 * 🔴 为什么要单独锁：DAPE 的自动执行循环把这条线接成了「机器每天自己跑」。
 *    在此之前，走这条线的只有周更 cron，产物落 draft 是个约定；
 *    接上自动执行之后，它变成了**唯一挡在「机器自己往客户网站发东西」前面的东西**。
 *    白名单那份注释里写得很清楚：安全闸是 draft 状态，不是 PR。
 *
 * 所以这里钉三件事：
 *   ① 写进 blog_posts 的 status 只能是 'draft'
 *   ② 这条线不碰任何发布/CMS 路径
 *   ③ 一周一篇的冷却真的在拦（不然自动执行会把周更挤掉，或者反过来）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/blog/topic-selector', () => ({
  getWeakSpotOpportunities: vi.fn(async () => [
    {
      query_id: 'q1',
      query_text: 'spc flooring for wet areas',
      weakness_score: 0.9,
      engines_missing: ['openai'],
      total_runs_checked: 3,
      last_run_at: null,
      mode: 'unified',
      primary_keyword: 'spc flooring',
    },
  ]),
}))
vi.mock('@/lib/blog/content-gate', () => ({
  checkContentDuplicate: vi.fn(async () => ({ verdict: 'new' })),
}))
vi.mock('@/lib/blog/content-auditor', () => ({
  auditExistingContent: vi.fn(async () => ({ action: 'new' })),
}))
vi.mock('@/lib/blog/pages-context', () => ({
  fetchRelatedPages: vi.fn(async () => []),
  buildPagesContextBlock: vi.fn(() => ''),
}))
vi.mock('@/lib/blog/internal-link-checker', () => ({
  checkInternalLinks: vi.fn(() => ({ ok: true })),
}))
vi.mock('@/lib/blog/generate-with-quality', () => ({
  generateWithQualityRetry: vi.fn(async () => ({
    result: {
      title: 'T',
      meta_title: 'MT',
      meta_description: 'MD',
      slug: 't',
      html_body: '<p>x</p>',
      word_count: 900,
      geo_directive_id: null,
      geo_html_snapshot: null,
      featured_image_prompt: null,
      cost_usd: 0.0498,
      model_used: 'gpt-4o-mini',
    },
    qualityScore: 88,
    contextSnapshot: {},
  })),
}))
vi.mock('@/lib/flywheel/adapters/SeoContentAdapter', () => ({
  SeoContentAdapter: class {
    async execute() {
      return { ok: true }
    }
  },
}))

import { generateWeeklyBlogForClient } from '../weekly-blog'
import { checkContentDuplicate } from '../content-gate'

type Row = Record<string, unknown>

/** 假 supabase 按表建模；记下所有 insert 供反向断言。 */
function makeFake(opts: { recentPosts?: Row[]; brief?: Row | null } = {}) {
  const inserts: Record<string, Row[]> = {}
  const from = (table: string) => {
    const api: Record<string, unknown> = {}
    const chain = () => api
    let inserted: Row | null = null
    for (const op of ['select', 'eq', 'gte', 'in', 'not', 'or', 'order', 'limit']) {
      api[op] = () => chain()
    }
    api.insert = (row: Row) => {
      inserted = row
      inserts[table] = [...(inserts[table] ?? []), row]
      return chain()
    }
    api.single = () => Promise.resolve({ data: { id: 'post-1', ...(inserted ?? {}) }, error: null })
    api.maybeSingle = () =>
      Promise.resolve({ data: table === 'master_briefs' ? (opts.brief ?? null) : null, error: null })
    api.then = (resolve: (v: unknown) => unknown) => {
      if (table === 'blog_posts') return Promise.resolve({ data: opts.recentPosts ?? [], error: null }).then(resolve)
      return Promise.resolve({ data: [], error: null }).then(resolve)
    }
    return api
  }
  return { fake: { from } as unknown as SupabaseClient, inserts }
}

const CLIENT = { id: 'oztop', name: 'Oztop', domain: 'oztop.com.au' }

beforeEach(() => vi.clearAllMocks())

describe('🔴 这条生成线只产草稿', () => {
  it('写进 blog_posts 的 status 只能是 draft —— 别的值一个都不许出现', async () => {
    const { fake, inserts } = makeFake()
    const res = await generateWeeklyBlogForClient(fake, CLIENT)

    expect(res.outcome).toBe('generated')
    expect(inserts.blog_posts).toHaveLength(1)
    expect(inserts.blog_posts[0].status).toBe('draft')
    // 反向：任何一条新行都不许是别的状态
    for (const row of inserts.blog_posts) {
      expect(['pr_open', 'published', 'scheduled', 'live']).not.toContain(row.status)
    }
  })

  it('🔴 走一遍去重闸，不是写完再说', async () => {
    const { fake } = makeFake()
    await generateWeeklyBlogForClient(fake, CLIENT)
    expect(vi.mocked(checkContentDuplicate)).toHaveBeenCalled()
  })

  it('🔴 这周已经有文章了 → 一个字都不写（一周一篇是总量，人跑机器跑都算）', async () => {
    const { fake, inserts } = makeFake({ recentPosts: [{ id: 'existing' }] })
    const res = await generateWeeklyBlogForClient(fake, CLIENT)

    expect(res.outcome).toBe('skipped_recent_post')
    expect(inserts.blog_posts).toBeUndefined()
  })

  it('源码里不出现任何发布 / CMS / GitHub 路径', () => {
    const src = readFileSync(path.join(__dirname, '../weekly-blog.ts'), 'utf8')
    for (const forbidden of ['@/lib/cms', 'GithubClient', 'publish-blog', 'pr_open']) {
      expect(src.includes(forbidden), `weekly-blog.ts 里出现了 ${forbidden}`).toBe(false)
    }
  })
})
