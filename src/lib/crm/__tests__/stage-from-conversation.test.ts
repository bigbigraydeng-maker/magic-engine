/**
 * 从已有的邮件 / 私信里读「跟进到哪一步」—— 判断部分。
 *
 * 这套东西一旦上线，会去动 556 个人的档案。所以每一道闸都得钉死：
 * 编出来的证据、模型自作主张下终结判决、客户没配的阶段 —— 三样里任何一样
 * 漏过去，都是直接落在客户数据上的伤害。
 */

import { describe, expect, it } from 'vitest'
import {
  NO_VERDICT,
  SAFE_STAGES,
  hasHumanOutbound,
  quoteIsGrounded,
  renderTranscript,
  ruleOnlyStage,
  usableStage,
  worthReading,
  type StageVerdict,
  type TranscriptLine,
} from '../stage-from-conversation'

const CONFIGURED = new Set([
  'new',
  'contacted',
  'quoted',
  'deposit_paid',
  'paid_full',
  'no_response',
  'deferred',
  'not_interested',
  'traveling_soon',
])

const line = (over: Partial<TranscriptLine> = {}): TranscriptLine => ({
  at: '2026-07-01T00:00:00Z',
  direction: 'inbound',
  body: 'Could you send me the October itinerary please?',
  channel: 'email',
  ...over,
})

const verdict = (over: Partial<StageVerdict> = {}): StageVerdict => ({
  stage: 'quoted',
  evidence: 'Could you send me the October itinerary please?',
  reason: '客户主动要行程，我们已经报过价',
  ...over,
})

describe('拼对话', () => {
  it('从旧到新 —— 顺序反了就看不出「先犹豫、后来又问价」', () => {
    const out = renderTranscript([
      line({ at: '2026-07-05T00:00:00Z', body: 'Second thing' }),
      line({ at: '2026-07-01T00:00:00Z', body: 'First thing' }),
    ])
    expect(out.indexOf('First thing')).toBeLessThan(out.indexOf('Second thing'))
  })

  it('客人和我们分得开 —— 分不开就会把我们报的价当成他的预算', () => {
    const out = renderTranscript([
      line({ direction: 'inbound', body: 'What does it cost?' }),
      line({ direction: 'outbound', body: 'From NZD $3,880pp' }),
    ])
    expect(out).toContain('CUSTOMER (email): What does it cost?')
    expect(out).toContain('CTS (email): From NZD $3,880pp')
  })

  it('超长时留最近的，砍最老的 —— 砍反了正好砍掉我们要的答案', () => {
    const old = Array.from({ length: 40 }, (_, i) =>
      line({ at: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`, body: 'x'.repeat(600) }),
    )
    const out = renderTranscript([...old, line({ at: '2026-08-01T00:00:00Z', body: 'BOOKED FOR OCTOBER' })])
    expect(out).toContain('BOOKED FOR OCTOBER')
    expect(out.length).toBeLessThanOrEqual(12_100)
  })

  it('空消息（图片 / 附件 / 系统事件）不占位置', () => {
    expect(renderTranscript([line({ body: '   ' })])).toBe('')
  })
})

describe('值不值得花一次模型调用', () => {
  it('对方回过话 → 值得', () => {
    expect(worthReading([line({ direction: 'inbound' })])).toBe(true)
  })

  it('只有我们单方面发过 → 不值得，那是「无下文」，规则自己就能定', () => {
    expect(worthReading([line({ direction: 'outbound' }), line({ direction: 'outbound' })])).toBe(false)
  })
})

describe('证据必须真的在原文里 —— 铁律 8', () => {
  const transcript = renderTranscript([line({ body: 'We are thinking about next April maybe' })])

  it('逐字对得上 → 认', () => {
    expect(quoteIsGrounded('We are thinking about next April maybe', transcript)).toBe(true)
  })

  it('大小写 / 空格差异不算编的', () => {
    expect(quoteIsGrounded('  we are   THINKING about next april maybe ', transcript)).toBe(true)
  })

  it('原文里没有这句 → 不认，这是模型编的', () => {
    expect(quoteIsGrounded('He said he wants to book the October tour', transcript)).toBe(false)
  })

  it('太短的证据一律不认 —— 一个 ok 在哪段对话里都找得到', () => {
    expect(quoteIsGrounded('ok', transcript)).toBe(false)
    expect(quoteIsGrounded('April', transcript)).toBe(false)
  })
})

describe('哪些判断能真的落到客户档案上', () => {
  const transcript = renderTranscript([line()])

  it('证据对得上、阶段合法 → 用', () => {
    expect(usableStage(verdict(), transcript, CONFIGURED)).toBe('quoted')
  })

  it('模型说读不出来 → 继续空着', () => {
    expect(usableStage(verdict({ stage: NO_VERDICT }), transcript, CONFIGURED)).toBeNull()
  })

  it('🔴 证据是编的 → 整条丢掉，哪怕阶段看着很合理', () => {
    const v = verdict({ evidence: 'I would like to pay the deposit today please' })
    expect(usableStage(v, transcript, CONFIGURED)).toBeNull()
  })

  it('🔴 终结档不接 —— 落进「不感兴趣」这个人就从所有名单上消失了', () => {
    const v = { ...verdict(), stage: 'not_interested' } as unknown as StageVerdict
    expect(usableStage(v, transcript, CONFIGURED)).toBeNull()
  })

  it('🔴 涉及钱的档不接 —— 一句「明天转账」不等于钱到账', () => {
    for (const paid of ['deposit_paid', 'paid_full']) {
      const v = { ...verdict(), stage: paid } as unknown as StageVerdict
      expect(usableStage(v, transcript, CONFIGURED)).toBeNull()
    }
  })

  it('客户没配这一档 → 不写，否则界面上会冒出一个认不出的阶段', () => {
    expect(usableStage(verdict(), transcript, new Set(['new', 'contacted']))).toBeNull()
  })

  it('白名单里全是「还会继续跟」的档 —— 谁往里加终结档，这条会拦住他', () => {
    expect([...SAFE_STAGES]).toEqual(['contacted', 'quoted', 'deferred', 'no_response', 'traveling_soon'])
  })
})

/**
 * 「无下文」是唯一一档不用问模型就定得下来的：客人一个字都没说过，没有任何
 * 可误读的语义。但判据必须窄 —— 昨天刚发的邮件不叫无下文。
 */
describe('不问模型就定得下来的那一档', () => {
  const out = (at: string) => line({ direction: 'outbound', body: 'Following up', at })
  const NOW = new Date('2026-08-16T00:00:00Z')

  it('我们发过、两周多没回 → 无下文', () => {
    expect(ruleOnlyStage([out('2026-07-01T00:00:00Z')], NOW)).toBe('no_response')
  })

  it('昨天才发的 → 不判，人家可能今天就回', () => {
    expect(ruleOnlyStage([out('2026-08-15T00:00:00Z')], NOW)).toBeNull()
  })

  it('🔴 对方回过话 → 不归规则管，交给模型', () => {
    expect(ruleOnlyStage([out('2026-07-01T00:00:00Z'), line()], NOW)).toBeNull()
  })

  it('我们也没发过 → 不判，那不叫无下文', () => {
    expect(ruleOnlyStage([], NOW)).toBeNull()
  })
})

/**
 * 🔴 **填表不是「他回话了」**。FB 客资表单 / 官网表单在触点表里也是 `inbound`
 * —— 那是他留下线索的那一刻，不是一次往来。表单内容仍然进对话（团意向、
 * 出行时间都在里面），只是不算他说过话。
 */
describe('表单不算回话', () => {
  const formLine = line({ channel: 'meta_lead_form', body: 'Best of China' })
  const NOW = new Date('2026-08-16T00:00:00Z')

  it('只有表单 + 我们追过 → 不值得问模型', () => {
    expect(worthReading([formLine, line({ direction: 'outbound', body: 'Following up' })])).toBe(false)
  })

  it('只有表单 + 我们两周前追过 → 规则判「无下文」', () => {
    const lines = [formLine, line({ direction: 'outbound', body: 'Following up', at: '2026-07-01T00:00:00Z' })]
    expect(ruleOnlyStage(lines, NOW)).toBe('no_response')
  })

  it('表单之外他真的说过话 → 照旧交给模型', () => {
    expect(worthReading([formLine, line({ channel: 'email' })])).toBe(true)
  })

  it('表单内容还是要进对话 —— 团意向和出行时间都在里面', () => {
    expect(renderTranscript([formLine])).toContain('Best of China')
  })
})

/**
 * 🔴 **他又填了一次表 = 他又来了**（Codex 复审 2026-08-16）。
 * 一份比我们最后一次联系还新的表单，是这个人今天又主动留了资料。
 * 照旧写「无下文」等于把一个刚刚举手的活客人标成没反应的。
 */
describe('新填的表单挡住「无下文」', () => {
  const NOW = new Date('2026-08-16T00:00:00Z')
  const out = (at: string) => line({ direction: 'outbound', body: 'Following up', at })
  const form = (at: string) => line({ channel: 'meta_lead_form', body: 'Best of China', at })

  it('表单比我们最后一次联系还新 → 不判，交给模型读', () => {
    expect(ruleOnlyStage([out('2026-07-01T00:00:00Z'), form('2026-08-14T00:00:00Z')], NOW)).toBeNull()
  })

  it('表单是当初留资那次（早于我们联系）→ 照旧判「无下文」', () => {
    expect(ruleOnlyStage([form('2026-06-01T00:00:00Z'), out('2026-07-01T00:00:00Z')], NOW)).toBe(
      'no_response',
    )
  })
})


describe('表单回声不算客人开口 / 已联系必须有真人联系记录（2026-11-03）', () => {
  const NOW = new Date('2026-08-16T00:00:00Z')
  const echo = (at: string): TranscriptLine => ({
    at,
    direction: 'inbound',
    channel: 'message',
    body: 'Hello! I filled out your form and would like to know more about your business. Email: a@b.c',
  })
  const botGreeting = (at: string): TranscriptLine => ({
    at,
    direction: 'outbound',
    channel: 'message',
    body: 'Hi there! Thank you for contacting us. Which tour are you interested in?',
  })

  it('私信通道里的表单回声不值得读（不算客人说话）', () => {
    expect(worthReading([echo('2026-09-19T11:13:47Z')])).toBe(false)
    expect(worthReading([echo('2026-09-19T11:13:47Z'), botGreeting('2026-09-19T11:13:50Z')])).toBe(false)
  })

  it('客人真的开口了仍然值得读', () => {
    expect(worthReading([echo('2026-09-19T11:13:47Z'), line({ at: '2026-09-21T03:40:10Z' })])).toBe(true)
  })

  it('表单回声比我们最后一次联系还新 = 他又来了，不判无下文', () => {
    const lines = [
      line({ direction: 'outbound', at: '2026-07-01T00:00:00Z', body: 'Following up' }),
      echo('2026-08-20T00:00:00Z'),
    ]
    expect(ruleOnlyStage(lines, NOW)).toBeNull()
  })

  it('只有客人的表单回声 + 两分钟内的自动回复 = 没有真人联系', () => {
    expect(hasHumanOutbound([echo('2026-09-19T11:13:47Z'), botGreeting('2026-09-19T11:13:50Z')])).toBe(false)
  })

  it('私信里隔了很久才发的回复算真人', () => {
    expect(hasHumanOutbound([echo('2026-09-19T11:13:47Z'), botGreeting('2026-09-20T01:00:00Z')])).toBe(true)
  })

  it('真人电话 / 邮件触点算真人，哪怕时间戳和表单是同一秒（导入线索的那一刻）', () => {
    const call: TranscriptLine = {
      at: '2026-09-19T11:13:27Z',
      direction: 'outbound',
      channel: 'phone',
      body: 'Called, left details',
    }
    expect(hasHumanOutbound([call, echo('2026-09-19T11:13:27Z')])).toBe(true)
  })

  it('写入方标了 automated 的出站不算真人', () => {
    const mail: TranscriptLine = {
      at: '2026-09-19T20:00:00Z',
      direction: 'outbound',
      channel: 'email',
      body: 'Welcome',
      automated: true,
    }
    expect(hasHumanOutbound([mail])).toBe(false)
  })

  it('空对话没有真人联系', () => {
    expect(hasHumanOutbound([])).toBe(false)
  })
})
