/**
 * Magic Engine 2.0 · Inngest 云端消费者：客户知识库萃取工作流（Issue #1645）
 *
 * 收到 `knowledge/mining.requested` 事件后，对一个客户跑一轮
 * `runKnowledgeMining()`（从 Messenger 对话里提炼知识候选，见
 * `src/lib/knowledge/mining.ts` 的完整设计说明）。
 *
 * 🔴 **一事件一主**：`knowledge/mining.requested` 是云端专属事件，本机
 *    factory-worker 不监听（见 client.ts 的 WORKER_OWNED_EVENTS，契约测试
 *    锁死）。
 *
 * 🔴 **单 step 装配**（跟 geo-remeasure.ts 的 3a 骨架同一理由）：
 *    `runKnowledgeMining()` 内部本身已经是一个幂等单元（request_id 唯一 +
 *    watermark 增量扫描），拆成多个 step 反而会在 step 边界之间引入"半截跑完
 *    又被重放"的新状态，现在没有必要——整个函数体打包进一个 step，重试整条
 *    run 时该 step 的返回值命中缓存不重跑；就算真的重跑，`runKnowledgeMining`
 *    自己的 request_id 幂等检查也会接住，不会重复扣费或重复写候选。
 *
 * 🔴 **谁来发这个事件**：本 issue 明确"不接审核页面、不接定时扫描"——发这个
 *    事件的入口（FDE 手动"重新扫描"按钮，或未来的定时任务）留给 issue #1646
 *    及后续排期，本函数只负责"收到事件后怎么跑"。
 */

import { randomUUID } from 'node:crypto'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { runKnowledgeMining, type MiningBudget, type MiningRunReceipt } from '@/lib/knowledge/mining'

export const KNOWLEDGE_MINING_REQUESTED_EVENT = 'knowledge/mining.requested'

export interface KnowledgeMiningRequestedData {
  readonly client_id: string
  readonly budget: MiningBudget
}

export type ParsedMiningRequest =
  | { readonly ok: true; readonly value: KnowledgeMiningRequestedData }
  | { readonly ok: false; readonly reason: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** payload 校验（fail-closed）。抽出来供直测——缺字段/类型不对/硬顶缺项一律拒。 */
export function parseMiningRequested(raw: unknown): ParsedMiningRequest {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'payload_not_object' }
  const d = raw as Record<string, unknown>
  if (typeof d.client_id !== 'string' || !UUID_RE.test(d.client_id)) return { ok: false, reason: 'invalid_client_id' }
  const budget = d.budget
  if (!budget || typeof budget !== 'object') return { ok: false, reason: 'missing_budget' }
  const b = budget as Record<string, unknown>
  if (typeof b.maxMessages !== 'number' || b.maxMessages <= 0) return { ok: false, reason: 'invalid_budget_maxMessages' }
  if (typeof b.maxModelCalls !== 'number' || b.maxModelCalls <= 0) return { ok: false, reason: 'invalid_budget_maxModelCalls' }
  if (typeof b.maxSpendUsd !== 'number' || b.maxSpendUsd <= 0) return { ok: false, reason: 'invalid_budget_maxSpendUsd' }
  return {
    ok: true,
    value: {
      client_id: d.client_id,
      budget: { maxMessages: b.maxMessages, maxModelCalls: b.maxModelCalls, maxSpendUsd: b.maxSpendUsd },
    },
  }
}

/** 依赖注入版：便于集成测试直接注入假 runMining。 */
export function createKnowledgeMiningRequestedFunction(deps: {
  runMining: (clientId: string, budget: MiningBudget, requestId: string) => Promise<MiningRunReceipt>
}) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}knowledge-mining-requested`,
      name: 'Client knowledge base — conversation mining',
      // 同一客户串行：防止重复投递把同一客户的萃取并发跑两份（配合
      // runKnowledgeMining 自己的 request_id 幂等检查构成双层防线）。
      concurrency: { limit: 1, key: 'event.data.client_id' },
      retries: 2,
    },
    { event: KNOWLEDGE_MINING_REQUESTED_EVENT },
    async ({ event, step }) => {
      const parsed = parseMiningRequested(event.data)
      if (!parsed.ok) return { kind: 'invalid_payload', reason: parsed.reason }
      const { client_id, budget } = parsed.value
      // event.id 是 Inngest 事件的稳定 id——同一个事件被重放/重试时值不变，
      // 天然是 runKnowledgeMining 的 request_id 幂等键；没有 event.id（本地
      // 直接触发等场景）才退化成随机值。
      const requestId = event.id ?? randomUUID()
      return await step.run(`mine-${requestId}`, async () => deps.runMining(client_id, budget, requestId))
    },
  )
}

/** 生产实例。 */
export const knowledgeMiningRequested = createKnowledgeMiningRequestedFunction({
  runMining: runKnowledgeMining,
})
