import { describe, it, expect } from 'vitest'
import { buildProviderOutageItems } from '../manual-monitoring-items'

const NOW = new Date('2026-10-26T04:00:00Z')
const row = (provider: string, reason: string, date = '2026-10-26', detail = 'x') => ({
  provider, reason, outage_date: date, detail, first_seen_at: '', last_seen_at: '',
})

describe('备用 AI 自己断电：待办的指引不能是 OpenAI 的', () => {
  it('🔴 Claude 没钱 → 指到 Anthropic 的充值页，不能让人去 OpenAI 充值', () => {
    const items = buildProviderOutageItems({ rows: [row('anthropic', 'account_exhausted')] as never, error: null }, NOW)
    expect(items).toHaveLength(1)
    expect(items[0].href).toContain('anthropic.com')
    expect(items[0].href).not.toContain('openai')
    expect(items[0].what).toContain('Claude')
    expect(items[0].how).not.toContain('OPENAI_API_KEY')
  })

  it('🔴 Claude 钥匙不认 → 换的是 ANTHROPIC_API_KEY，不是 OPENAI_API_KEY', () => {
    const items = buildProviderOutageItems({ rows: [row('anthropic', 'credential_invalid')] as never, error: null }, NOW)
    expect(items[0].how).toContain('ANTHROPIC_API_KEY')
    expect(items[0].how).not.toContain('OPENAI_API_KEY')
    // 域名对还不够：钥匙不认要落到「钥匙页」，不是「充值页」（两个都是 anthropic.com，第一版只验了域名）
    expect(items[0].href).toContain('/keys')
    expect(items[0].href).not.toContain('/billing')
  })

  it('Claude 没钱落到充值页，不是钥匙页', () => {
    const items = buildProviderOutageItems({ rows: [row('anthropic', 'account_exhausted')] as never, error: null }, NOW)
    expect(items[0].href).toContain('/billing')
    expect(items[0].href).not.toContain('/keys')
  })

  it('DeepSeek 没钱 → 指到 DeepSeek 的充值页', () => {
    const items = buildProviderOutageItems({ rows: [row('deepseek', 'account_exhausted')] as never, error: null }, NOW)
    expect(items[0].href).toContain('deepseek.com')
    expect(items[0].what).toContain('DeepSeek')
  })

  it('备用 AI 断电的文案要说清为什么现在没症状、为什么仍要处理', () => {
    const items = buildProviderOutageItems({ rows: [row('anthropic', 'account_exhausted')] as never, error: null }, NOW)
    expect(items[0].what).toContain('没有症状')
    expect(items[0].what).toContain('没有备用可换')
  })

  it('OpenAI 的指引原样不变（回归钉）', () => {
    const items = buildProviderOutageItems({ rows: [row('openai', 'account_exhausted')] as never, error: null }, NOW)
    expect(items[0].href).toContain('platform.openai.com')
    expect(items[0].how).toContain('Add to credit balance')
  })
})

describe('降级张数并进 OpenAI 那条，不另起一条（告知不是待办）', () => {
  it('🔴 有降级卡 → 并进「该充值了」那条，并提醒重要客人多看一眼', () => {
    const items = buildProviderOutageItems({ rows: [row('openai', 'account_exhausted')] as never, error: null }, NOW, 12)
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('12 张')
    expect(items[0].what).toContain('备用 AI')
    expect(items[0].what).toContain('多看一眼')
  })

  it('没有降级卡 → 一个字都不加', () => {
    const items = buildProviderOutageItems({ rows: [row('openai', 'account_exhausted')] as never, error: null }, NOW, 0)
    expect(items[0].what).not.toContain('备用 AI')
  })

  it('默认不传也不加（旧调用方不受影响）', () => {
    const items = buildProviderOutageItems({ rows: [row('openai', 'account_exhausted')] as never, error: null }, NOW)
    expect(items[0].what).not.toContain('备用 AI')
  })

  it('🔴 降级提示只并进 OpenAI 那条，备用 AI 自己的断电不该再说「有卡是备用答的」', () => {
    const items = buildProviderOutageItems({ rows: [row('anthropic', 'account_exhausted')] as never, error: null }, NOW, 12)
    expect(items[0].what).not.toContain('12 张')
  })

  it('没有任何断电记录 → 没有待办，即使有降级卡（降级卡只是补充，不是独立告警）', () => {
    expect(buildProviderOutageItems({ rows: [], error: null }, NOW, 5)).toEqual([])
  })
})
