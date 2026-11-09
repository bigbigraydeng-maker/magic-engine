/**
 * 专家学习运行编排测试：全部用注入替身，不联网、不写库。
 * 示例专家 / 示例文章，不含任何客户数据。
 */
import { describe, it, expect, vi } from 'vitest'
import { createFakeLedger } from '@/lib/agent-learning/budget/fake-ledger'
import { DEEPSEEK_FLASH_PRICE } from '@/lib/agent-learning/llm/deepseek-client'
import { EXPERT_ROSTER, suggestedValidUntil } from '@/lib/agent-learning/expert-roster'
import { runExpertLearning, type ExpertRunDeps } from '@/lib/agent-learning/run-expert-learning'

const BODY = 'Consolidating ad sets helped delivery. '.repeat(20)

function feedXml(n: number, tag: string): string {
  const items = Array.from(
    { length: n },
    (_, i) =>
      `<item><title>Post ${tag}${i}</title><link>https://example.com/${tag}/${i}</link>` +
      `<pubDate>Mon, 20 Oct 2026 00:00:00 GMT</pubDate><description>${BODY} ${tag}${i}</description></item>`,
  ).join('')
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items}</channel></rss>`
}

const LLM_JSON = JSON.stringify({
  rules: [
    {
      rule: 'Consolidate ad sets when delivery fragments.',
      rationale: 'Fewer sets learn faster.',
      quote: 'helped delivery',
      authorClaims: [],
    },
  ],
})

function makeDeps(over: Partial<ExpertRunDeps> = {}) {
  const writeLesson = vi.fn(async (i: { lessonKey: string }) => ({ ok: true as const, lessonKey: i.lessonKey }))
  const completeJson = vi.fn(async () => ({
    ok: true as const,
    value: { text: LLM_JSON, inputTokens: 2000, outputTokens: 100, model: 'fake' },
  }))
  const deps: ExpertRunDeps = {
    fetchText: async (url) => ({ ok: true, text: feedXml(2, String(url.length)) }),
    llm: { price: DEEPSEEK_FLASH_PRICE, completeJson },
    ledger: createFakeLedger(),
    now: () => new Date('2026-10-26T00:00:00.000Z'),
    existingKeys: async () => [],
    checkShareable: async () => ({ shareable: true, findings: [], summary: 'ok' }),
    writeLesson,
    ...over,
  }
  return { deps, writeLesson, completeJson }
}

describe('runExpertLearning', () => {
  it('dryRun 不写库，但返回候选', async () => {
    const { deps, writeLesson } = makeDeps()
    const s = await runExpertLearning(deps, { dryRun: true, perSource: 2 })
    expect(writeLesson).not.toHaveBeenCalled()
    expect(s.candidates.length).toBeGreaterThan(0)
    expect(s.candidates.every((c) => c.outcome === 'would_write')).toBe(true)
  })

  it('真写时只写 isActive:false，来源信息进 evidence', async () => {
    const { deps, writeLesson } = makeDeps()
    const s = await runExpertLearning(deps, { dryRun: false, perSource: 1 })
    expect(writeLesson).toHaveBeenCalled()
    const input = writeLesson.mock.calls[0][0] as unknown as {
      isActive: boolean
      evidence: Record<string, unknown>
    }
    expect(input.isActive).toBe(false)
    expect(input.evidence).toMatchObject({
      expert: expect.any(String),
      url: expect.any(String),
      quote: expect.any(String),
      suggestedValidUntil: expect.any(String),
    })
    expect(s.candidates.every((c) => c.outcome === 'written')).toBe(true)
  })

  it('已存在的 key 跳过，不写', async () => {
    const first = makeDeps()
    const s1 = await runExpertLearning(first.deps, { dryRun: true, perSource: 1 })
    const keys = s1.candidates.map((c) => c.lessonKey)
    const { deps, writeLesson } = makeDeps({ existingKeys: async () => keys })
    const s = await runExpertLearning(deps, { dryRun: false, perSource: 1 })
    expect(writeLesson).not.toHaveBeenCalled()
    expect(s.candidates.every((c) => c.outcome === 'exists_skipped')).toBe(true)
  })

  it('脱敏不过的不写', async () => {
    const { deps, writeLesson } = makeDeps({
      checkShareable: async () => ({ shareable: false, findings: [], summary: 'leak' }),
    })
    const s = await runExpertLearning(deps, { dryRun: false, perSource: 1 })
    expect(writeLesson).not.toHaveBeenCalled()
    expect(s.candidates.every((c) => c.outcome === 'not_shareable')).toBe(true)
  })

  it('来源抓取失败只记下，不影响其它来源', async () => {
    const { deps } = makeDeps({
      fetchText: async (url) =>
        url === EXPERT_ROSTER[0].feedUrl
          ? { ok: false, error: 'http_500' }
          : { ok: true, text: feedXml(1, String(url.length)) },
    })
    const s = await runExpertLearning(deps, { dryRun: true, perSource: 1 })
    expect(s.sources[0].error).toContain('http_500')
    expect(s.candidates.length).toBeGreaterThan(0)
  })

  it('额度不够时一次都不外呼', async () => {
    const completeJson = vi.fn()
    const { deps } = makeDeps({
      llm: {
        price: { ...DEEPSEEK_FLASH_PRICE, inputPerMTokUsd: 1000, outputPerMTokUsd: 1000 },
        completeJson,
      },
    })
    const s = await runExpertLearning(deps, { dryRun: true, perSource: 3 })
    expect(completeJson).not.toHaveBeenCalled()
    expect(s.candidates).toHaveLength(0)
    expect(s.itemsFailed).toBe(1)
  })

  it('同一正文跨来源只蒸馏一次', async () => {
    const { deps, completeJson } = makeDeps({ fetchText: async () => ({ ok: true, text: feedXml(1, 'same') }) })
    await runExpertLearning(deps, { dryRun: true, perSource: 1 })
    expect(completeJson).toHaveBeenCalledTimes(1)
  })
})

describe('suggestedValidUntil', () => {
  const now = new Date('2026-10-26T00:00:00.000Z')
  it('按领域天数从发布日起算', () => {
    expect(suggestedValidUntil('seo', '2026-01-01T00:00:00.000Z', now)).toBe('2026-06-30T00:00:00.000Z')
    expect(suggestedValidUntil('paid_social', '2026-01-01T00:00:00.000Z', now)).toBe('2026-04-01T00:00:00.000Z')
  })
  it('发布日缺失从 now 起算', () => {
    expect(suggestedValidUntil('sem', null, now)).toBe('2027-02-23T00:00:00.000Z')
  })
})
