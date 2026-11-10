import { describe, expect, it } from 'vitest'
import { compareStages, reviewTranscript, type ReviewLlm } from '../review'
import { parseBaozhengConfig } from '../config'
import type { ReviewStageOption } from '../prompts'

const options: ReviewStageOption[] = [
  { key: 'contacted', label: '已联系', category: 'engaged' },
  { key: 'quoted', label: '已报价', category: 'deep' },
]
const llmSaying = (text: string, cost = 0.01): ReviewLlm => async () => ({ text, cost_usd: cost })

describe('reviewTranscript', () => {
  it('unclear → null stage; reason is cut to 60 characters', async () => {
    const v = await reviewTranscript(llmSaying(`{"stage":"unclear","reason":"${'长'.repeat(80)}"}`), options, 't')
    expect(v.stage).toBeNull()
    expect(Array.from(v.reason)).toHaveLength(60)
    expect(v.invalid).toBeUndefined()
  })

  it('a stage outside the list or malformed JSON is invalid but still reports its cost', async () => {
    const a = await reviewTranscript(llmSaying('{"stage":"paid","reason":"x"}', 0.03), options, 't')
    expect(a).toMatchObject({ stage: null, costUsd: 0.03 })
    expect(a.invalid).toContain('unknown stage')
    const b = await reviewTranscript(llmSaying('no json here', 0.02), options, 't')
    expect(b).toMatchObject({ stage: null, costUsd: 0.02 })
    expect(b.invalid).toBeDefined()
  })

  it('never shows the original AI verdict to the reviewer', async () => {
    let sent = ''
    const llm: ReviewLlm = async (p) => { sent = p.systemPrompt + p.messages.map((m) => m.content).join(''); return { text: '{"stage":"quoted","reason":"x"}', cost_usd: 0 } }
    await reviewTranscript(llm, options, 'CUSTOMER: hi')
    expect(sent).not.toMatch(/original AI|AI judged|AI 判/)
  })
})

describe('compareStages', () => {
  const config = parseBaozhengConfig({ baozheng: { enabled: true, stage_categories: { contacted: 'engaged', quoted: 'deep', deferred: 'declined', not_interested: 'declined' } } })
  it('compares by category', () => {
    expect(compareStages('deferred', 'not_interested', config)).toBe('agree')
    expect(compareStages('contacted', 'quoted', config)).toBe('disagree')
    expect(compareStages('contacted', null, config)).toBe('review_unclear')
    expect(compareStages('contacted', 'mystery', config)).toBe('not_reviewed')
  })
})
