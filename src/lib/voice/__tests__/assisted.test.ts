import { describe, it, expect, beforeEach } from 'vitest'
import { detectSensitive, MockTranslator } from '../assisted/translator'
import { processOperatorTurn } from '../assisted/orchestrator'
import { InMemoryVoiceStore } from '../store/memory'
import { resetVoiceConfigCache } from '../config'
import { seedDemoData, type SeedResult } from '../seed'
import type { ToolExecutionContext } from '../tools/registry'

describe('detectSensitive (魏征 #1/#5 — price/number/promise guard)', () => {
  it('flags price words (en)', () => expect(detectSensitive('', 'It costs 2890').requiresConfirm).toBe(true))
  it('flags 中文 价格意图', () => expect(detectSensitive('帮我报个价格', 'let me check').requiresConfirm).toBe(true))
  it('flags promises', () => expect(detectSensitive('', 'We guarantee delivery').requiresConfirm).toBe(true))
  it('flags numbers/amounts', () => {
    expect(detectSensitive('押金两百八', 'deposit is 280').requiresConfirm).toBe(true)
    expect(detectSensitive('', 'about NZ$2,890 per person').requiresConfirm).toBe(true)
  })
  it('does NOT flag a plain greeting', () => {
    expect(detectSensitive('你好很高兴认识你', 'Nice to meet you').requiresConfirm).toBe(false)
  })
  it('reasons are reported', () => {
    const r = detectSensitive('这个保证免费', 'This is guaranteed free')
    expect(r.reasons).toEqual(expect.arrayContaining(['promise/commitment']))
  })
})

describe('MockTranslator', () => {
  it('uses the demo phrasebook when scripted', async () => {
    const t = new MockTranslator()
    expect(await t.translate('好的，我明天让顾问联系您', 'English')).toMatch(/consultant will be in touch tomorrow/)
  })
  it('marks un-scripted lines clearly (never silently fakes English)', async () => {
    expect(await new MockTranslator().translate('随便一句话', 'English')).toMatch(/^\[EN\]/)
  })
})

describe('processOperatorTurn', () => {
  let store: InMemoryVoiceStore
  let seed: SeedResult
  let ctx: ToolExecutionContext

  beforeEach(async () => {
    process.env.MOCK_EXTERNAL_SERVICES = 'true'
    resetVoiceConfigCache()
    store = new InMemoryVoiceStore()
    seed = await seedDemoData(store)
    const cts = seed.tenants.find((t) => t.slug === 'cts-tours')!
    const tenant = (await store.getTenantById(cts.tenantId))!
    const agent = (await store.getAgentById(cts.agentId))!
    ctx = {
      store, tenant, agent,
      brain: { brandName: 'CTS', coreProposition: null, primaryAudience: null, painPoints: [], products: null, tone: null, avoidWords: [], contentPillars: null, redlinePhrases: [], country: 'NZ', city: null, source: 'tenant_settings' },
      tenantId: cts.tenantId, clientId: null, agentId: cts.agentId, callId: 'x', contactId: null, leadId: null,
      locale: 'en-NZ', timezone: 'Pacific/Auckland',
    }
  })

  it('manual mode: faithful translate, no confirm on a neutral line', async () => {
    const r = await processOperatorTurn(ctx, { text: '好的，我明天让顾问联系您', mode: 'manual' })
    expect(r.mode).toBe('manual')
    expect(r.englishToSpeak).toMatch(/consultant will be in touch tomorrow/)
    expect(r.requiresConfirm).toBe(false)
    expect(r.kbSources).toEqual([])
  })

  it('manual mode: price intent → requiresConfirm (blocks un-approved price)', async () => {
    const r = await processOperatorTurn(ctx, { text: '帮我报个价格 2890', mode: 'manual' })
    expect(r.requiresConfirm).toBe(true)
    expect(r.reasons.length).toBeGreaterThan(0)
  })

  it('mix mode: pulls KB + still guards price', async () => {
    const r = await processOperatorTurn(ctx, { text: '报个团价', mode: 'mix' })
    expect(r.mode).toBe('mix')
    expect(r.requiresConfirm).toBe(true) // price → must confirm even with KB
  })

  it('mix mode: neutral intent returns composed line', async () => {
    const r = await processOperatorTurn(ctx, { text: '介绍一下我们怎么安排行程', mode: 'mix' })
    expect(r.englishToSpeak).toBeTruthy()
    expect(r.mode).toBe('mix')
  })
})
