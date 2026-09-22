/**
 * 客户知识库萃取工作流 Inngest 装配测试（issue #1645）。
 *
 * 测的是**装配 + 关键路径**，不重新验证 `runKnowledgeMining` 自己的逻辑
 * （那些在 src/lib/knowledge/__tests__/mining*.test.ts 里）：事件名/重试/
 * 并发配置对不对、payload 校验 fail-closed、event.id 是否真的当成
 * request_id 传下去（Inngest 事件重放/重试时 event.id 不变，是幂等键的
 * 唯一稳定来源）。
 *
 * 桥接 unknown：Inngest SDK 的 `createFunction()` 返回类型不对外暴露
 * `.opts`/`.fn` 这两个内部字段的公开类型，但运行时真实存在（同一读法已在
 * factory-creatomate-render.test.ts / flywheel-seo-weekly.test.ts 验证过，
 * 实测：这两个字段在当前 inngest 包版本下确实可读，测试本身跑通就是最直接
 * 的验证）。
 */
import { describe, it, expect, vi } from 'vitest'
import {
  createKnowledgeMiningRequestedFunction,
  parseMiningRequested,
  KNOWLEDGE_MINING_REQUESTED_EVENT,
} from '../knowledge-mining'
import { cloudFunctions } from '../index'
import { CLOUD_FN_PREFIX, WORKER_OWNED_EVENTS } from '../../client'

type Fn = ReturnType<typeof createKnowledgeMiningRequestedFunction>
function optsOf(fn: Fn) {
  return (fn as unknown as {
    opts: { triggers?: { event?: string }[]; retries?: number; concurrency?: { limit: number; key?: string } }
  }).opts
}
function handlerOf(fn: Fn) {
  return (fn as unknown as { fn: (args: unknown) => Promise<unknown> }).fn
}

const CLIENT_ID = '00000000-0000-4000-8000-000000000001'
const BUDGET = { maxMessages: 500, maxModelCalls: 20, maxSpendUsd: 2 }

describe('parseMiningRequested', () => {
  it('accepts a well-formed payload', () => {
    const parsed = parseMiningRequested({ client_id: CLIENT_ID, budget: BUDGET })
    expect(parsed.ok).toBe(true)
  })

  it.each([
    ['not an object', 'a string'],
    ['missing client_id', { budget: BUDGET }],
    ['invalid client_id shape', { client_id: 'not-a-uuid', budget: BUDGET }],
    ['missing budget', { client_id: CLIENT_ID }],
    ['zero maxMessages', { client_id: CLIENT_ID, budget: { ...BUDGET, maxMessages: 0 } }],
    ['negative maxModelCalls', { client_id: CLIENT_ID, budget: { ...BUDGET, maxModelCalls: -1 } }],
    ['missing maxSpendUsd', { client_id: CLIENT_ID, budget: { maxMessages: 500, maxModelCalls: 20 } }],
  ])('rejects payload: %s', (_label, payload) => {
    expect(parseMiningRequested(payload).ok).toBe(false)
  })
})

describe('knowledge-mining Inngest assembly', () => {
  it('is registered in cloudFunctions with the cloud- id prefix', () => {
    const registered = cloudFunctions.find((fn) => fn.id().includes('knowledge-mining-requested'))
    expect(registered).toBeDefined()
    expect(registered!.id().startsWith(CLOUD_FN_PREFIX)).toBe(true)
  })

  it('does not listen on a worker-owned event (one-event-one-owner contract)', () => {
    const fn = createKnowledgeMiningRequestedFunction({ runMining: vi.fn() })
    const triggerEvent = optsOf(fn).triggers?.[0]?.event
    expect(triggerEvent).toBe(KNOWLEDGE_MINING_REQUESTED_EVENT)
    expect((WORKER_OWNED_EVENTS as readonly string[]).includes(triggerEvent as string)).toBe(false)
  })

  it('is configured with per-client concurrency limit 1 and retries', () => {
    const fn = createKnowledgeMiningRequestedFunction({ runMining: vi.fn() })
    const opts = optsOf(fn)
    expect(opts.concurrency).toMatchObject({ limit: 1, key: 'event.data.client_id' })
    expect(opts.retries).toBeGreaterThan(0)
  })

  it('rejects an invalid payload without ever calling runMining', async () => {
    const runMining = vi.fn()
    const fn = createKnowledgeMiningRequestedFunction({ runMining })
    const result = await handlerOf(fn)({
      event: { id: 'evt-1', data: { client_id: 'not-a-uuid' } },
      step: { run: (_id: string, cb: () => unknown) => cb() },
    })
    expect(result).toMatchObject({ kind: 'invalid_payload' })
    expect(runMining).not.toHaveBeenCalled()
  })

  it('passes event.id through as the idempotency-stable request_id', async () => {
    const runMining = vi.fn().mockResolvedValue({ runId: 'run-1', status: 'succeeded' })
    const fn = createKnowledgeMiningRequestedFunction({ runMining })
    await handlerOf(fn)({
      event: { id: 'evt-stable-123', data: { client_id: CLIENT_ID, budget: BUDGET } },
      step: { run: (_id: string, cb: () => unknown) => cb() },
    })
    expect(runMining).toHaveBeenCalledWith(CLIENT_ID, BUDGET, 'evt-stable-123')
  })

  it('falls back to a random request_id when the event carries no id (e.g. local manual trigger)', async () => {
    const runMining = vi.fn().mockResolvedValue({ runId: 'run-1', status: 'succeeded' })
    const fn = createKnowledgeMiningRequestedFunction({ runMining })
    await handlerOf(fn)({
      event: { data: { client_id: CLIENT_ID, budget: BUDGET } },
      step: { run: (_id: string, cb: () => unknown) => cb() },
    })
    expect(runMining).toHaveBeenCalledTimes(1)
    const [, , requestId] = runMining.mock.calls[0]
    expect(typeof requestId).toBe('string')
    expect(requestId.length).toBeGreaterThan(0)
  })
})
