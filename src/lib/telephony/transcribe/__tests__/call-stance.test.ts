/**
 * 客人在电话里说「现在还没准备好 / 不感兴趣」→ 通话分析记成事实 → 写到 CRM 触点上。
 * 真实案例：PM 2026-10-29 Gavin Hall，37 秒，"I'm not ready for that. I'll talk to you another day."
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeTouchpointDb } from '@/lib/crm/__tests__/fake-touchpoint-db'

const holder = vi.hoisted(() => ({ db: null as null | { from: () => unknown } }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: () => holder.db!.from() } }))

import { ANALYSIS_JSON_SCHEMA, FACT_KEYS, verifyFacts, type RawFact } from '../analysis-schema'
import { parseAnalysisJson } from '../vendors'
import { callStanceFromFacts, mirrorReviewToTouchpoints, writeCallStance } from '../call-stance'

const GAVIN = "声道1：Hi Gavin, it's Amy from the tour company, about the China tour.\n声道2：I'm not ready for that. I'll talk to you another day."
const notReady = (over: Partial<RawFact> = {}): RawFact => ({
  key: 'not_ready_now', value: '客人说现在还没准备好，改天再谈', quote: "I'm not ready for that. I'll talk to you another day.", confidence: 0.9, speaker: 'customer', ...over,
})

describe('分析：两个新的表态事实', () => {
  it('事实种类和 JSON Schema 里都有 not_ready_now / not_interested', () => {
    expect(FACT_KEYS).toContain('not_ready_now')
    expect(FACT_KEYS).toContain('not_interested')
    const keyEnum = ANALYSIS_JSON_SCHEMA.properties.facts.items.properties.key.enum
    expect(keyEnum).toContain('not_ready_now')
    expect(keyEnum).toContain('not_interested')
  })

  it('模型返回的 not_interested 事实能通过解析（不被当成不认识的种类丢掉）', () => {
    const raw = parseAnalysisJson(JSON.stringify({
      summary: '客人表示不感兴趣', language: 'en', inquiries: [],
      facts: [{ key: 'not_interested', value: '不感兴趣', quote: "I'm not interested, thanks", confidence: 0.9, speaker: 'customer' }],
    }))
    expect(raw.facts.map((f) => f.key)).toEqual(['not_interested'])
  })

  it('Gavin 的原话在转写里 → 保留', () => {
    const v = verifyFacts({ summary: '客人表示尚未准备好，改日再谈', language: 'en', facts: [notReady()] }, GAVIN)
    expect(v.facts.map((f) => f.key)).toEqual(['not_ready_now'])
  })

  it('原话在转写里找不到（模型编的）→ 丢掉', () => {
    const v = verifyFacts({ summary: '', language: 'en', facts: [notReady({ quote: 'maybe next year, call me in March' })] }, GAVIN)
    expect(v.facts).toHaveLength(0)
    expect(v.droppedFacts).toBe(1)
  })

  it('问句（员工问「还没准备好吗？」）不算表态', () => {
    const t = "声道1：Are you not ready for that yet? 声道2：Yes I am, tell me more."
    const v = verifyFacts({ summary: '', language: 'en', facts: [notReady({ quote: 'Are you not ready for that yet?', speaker: 'unclear' })] }, t)
    expect(v.facts).toHaveLength(0)
  })
})

describe('复审 2026-10-29：表态的误判口子', () => {
  const stanceOnly = (quote: string, speaker: RawFact['speaker'] = 'customer') =>
    ({ summary: '', language: 'en', facts: [notReady({ quote, speaker })] })

  it('模型把问号去掉交回来，但转写原句是问句 → 丢掉', () => {
    // 原话本身过得了「第一人称主语」那道闸，只有回到原行才看得出是问句
    const t = "声道1：So I'm not ready for that yet?\n声道2：Hmm."
    expect(verifyFacts(stanceOnly("So I'm not ready for that yet"), t).facts).toHaveLength(0)
  })

  it('中文原句以「吗 / 呢 / 么」收尾（有无标点都算）→ 问句，丢掉', () => {
    for (const line of ['我们是不是还没准备好吗', '我们还没准备好呢？', '我还没准备好么。']) {
      expect(verifyFacts(stanceOnly(line.replace(/[？。]$/, '')), `声道1：${line}`).facts).toHaveLength(0)
    }
  })

  it('员工说的「No worries if you\'re not ready yet」没有第一人称 → 不算表态', () => {
    const t = "声道1：No worries if you're not ready yet.\n声道2：OK."
    expect(verifyFacts(stanceOnly("No worries if you're not ready yet", 'customer'), t).facts).toHaveLength(0)
  })

  it('员工问「你现在还没准备好吗」→ 不算（既不是第一人称，也是问句）', () => {
    const t = '声道1：你现在还没准备好吗'
    expect(verifyFacts(stanceOnly('你现在还没准备好吗', 'customer'), t).facts).toHaveLength(0)
  })

  it("Gavin 的原话跨两行（转写按句换行）→ 仍然保留", () => {
    const t = "声道1：Hi Gavin, about the China tour.\n声道2：I'm not ready for that.\n声道2：I'll talk to you another day."
    expect(verifyFacts(stanceOnly("I'm not ready for that. I'll talk to you another day."), t).facts.map((f) => f.key)).toEqual(['not_ready_now'])
  })

  it('员工半句 + 客人半句拼起来的原话（跨声道）→ 不算', () => {
    const t = "声道1：I know I'm not ready\n声道2：for that, sorry."
    expect(verifyFacts(stanceOnly("I'm not ready for that"), t).facts).toHaveLength(0)
  })

  it('前一行是员工的问句、表态在下一行 → 不受前一行影响，保留', () => {
    const t = "声道1：Are you ready to book?\n声道2：I'm not ready for that."
    expect(verifyFacts(stanceOnly("I'm not ready for that."), t).facts).toHaveLength(1)
  })

  it('中文第一人称陈述「我们现在还没准备好，以后再说」→ 保留', () => {
    const t = '声道2：我们现在还没准备好，以后再说。'
    expect(verifyFacts(stanceOnly('我们现在还没准备好，以后再说'), t).facts).toHaveLength(1)
  })

  it('"I\'m not ready to book yet but send me the brochure" → 客人还要了资料，不记表态', () => {
    const quote = "I'm not ready to book yet but send me the brochure"
    const t = `声道2：${quote}.`
    const v = verifyFacts({ summary: '', language: 'en', facts: [
      notReady({ quote }),
      { key: 'next_step', value: '给客人发行程册', quote: 'send me the brochure', confidence: 0.9, speaker: 'customer' },
    ] }, t)
    expect(v.facts.map((f) => f.key)).toEqual(['not_ready_now', 'next_step'])
    expect(callStanceFromFacts(v.facts)).toBeNull()
  })

  it('"I am not interested in Japan, I want China." → 客人说了想去哪，不记表态', () => {
    const t = '声道2：I am not interested in Japan, I want China.'
    const v = verifyFacts({ summary: '', language: 'en', facts: [
      notReady({ key: 'not_interested', value: '对日本不感兴趣', quote: 'I am not interested in Japan' }),
      { key: 'destination_or_tour', value: '中国', quote: 'I am not interested in Japan, I want China', confidence: 0.9, speaker: 'customer' },
    ] }, t)
    expect(v.facts.map((f) => f.key)).toEqual(['not_interested', 'destination_or_tour'])
    expect(callStanceFromFacts(v.facts)).toBeNull()
  })

  it('邮箱 / 回电时间（客人或分不清谁说）也算「还要了东西」；员工介绍线路、员工说的下一步不算', () => {
    const f = (key: RawFact['key'], speaker: RawFact['speaker']): RawFact => ({ key, value: 'x', quote: 'x', confidence: 1, speaker })
    expect(callStanceFromFacts([notReady(), f('contact_email', 'customer')])).toBeNull()
    expect(callStanceFromFacts([notReady(), f('callback_time', 'unclear')])).toBeNull()
    expect(callStanceFromFacts([notReady(), f('destination_or_tour', 'employee')])).toBe('not_now')
    expect(callStanceFromFacts([notReady(), f('next_step', 'employee')])).toBe('not_now')
  })
})

describe('复审第二轮：第一人称必须是拒绝的主语', () => {
  const stanceOnly = (quote: string) => ({ summary: '', language: 'en', facts: [notReady({ quote })] })
  const keeps = (quote: string) => verifyFacts(stanceOnly(quote), `声道2：${quote}`).facts.length === 1

  it('员工的「We understand if you\'re not ready yet」→ 有 we 也不算', () => {
    expect(keeps("We understand if you're not ready yet")).toBe(false)
  })
  it('Gavin 的「I\'m not ready for that. I\'ll talk to you another day.」→ 算', () => {
    expect(keeps("I'm not ready for that. I'll talk to you another day.")).toBe(true)
  })
  it('其他客人说法：I am not interested / we are not quite ready / I\'ll think about it later / 我们现在还没准备好 / 我不感兴趣 → 算', () => {
    for (const q of ['I am not interested in that tour', 'we are not quite ready yet', "I'll think about it later", '我们现在还没准备好', '我不感兴趣']) {
      expect(keeps(q)).toBe(true)
    }
  })
  it('只是出现了 I / 我，但拒绝的主语不是他 → 不算', () => {
    for (const q of ["I hope you're not ready to give up", "I think you're not interested", "I'm sure you're not ready yet", '我觉得你们还没准备好']) {
      expect(keeps(q)).toBe(false)
    }
  })
})

describe('复审第二轮：推托不算「还要了东西」', () => {
  const GAVIN_LINE = "I'm not ready for that. I'll talk to you another day."
  const fact = (key: RawFact['key'], value: string, quote: string): RawFact => ({ key, value, quote, confidence: 0.9, speaker: 'customer' })

  it('Gavin：模型同时抽出表态和「改天再聊」这条下一步 → 仍记 not_now', () => {
    const t = `声道1：Hi Gavin, about the China tour.\n声道2：${GAVIN_LINE}`
    const v = verifyFacts({ summary: '', language: 'en', facts: [
      notReady({ quote: GAVIN_LINE }),
      fact('next_step', '改天再聊', "I'll talk to you another day"),
    ] }, t)
    expect(v.facts.map((f) => f.key)).toEqual(['not_ready_now', 'next_step'])
    expect(callStanceFromFacts(v.facts)).toBe('not_now')
  })

  it('下一步的原话就是表态那一句（没有推托字眼、也没要东西）→ 不算还要了东西', () => {
    const q = "I'm not ready for that"
    expect(callStanceFromFacts([notReady({ quote: q }), fact('next_step', '客人暂不推进', q)])).toBe('not_now')
  })

  it('下一步只是推托（以后再说 / 再联系）、原话不同句 → 仍记表态', () => {
    expect(callStanceFromFacts([notReady(), fact('next_step', '以后再说', '我们以后再说吧')])).toBe('not_now')
    expect(callStanceFromFacts([notReady(), fact('callback_time', '以后再联系', 'we will be in touch later')])).toBe('not_now')
  })

  it('真要了东西照样挡住：发资料 / email me / call me on Friday at 3', () => {
    expect(callStanceFromFacts([notReady(), fact('next_step', '发资料', 'send me the brochure')])).toBeNull()
    expect(callStanceFromFacts([notReady(), fact('next_step', '发邮件', 'just email me the details')])).toBeNull()
    expect(callStanceFromFacts([notReady(), fact('callback_time', '周五三点', 'call me on Friday at 3')])).toBeNull()
  })

  it('同一句里既推托又要资料（"I\'m not ready to book yet but send me the brochure"）→ 挡住', () => {
    const q = "I'm not ready to book yet but send me the brochure"
    expect(callStanceFromFacts([notReady({ quote: q }), fact('next_step', '发资料', q)])).toBeNull()
  })
})

describe('小尾巴：回电请求不是推托；两行表态的第二行是问句', () => {
  const fact = (key: RawFact['key'], value: string, quote: string): RawFact => ({ key, value, quote, confidence: 0.9, speaker: 'customer' })

  it('"Call me back later this afternoon" / "call me tonight" / 下午再打给我 / 晚点打给我 → 是真回电请求，挡住表态', () => {
    const cases: Array<[string, string]> = [
      ['约下午回电', 'Call me back later this afternoon'],
      ['约今晚回电', 'call me tonight'],
      ['下午再打给我', '下午再打给我'],
      ['晚点打给我', '晚点打给我'],
    ]
    for (const [value, quote] of cases) {
      expect(callStanceFromFacts([notReady(), fact('callback_time', value, quote)])).toBeNull()
      expect(callStanceFromFacts([notReady(), fact('next_step', value, quote)])).toBeNull()
    }
  })

  it("客人说「别打给我 / don't call me」是拒绝回电，不当成回电请求（仍按推托处理）", () => {
    expect(callStanceFromFacts([notReady(), fact('next_step', '以后再说', "please don't call me, maybe later")])).toBe('not_now')
    expect(callStanceFromFacts([notReady(), fact('next_step', '以后再说', '先别打给我，以后再说')])).toBe('not_now')
  })

  it('表态原话跨两行、第二行是问句 → 丢掉（不能只看第一行）', () => {
    const t = "声道1：Hi, about the China tour.\n声道2：I'm not ready for that.\n声道2：Can you call me next week?"
    const v = verifyFacts({ summary: '', language: 'en', facts: [notReady({ quote: "I'm not ready for that. Can you call me next week" })] }, t)
    expect(v.facts).toHaveLength(0)
  })

  it('同样两行，但第二行是陈述句 → 保留', () => {
    const t = "声道1：Hi, about the China tour.\n声道2：I'm not ready for that.\n声道2：I'll talk to you another day."
    const v = verifyFacts({ summary: '', language: 'en', facts: [notReady({ quote: "I'm not ready for that. I'll talk to you another day." })] }, t)
    expect(v.facts).toHaveLength(1)
  })
})

describe('长转写不能拖慢（子牙 2026-10-29 实测旧做法 1200 行约 2.7 秒）', () => {
  it('3000 行同一声道 + 编造的表态原话 → 远低于 200 毫秒', () => {
    const t = Array.from({ length: 3000 }, (_, i) => `声道1：This is sentence number ${i} about the tour.`).join('\n')
    const facts = Array.from({ length: 40 }, (_, i) => notReady({ quote: `I'm not ready for that one ${i}` }))
    const start = performance.now()
    const v = verifyFacts({ summary: '', language: 'en', facts }, t)
    const ms = performance.now() - start
    expect(v.facts).toHaveLength(0)
    expect(ms).toBeLessThan(200)
  })
})

describe('事实 → 表态', () => {
  it('客人说的 not_ready_now → not_now；not_interested 优先', () => {
    expect(callStanceFromFacts([notReady()])).toBe('not_now')
    expect(callStanceFromFacts([notReady(), notReady({ key: 'not_interested' })])).toBe('not_interested')
  })
  it('员工说的 / 分不清谁说的 / 没写说话人 → 不算', () => {
    expect(callStanceFromFacts([notReady({ speaker: 'employee' })])).toBeNull()
    expect(callStanceFromFacts([notReady({ speaker: 'unclear' })])).toBeNull()
    expect(callStanceFromFacts([notReady({ speaker: undefined })])).toBeNull()
    expect(callStanceFromFacts([])).toBeNull()
  })
})

describe('写到 CRM 触点', () => {
  let fake: ReturnType<typeof makeFakeTouchpointDb>
  const row = (metadata: Record<string, unknown>) => [{ id: 'tp-1', client_id: 'c-1', metadata }]
  const write = () => writeCallStance({ touchpointId: 'tp-1', clientId: 'c-1', analysisId: 'an-1', stance: 'not_now' })

  beforeEach(() => {
    fake = makeFakeTouchpointDb(row({ outcome: 'spoke', call_analysis_id: 'an-1', call_analysis_review: 'pending_review' }))
    holder.db = fake
  })

  it('触点挂的是这份分析 → 写上 call_stance，原有键保留', async () => {
    expect(await write()).toBe('written')
    expect(fake.rows[0].metadata).toEqual({ outcome: 'spoke', call_analysis_id: 'an-1', call_analysis_review: 'pending_review', call_stance: 'not_now' })
  })

  it('分析已被驳回 → 不写', async () => {
    fake = makeFakeTouchpointDb(row({ outcome: 'spoke', call_analysis_id: 'an-1', call_analysis_review: 'rejected' }))
    holder.db = fake
    expect(await write()).toBe('skipped')
    expect(fake.updates).toHaveLength(0)
  })

  it('触点挂的是另一份分析 → 不写', async () => {
    fake = makeFakeTouchpointDb(row({ outcome: 'spoke', call_analysis_id: 'an-OTHER' }))
    holder.db = fake
    expect(await write()).toBe('skipped')
    expect(fake.updates).toHaveLength(0)
  })

  it('写的同时有人改了触点 → 重试一次，两边的改动都在', async () => {
    fake = makeFakeTouchpointDb(row({ outcome: 'spoke', call_analysis_id: 'an-1' }), { interfere: 1 })
    holder.db = fake
    expect(await write()).toBe('written')
    expect(fake.rows[0].metadata).toMatchObject({ call_stance: 'not_now', other_writer: 1 })
  })
})

describe('人工复核状态同步到触点', () => {
  it('驳回 → 挂这份分析的触点标上 rejected；别的分析的触点不动', async () => {
    const fake = makeFakeTouchpointDb([
      { id: 'tp-1', client_id: 'c-1', metadata: { call_analysis_id: 'an-1', call_analysis_review: 'pending_review', call_stance: 'not_now' } },
      { id: 'tp-2', client_id: 'c-1', metadata: { call_analysis_id: 'an-2', call_analysis_review: 'pending_review' } },
      { id: 'tp-3', client_id: 'c-OTHER', metadata: { call_analysis_id: 'an-1', call_analysis_review: 'pending_review' } },
    ])
    holder.db = fake
    expect(await mirrorReviewToTouchpoints({ clientId: 'c-1', analysisId: 'an-1', review: 'rejected' })).toBe('ok')
    expect(fake.rows[0].metadata.call_analysis_review).toBe('rejected')
    expect(fake.rows[1].metadata.call_analysis_review).toBe('pending_review')
    expect(fake.rows[2].metadata.call_analysis_review).toBe('pending_review')
  })

  it('找触点失败 → 只记日志，不抛错（复核本身已成功）', async () => {
    holder.db = makeFakeTouchpointDb([], { failList: true })
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(mirrorReviewToTouchpoints({ clientId: 'c-1', analysisId: 'an-1', review: 'rejected' })).resolves.toBe('failed')
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('两次都被别人抢先改了 → 交回 conflict（不是悄悄当成功）', async () => {
    holder.db = makeFakeTouchpointDb(
      [{ id: 'tp-1', client_id: 'c-1', metadata: { call_analysis_id: 'an-1', call_analysis_review: 'pending_review' } }],
      { interfere: 5 },
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await mirrorReviewToTouchpoints({ clientId: 'c-1', analysisId: 'an-1', review: 'rejected' })).toBe('conflict')
    warn.mockRestore()
  })
})
