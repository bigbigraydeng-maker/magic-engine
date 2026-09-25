/**
 * 李白 · 文案溯源工作流 Inngest 装配测试（agent 自治计划 B2）。
 *
 * 测的是**装配 + 关键路径**，不重新验证 `labelProvenance` 自己的逻辑
 * （那些在 src/lib/content/__tests__/libai-provenance*.test.ts 里）：事件名/
 * 重试/并发配置对不对、payload 校验 fail-closed、官网读不到 / LLM 抛错时
 * 是否记 unverifiable 且仍写回、有界写回是否保留 snapshot 里其它子 key。
 *
 * 桥接 unknown：Inngest SDK 的 `createFunction()` 返回类型不对外暴露
 * `.opts`/`.fn` 这两个内部字段的公开类型，但运行时真实存在（同一读法已在
 * knowledge-mining.test.ts / flywheel-seo-weekly.test.ts 验证过）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createLibaiCopyProvenanceFunction,
  pickWebsiteUrl,
  LIBAI_PROVENANCE_JOB,
  type LibaiDeps,
} from '../libai-copy-provenance'
import { cloudFunctions } from '../index'
import { CLOUD_FN_PREFIX, WORKER_OWNED_EVENTS } from '../../client'
import { LIBAI_COPY_GENERATED_EVENT } from '@/lib/content/libai-provenance'

// finish 定义在 mock 工厂内部，避免依赖提升顺序（工厂是惰性调用的，但显式更稳）。
vi.mock('@/lib/cron/run-logger', () => {
  const finish = vi.fn(async () => undefined)
  return {
    startCronRunId: vi.fn(async () => 'run-1'),
    cronRunHandle: vi.fn(() => ({ finish })),
    __finish: finish,
  }
})
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/brief/jina', () => ({ fetchUrlAsMarkdown: vi.fn() }))
vi.mock('@/lib/content/brief-injector', () => ({
  getActiveBrief: vi.fn(),
  formatBriefForPrompt: () => 'BRIEF TEXT',
}))
vi.mock('@/lib/anthropic/client', () => ({ callClaudeChat: vi.fn(), MODEL_HAIKU: 'haiku-test' }))

import { startCronRunId } from '@/lib/cron/run-logger'
import * as runLogger from '@/lib/cron/run-logger'

const finish = (runLogger as unknown as { __finish: ReturnType<typeof vi.fn> }).__finish

beforeEach(() => {
  finish.mockClear()
  vi.mocked(startCronRunId).mockClear()
})

type Fn = ReturnType<typeof createLibaiCopyProvenanceFunction>
function optsOf(fn: Fn) {
  return (fn as unknown as {
    opts: { triggers?: { event?: string }[]; retries?: number; concurrency?: { limit: number; key?: string } }
  }).opts
}
function handlerOf(fn: Fn) {
  return (fn as unknown as { fn: (args: unknown) => Promise<unknown> }).fn
}

const CLIENT_ID = '00000000-0000-4000-8000-000000000001'
const POST_ID = '00000000-0000-4000-8000-000000000002'
const WEBSITE_TEXT = 'A'.repeat(300)

interface Patch {
  table: string
  patch: Record<string, unknown>
}

/** 假 supabase：链式 select/eq 返回自身，maybeSingle 按表返回行，update 记录 patch。 */
function fakeSupabase(rows: {
  content_posts?: Record<string, unknown> | null
  clients?: Record<string, unknown> | null
}): { supabase: SupabaseClient; patches: Patch[] } {
  const patches: Patch[] = []
  const supabase = {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: rows[table as keyof typeof rows] ?? null, error: null }),
        update: (patch: Record<string, unknown>) => {
          patches.push({ table, patch })
          return { eq: async () => ({ error: null }) }
        },
      }
      return chain
    },
  } as unknown as SupabaseClient
  return { supabase, patches }
}

function fakeStep() {
  const ids: string[] = []
  return {
    ids,
    step: {
      run: async (id: string, fn: () => unknown) => {
        ids.push(id)
        return fn()
      },
    },
  }
}

function fakeLlm() {
  // 夹具里的稿子是 caption 一句 + script 一句 = 2 句；解析器要求返回条数等于句数，
  // 第一版只回 1 条，被解析器（正确地）判成格式不对 → unverifiable，把 happy path 测红了。
  return vi.fn(async () => ({
    text: JSON.stringify({
      sentences: [
        { i: 0, label: 'website', note: 'ok' },
        { i: 1, label: 'no_claim', note: 'hook' },
      ],
    }),
    cost_usd: 0.001,
  }))
}

function makeDeps(over: Partial<LibaiDeps> = {}): LibaiDeps {
  const { supabase } = fakeSupabase({
    content_posts: {
      title: 'T',
      script: '脚本一句。',
      caption: '钩子一句。',
      generation_context_snapshot: { endcard: { keep: true } },
    },
    clients: { name: '客户名', domain: 'example.com' },
  })
  return {
    supabase,
    llm: fakeLlm() as unknown as LibaiDeps['llm'],
    fetchPage: vi.fn(async () => ({ markdown: WEBSITE_TEXT })),
    loadBrief: vi.fn(async () => ({
      id: 'brief-1',
      brand_name: '品牌',
      website_urls: ['https://brand.example'],
    })) as unknown as LibaiDeps['loadBrief'],
    ...over,
  }
}

function runEvent(deps: LibaiDeps, data: unknown) {
  const fn = createLibaiCopyProvenanceFunction(deps)
  const { step } = fakeStep()
  return handlerOf(fn)({ event: { id: 'evt-1', data }, step })
}

describe('pickWebsiteUrl', () => {
  it('prefers website_urls[0] > website > domain > null', () => {
    expect(pickWebsiteUrl({ website_urls: ['https://a'], website: 'https://b' }, 'c.com')).toBe('https://a')
    expect(pickWebsiteUrl({ website: 'https://b' }, 'c.com')).toBe('https://b')
    expect(pickWebsiteUrl({}, 'c.com')).toBe('https://c.com')
    expect(pickWebsiteUrl({}, null)).toBeNull()
    expect(pickWebsiteUrl(null, null)).toBeNull()
  })
})

describe('libai-copy-provenance Inngest assembly', () => {
  it('is registered in cloudFunctions with the cloud- id prefix', () => {
    const registered = cloudFunctions.find((fn) => fn.id().includes('libai-copy-provenance'))
    expect(registered).toBeDefined()
    expect(registered!.id().startsWith(CLOUD_FN_PREFIX)).toBe(true)
  })

  it('does not listen on a worker-owned event (one-event-one-owner contract)', () => {
    const fn = createLibaiCopyProvenanceFunction(makeDeps())
    const triggerEvent = optsOf(fn).triggers?.[0]?.event
    expect(triggerEvent).toBe(LIBAI_COPY_GENERATED_EVENT)
    expect((WORKER_OWNED_EVENTS as readonly string[]).includes(triggerEvent as string)).toBe(false)
  })

  it('is configured with retries 0 and per-client concurrency', () => {
    const fn = createLibaiCopyProvenanceFunction(makeDeps())
    const opts = optsOf(fn)
    expect(opts.retries).toBe(0)
    expect(opts.concurrency).toMatchObject({ limit: 2, key: 'event.data.client_id' })
  })

  it('rejects an invalid payload without starting a receipt', async () => {
    const result = await runEvent(makeDeps(), { client_id: 'not-a-uuid', post_id: POST_ID })
    expect(result).toMatchObject({ status: 'invalid_payload' })
    expect(startCronRunId).not.toHaveBeenCalled()
  })

  it('returns post_not_found and finishes the receipt as failed', async () => {
    const { supabase } = fakeSupabase({ content_posts: null, clients: { name: 'n', domain: 'd.com' } })
    const result = await runEvent(makeDeps({ supabase }), { client_id: CLIENT_ID, post_id: POST_ID })
    expect(result).toMatchObject({ status: 'post_not_found' })
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ failed: 1 }))
  })

  it('records unverifiable (no website url) without calling the llm', async () => {
    const { supabase, patches } = fakeSupabase({
      content_posts: { title: 'T', script: '脚本。', caption: '钩子。', generation_context_snapshot: {} },
      clients: { name: 'n', domain: null },
    })
    const llm = fakeLlm()
    const deps = makeDeps({
      supabase,
      llm: llm as unknown as LibaiDeps['llm'],
      loadBrief: vi.fn(async () => ({ id: 'b', brand_name: '品牌' })) as unknown as LibaiDeps['loadBrief'],
    })
    const result = await runEvent(deps, { client_id: CLIENT_ID, post_id: POST_ID })
    expect(result).toMatchObject({ status: 'unverifiable' })
    expect(llm).not.toHaveBeenCalled()
    const snap = (patches[0].patch.generation_context_snapshot as Record<string, unknown>).libai_provenance
    expect(snap).toMatchObject({ status: 'unverifiable' })
    expect((snap as { reason: string }).reason).toContain('官网')
  })

  it('records unverifiable when the website fetch throws', async () => {
    const { supabase, patches } = fakeSupabase({
      content_posts: { title: 'T', script: '脚本。', caption: '钩子。', generation_context_snapshot: {} },
      clients: { name: 'n', domain: 'example.com' },
    })
    const deps = makeDeps({
      supabase,
      fetchPage: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    const result = await runEvent(deps, { client_id: CLIENT_ID, post_id: POST_ID })
    expect(result).toMatchObject({ status: 'unverifiable' })
    const snap = (patches[0].patch.generation_context_snapshot as Record<string, unknown>).libai_provenance
    expect((snap as { reason: string }).reason).toContain('官网读不到')
  })

  it('labels the copy and preserves other snapshot keys on the happy path', async () => {
    const { supabase, patches } = fakeSupabase({
      content_posts: {
        title: 'T',
        script: '脚本一句。',
        caption: '钩子一句。',
        generation_context_snapshot: { endcard: { keep: true } },
      },
      clients: { name: 'n', domain: 'example.com' },
    })
    const deps = makeDeps({ supabase })
    const result = await runEvent(deps, { client_id: CLIENT_ID, post_id: POST_ID })
    expect(result).toMatchObject({ status: 'labelled' })
    const snapshot = patches[0].patch.generation_context_snapshot as Record<string, unknown>
    expect(snapshot.endcard).toEqual({ keep: true })
    expect(snapshot.libai_provenance).toMatchObject({ status: 'labelled' })
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.objectContaining({
          no_publish: true,
          source_record_id: POST_ID,
          status: 'labelled',
        }),
      }),
    )
    expect(typeof (result as { unverified_count: number }).unverified_count).toBe('number')
  })

  it('records unverifiable when the llm throws, and still writes the snapshot', async () => {
    const { supabase, patches } = fakeSupabase({
      content_posts: { title: 'T', script: '脚本。', caption: '钩子。', generation_context_snapshot: {} },
      clients: { name: 'n', domain: 'example.com' },
    })
    const llm = vi.fn(async () => {
      throw new Error('llm down')
    })
    const deps = makeDeps({ supabase, llm: llm as unknown as LibaiDeps['llm'] })
    const result = await runEvent(deps, { client_id: CLIENT_ID, post_id: POST_ID })
    expect(result).toMatchObject({ status: 'unverifiable' })
    const snap = (patches[0].patch.generation_context_snapshot as Record<string, unknown>).libai_provenance
    expect((snap as { reason: string }).reason).toContain('溯源失败')
  })

  it('uses the static job name for the receipt', async () => {
    await runEvent(makeDeps(), { client_id: CLIENT_ID, post_id: POST_ID })
    expect(LIBAI_PROVENANCE_JOB).toBe('libai-copy-provenance')
    expect(startCronRunId).toHaveBeenCalledWith('libai-copy-provenance')
  })
})
