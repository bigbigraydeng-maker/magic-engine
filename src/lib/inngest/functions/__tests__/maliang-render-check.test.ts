/**
 * 马良出片自检工作流 Inngest 装配测试（agent 自治计划 B2）。
 *
 * 测的是**装配 + 关键路径**，不重新验证 render-check.ts 自己的逻辑（那些在
 * src/lib/maliang/__tests__/render-check*.test.ts 里）：事件名/重试/并发配置
 * 对不对、payload 校验 fail-closed、读不到上下文是否 fail-closed、裁决写回
 * 是否只动 snapshot 的 maliang_check 子 key、不过关是否标工单返工、回执
 * 是否按 unverifiable 记 failed。
 *
 * 桥接 unknown：Inngest SDK 的 `createFunction()` 返回类型不对外暴露
 * `.opts`/`.fn` 这两个内部字段的公开类型，但运行时真实存在（同一读法已在
 * knowledge-mining.test.ts / factory-creatomate-render.test.ts 验证过）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createMaliangRenderCheckFunction,
  logoExpectedFrom,
  scenesToInput,
  MALIANG_RENDER_READY_EVENT,
  NEEDS_REWORK_STATUS,
  type MaliangDeps,
} from '../maliang-render-check'
import { cloudFunctions } from '../index'
import { CLOUD_FN_PREFIX, WORKER_OWNED_EVENTS } from '../../client'
import type { MaliangCheck } from '@/lib/maliang/render-check'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const finish = vi.fn().mockResolvedValue(undefined)
const startCronRunId = vi.fn().mockResolvedValue('run-1')

vi.mock('@/lib/cron/run-logger', () => ({
  startCronRunId: (...args: unknown[]) => startCronRunId(...args),
  cronRunHandle: () => ({ finish }),
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

// 让 import render-check 安全：不真调 Gemini。
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent: async () => ({ response: { text: () => '' } }) }
    }
  },
}))
vi.mock('@google/generative-ai/server', () => ({
  GoogleAIFileManager: class {
    async uploadFile() {
      return { file: { name: 'f', uri: 'u', state: 'ACTIVE' } }
    }
    async getFile() {
      return { name: 'f', uri: 'u', state: 'ACTIVE' }
    }
    async deleteFile() {}
  },
}))

beforeEach(() => {
  finish.mockClear()
  startCronRunId.mockClear()
})

// ─── Fakes ────────────────────────────────────────────────────────────────────

type Fn = ReturnType<typeof createMaliangRenderCheckFunction>
function optsOf(fn: Fn) {
  return (fn as unknown as {
    opts: { triggers?: { event?: string }[]; retries?: number; concurrency?: { limit: number; key?: string } }
  }).opts
}
function handlerOf(fn: Fn) {
  return (fn as unknown as { fn: (args: unknown) => Promise<unknown> }).fn
}

const CLIENT_ID = '00000000-0000-4000-8000-000000000001'
const JOB_ID = '00000000-0000-4000-8000-000000000002'
const POST_ID = '00000000-0000-4000-8000-000000000003'
const OUTPUT_URL = 'https://example.supabase.co/storage/v1/object/public/x.mp4'

interface UpdateRecord {
  table: string
  patch: Record<string, unknown>
}

interface FakeSupabase {
  client: SupabaseClient
  updates: UpdateRecord[]
}

function makeSupabase(rows: {
  job?: Record<string, unknown> | null
  post?: Record<string, unknown> | null
  client?: Record<string, unknown> | null
  error?: { table: string; message: string }
}): FakeSupabase {
  const updates: UpdateRecord[] = []

  const chain = (table: string) => {
    const state: { patch: Record<string, unknown> | null } = { patch: null }
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => {
        if (rows.error && rows.error.table === table) {
          return { data: null, error: { message: rows.error.message } }
        }
        if (table === 'content_factory_render_jobs') return { data: rows.job ?? null, error: null }
        if (table === 'content_posts') return { data: rows.post ?? null, error: null }
        if (table === 'clients') return { data: rows.client ?? null, error: null }
        return { data: null, error: null }
      },
      update: (patch: Record<string, unknown>) => {
        state.patch = patch
        updates.push({ table, patch })
        return { eq: async () => ({ error: null }) }
      },
    }
    return builder
  }

  const client = { from: (table: string) => chain(table) } as unknown as SupabaseClient
  return { client, updates }
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

function makeDeps(supabase: SupabaseClient, check: MaliangDeps['check']): MaliangDeps {
  return { supabase, check, apiKey: () => 'test-key' }
}

const PASS_CHECK: MaliangCheck = {
  status: 'pass',
  checked_at: '2026-01-01T00:00:00.000Z',
  video_url: OUTPUT_URL,
  reasons: [],
  frames: [],
  model: 'gemini-2.5-flash',
}

const FAIL_CHECK: MaliangCheck = {
  ...PASS_CHECK,
  status: 'fail',
  reasons: ['第 3 镜文字：字幕被裁'],
}

const UNVERIFIABLE_CHECK: MaliangCheck = {
  ...PASS_CHECK,
  status: 'unverifiable',
  reasons: ['GEMINI_API_KEY 未配置，马良看不了片'],
  model: null,
}

const GOOD_ROWS = {
  job: { scenes: [{ captionText: '你好', visualSource: 'real_photo' }] },
  post: { title: 'T', generation_context_snapshot: { endcard: 'keep-me' } },
  client: { name: 'Brand', factory_config: {} },
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('maliang-render-check Inngest assembly', () => {
  it('is registered in cloudFunctions with the cloud- id prefix', () => {
    const registered = cloudFunctions.find((fn) => fn.id().includes('maliang-render-check'))
    expect(registered).toBeDefined()
    expect(registered!.id().startsWith(CLOUD_FN_PREFIX)).toBe(true)
  })

  it('does not listen on a worker-owned event (one-event-one-owner contract)', () => {
    const fn = createMaliangRenderCheckFunction(makeDeps(makeSupabase(GOOD_ROWS).client, vi.fn()))
    const triggerEvent = optsOf(fn).triggers?.[0]?.event
    expect(triggerEvent).toBe(MALIANG_RENDER_READY_EVENT)
    expect((WORKER_OWNED_EVENTS as readonly string[]).includes(triggerEvent as string)).toBe(false)
  })

  it('is configured with retries 0 and per-client concurrency limit 1', () => {
    const fn = createMaliangRenderCheckFunction(makeDeps(makeSupabase(GOOD_ROWS).client, vi.fn()))
    const opts = optsOf(fn)
    expect(opts.retries).toBe(0)
    expect(opts.concurrency).toMatchObject({ limit: 1, key: 'event.data.client_id' })
  })

  it('rejects an invalid payload without starting a receipt', async () => {
    const check = vi.fn()
    const fn = createMaliangRenderCheckFunction(makeDeps(makeSupabase(GOOD_ROWS).client, check))
    const result = await handlerOf(fn)({
      event: { id: 'evt-1', data: { client_id: CLIENT_ID, job_id: JOB_ID, post_id: POST_ID, output_url: 'not-a-url' } },
      step: fakeStep().step,
    })
    expect(result).toMatchObject({ status: 'invalid_payload' })
    expect(startCronRunId).not.toHaveBeenCalled()
    expect(check).not.toHaveBeenCalled()
  })

  it('returns context_unreadable and records a failed receipt when the job row is missing', async () => {
    const check = vi.fn()
    const fn = createMaliangRenderCheckFunction(
      makeDeps(makeSupabase({ ...GOOD_ROWS, job: null }).client, check),
    )
    const result = await handlerOf(fn)({
      event: { id: 'evt-2', data: { client_id: CLIENT_ID, job_id: JOB_ID, post_id: POST_ID, output_url: OUTPUT_URL } },
      step: fakeStep().step,
    })
    expect(result).toMatchObject({ status: 'context_unreadable' })
    expect(check).not.toHaveBeenCalled()
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ failed: 1 }))
  })
})

describe('logoExpectedFrom', () => {
  it('is true when a static override key looks like a logo/watermark/brand layer', () => {
    const cfg = {
      render: {
        creatomate: {
          template_id: 't',
          scene_field_map: [{ visual: 'V1' }],
          static_overrides: { Watermark: 'https://x/y.png' },
        },
      },
    }
    expect(logoExpectedFrom(cfg)).toBe(true)
  })

  it('is false when there are no logo-ish overrides', () => {
    const cfg = {
      render: { creatomate: { template_id: 't', scene_field_map: [{ visual: 'V1' }], static_overrides: { CTA: 'Buy' } } },
    }
    expect(logoExpectedFrom(cfg)).toBe(false)
  })

  it('is false for junk input', () => {
    expect(logoExpectedFrom(null)).toBe(false)
    expect(logoExpectedFrom('nonsense')).toBe(false)
    expect(logoExpectedFrom({ render: { creatomate: { static_overrides: 'nope' } } })).toBe(false)
  })
})

describe('scenesToInput', () => {
  it('maps captions and visual-source notes', () => {
    const out = scenesToInput([
      { captionText: '第一句', visualSource: 'real_photo' },
      { captionText: '第二句', visualSource: 'ai_generated' },
    ])
    expect(out.captions).toEqual(['第一句', '第二句'])
    expect(out.notes).toEqual(['scene 1 is a real client photo', 'scene 2 is AI-generated'])
  })

  it('returns empty lists for a non-array', () => {
    expect(scenesToInput(null)).toEqual({ captions: [], notes: [] })
    expect(scenesToInput('nope')).toEqual({ captions: [], notes: [] })
  })
})

describe('maliang-render-check verdict handling', () => {
  it('writes a pass verdict into the snapshot, keeps other keys, and does not touch the job', async () => {
    const fake = makeSupabase(GOOD_ROWS)
    const check = vi.fn().mockResolvedValue(PASS_CHECK)
    const fn = createMaliangRenderCheckFunction(makeDeps(fake.client, check))
    const result = await handlerOf(fn)({
      event: { id: 'evt-pass', data: { client_id: CLIENT_ID, job_id: JOB_ID, post_id: POST_ID, output_url: OUTPUT_URL } },
      step: fakeStep().step,
    })

    expect(result).toMatchObject({ status: 'pass', source_record_id: JOB_ID, no_publish: true })

    const postUpdate = fake.updates.find((u) => u.table === 'content_posts')
    expect(postUpdate).toBeDefined()
    const snapshot = postUpdate!.patch.generation_context_snapshot as Record<string, unknown>
    expect((snapshot.maliang_check as Record<string, unknown>).status).toBe('pass')
    expect(snapshot.endcard).toBe('keep-me')

    expect(fake.updates.some((u) => u.table === 'content_factory_render_jobs')).toBe(false)
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        completed: 1,
        summary: expect.objectContaining({ no_publish: true, source_record_id: JOB_ID }),
      }),
    )
  })

  it('marks the render job needs_rework with the reason when the verdict fails', async () => {
    const fake = makeSupabase(GOOD_ROWS)
    const check = vi.fn().mockResolvedValue(FAIL_CHECK)
    const fn = createMaliangRenderCheckFunction(makeDeps(fake.client, check))
    const result = await handlerOf(fn)({
      event: { id: 'evt-fail', data: { client_id: CLIENT_ID, job_id: JOB_ID, post_id: POST_ID, output_url: OUTPUT_URL } },
      step: fakeStep().step,
    })

    expect(result).toMatchObject({ status: 'fail' })

    const jobUpdate = fake.updates.find((u) => u.table === 'content_factory_render_jobs')
    expect(jobUpdate).toBeDefined()
    expect(jobUpdate!.patch.status).toBe(NEEDS_REWORK_STATUS)
    expect(String(jobUpdate!.patch.error)).toContain('马良自检不过关')
    expect(String(jobUpdate!.patch.error)).toContain('第 3 镜文字：字幕被裁')
  })

  it('writes an unverifiable verdict, leaves the job alone, and records a failed receipt', async () => {
    const fake = makeSupabase(GOOD_ROWS)
    const check = vi.fn().mockResolvedValue(UNVERIFIABLE_CHECK)
    const fn = createMaliangRenderCheckFunction(makeDeps(fake.client, check))
    const result = await handlerOf(fn)({
      event: { id: 'evt-unver', data: { client_id: CLIENT_ID, job_id: JOB_ID, post_id: POST_ID, output_url: OUTPUT_URL } },
      step: fakeStep().step,
    })

    expect(result).toMatchObject({ status: 'unverifiable' })

    const postUpdate = fake.updates.find((u) => u.table === 'content_posts')
    expect(postUpdate).toBeDefined()
    const snapshot = postUpdate!.patch.generation_context_snapshot as Record<string, unknown>
    expect((snapshot.maliang_check as Record<string, unknown>).status).toBe('unverifiable')

    expect(fake.updates.some((u) => u.table === 'content_factory_render_jobs')).toBe(false)
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({ failed: 1, error: expect.any(String) }),
    )
  })
})
