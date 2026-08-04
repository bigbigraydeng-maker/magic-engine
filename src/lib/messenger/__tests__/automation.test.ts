/**
 * 真人客服回复 vs Meta 自动回复(instant reply / away / Business AI)的判定。
 *
 * 钉住两条判据 + 一条安全默认:
 *   1. 结构:我们先开口(前面没有客户来信)= 自动欢迎语/广播 —— 即便 tag 看着像真人。
 *   2. tag:`source:` 命中已知自动化来源集 = 自动化。
 *   3. 其余(未知来源 / 无 tag / source:chat / FDE 经 ME 的回复)= 真人。
 *      —— 错杀真人的代价(线索多露一次面)远小于错信机器人是真人(热线索被埋)。
 */

import { describe, expect, it } from 'vitest'
import { isAutomatedPageMessage } from '../automation'

describe('isAutomatedPageMessage', () => {
  it('我们先开口(前面没有客户来信)= 自动欢迎语,即便 tag 是 source:chat', () => {
    // 真人不会(Meta 政策也不允许)先给没留过言的客户发消息 —— 结构信号压过 tag。
    expect(isAutomatedPageMessage({ tags: ['source:chat'], hasPriorInbound: false })).toBe(true)
    expect(isAutomatedPageMessage({ tags: [], hasPriorInbound: false })).toBe(true)
  })

  it('客户先留过言 + source:chat(真人在收件箱打的字)= 真人', () => {
    expect(isAutomatedPageMessage({ tags: ['inbox', 'read', 'source:chat'], hasPriorInbound: true })).toBe(false)
  })

  it('客户先留过言 + 命中自动化来源(business_ai / subscription)= 自动化', () => {
    expect(isAutomatedPageMessage({ tags: ['source:business_ai'], hasPriorInbound: true })).toBe(true)
    expect(isAutomatedPageMessage({ tags: ['inbox', 'source:subscription'], hasPriorInbound: true })).toBe(true)
  })

  it('source: 大小写不敏感', () => {
    expect(isAutomatedPageMessage({ tags: ['SOURCE:Business_AI'], hasPriorInbound: true })).toBe(true)
  })

  it('无 tag / 只有文件夹 tag(inbox,read)= 真人(没有正面自动化证据,默认真人)', () => {
    expect(isAutomatedPageMessage({ tags: [], hasPriorInbound: true })).toBe(false)
    expect(isAutomatedPageMessage({ tags: ['inbox', 'read'], hasPriorInbound: true })).toBe(false)
  })

  it('未知来源(source:mercury 等没登记的)= 真人 —— 绝不误杀真人 / FDE 回复', () => {
    // deny-list 的安全默认:只在有正面证据时才判自动化。确认到真实自动化来源值后
    // 才往 AUTOMATED_MESSAGE_SOURCES 加一行,不靠「未知即自动」乱杀。
    expect(isAutomatedPageMessage({ tags: ['source:mercury'], hasPriorInbound: true })).toBe(false)
  })
})

/**
 * 秒回 = 机器（2026-08-03 加的第 3 条判据）。
 *
 * 为什么非加不可：前两条只挡得住「我们先开口」那种开场问候。真正在漏的是另一种
 * —— **客户先说话、Meta 的 AI 客服接着回**。那时 hasPriorInbound=true、tag 又没有
 * 确认过的自动化值，于是判成真人，这个客户就从「客人在等你」里消失了，
 * 而实际上没有任何真人看过他一眼。
 *
 * 阈值 30 秒的依据（CTS 真实数据）：客户消息后 30 秒内就有回复的占比，
 * 7/20 开了 AI 之后 120/157，7/20 之前 314/345 —— 之前也这么高是因为这个主页
 * 早就挂着自动回复。两个时期都指向同一件事：秒回就是机器。
 */
describe('秒回 = 机器', () => {
  const human = { tags: ['source:chat'], hasPriorInbound: true }

  it.each([[0], [1_000], [15_000], [29_999]])('客户说完 %s 毫秒就回 → 机器', (gap) => {
    expect(isAutomatedPageMessage({ ...human, msSincePriorInbound: gap })).toBe(true)
  })

  /** 真人客服盯着收件箱时一分多钟回是正常的，那必须算真人。 */
  it.each([[30_000], [45_000], [120_000], [3_600_000]])('隔了 %s 毫秒才回 → 真人', (gap) => {
    expect(isAutomatedPageMessage({ ...human, msSincePriorInbound: gap })).toBe(false)
  })

  /**
   * 不知道间隔（老数据、回补历史）时**不用这条判据**。
   * 这是 deny-list 的原则：只在有正面证据时才判机器，不猜。
   */
  it.each([[null], [undefined]])('不知道间隔（%s）→ 不判，按默认真人走', (gap) => {
    expect(isAutomatedPageMessage({ ...human, msSincePriorInbound: gap })).toBe(false)
  })

  /** 负数只可能是数据错乱（出站时间早于它前面那条来信）—— 不拿它当证据。 */
  it('间隔是负数（时间乱了）→ 不判机器', () => {
    expect(isAutomatedPageMessage({ ...human, msSincePriorInbound: -5_000 })).toBe(false)
  })

  /** 这条是整个改动的理由：客人说话 → AI 秒回 → 他仍然在等一个真人。 */
  it('客户先说话、AI 秒回 —— 不算「我们回过了」', () => {
    expect(
      isAutomatedPageMessage({ tags: [], hasPriorInbound: true, msSincePriorInbound: 3_000 }),
    ).toBe(true)
  })

  /** 加了新判据不能把老行为改坏：真人隔了几分钟回，照旧是真人。 */
  it('真人隔几分钟回 —— 老行为不变', () => {
    expect(
      isAutomatedPageMessage({ tags: ['source:chat'], hasPriorInbound: true, msSincePriorInbound: 240_000 }),
    ).toBe(false)
  })
})
