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
import {
  classifyAiNotice,
  isAutomatedPageMessage,
  lastHumanPageReplyAt,
  normaliseNoticeText,
  type ThreadMessage,
} from '../automation'

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

/**
 * Meta 系统通知的识别（classifyAiNotice / normaliseNoticeText）。
 *
 * 为什么需要它：生产数据（CTS 60 天）里 Meta 的 AI 首次回复落在客户消息后
 * 30 秒–2 分钟，正好躲过 INSTANT_REPLY_MS=30s 那条判据，227 条 AI 回复被判成真人。
 * 但 Meta 会在会话里留系统通知，标出 AI 何时接管、真人何时接回 —— 273 条通知
 * 全部落在客户消息后 8 秒内，可靠。这张表就是拿它定档。
 */
describe('classifyAiNotice / normaliseNoticeText', () => {
  it('「你的 AI 客服将会回复。」→ ai_on', () => {
    expect(classifyAiNotice('你的 AI 客服将会回复。')).toBe('ai_on')
  })

  it('「你已接管 AI 客服的这场聊天。」→ human_on', () => {
    expect(classifyAiNotice('你已接管 AI 客服的这场聊天。')).toBe('human_on')
  })

  it('「你的 AI 客服已将这个聊天转移给你。」→ human_on（带后缀也算）', () => {
    expect(classifyAiNotice('你的 AI 客服已将这个聊天转移给你。')).toBe('human_on')
    expect(
      classifyAiNotice('你的 AI 客服已将这个聊天转移给你。请训练你的 AI 客服以提升回复质量。'),
    ).toBe('human_on')
  })

  it('广告回复 / 分配对话通知 → neutral', () => {
    expect(classifyAiNotice('张三 回复了一条广告。')).toBe('neutral')
    expect(classifyAiNotice('A 把这个对话分配给了 B。')).toBe('neutral')
  })

  it('前后带零宽字符仍能识别（防编码抖动）', () => {
    expect(classifyAiNotice('\u200b你的 AI 客服将会回复。\u200b')).toBe('ai_on')
  })

  it('普通客服话 → null', () => {
    expect(classifyAiNotice('您好，行程单已发到您邮箱了')).toBeNull()
  })

  it('空字符串 / 只有空白 → null', () => {
    expect(classifyAiNotice('')).toBeNull()
    expect(classifyAiNotice('   \n\t ')).toBeNull()
  })

  it('normaliseNoticeText 去零宽 + trim', () => {
    expect(normaliseNoticeText('\u200b 你好 \ufeff')).toBe('你好')
  })
})

/**
 * 整条会话走一遍，找最后一次真人回复（lastHumanPageReplyAt）。
 *
 * 这是这次改动的核心：靠 Meta 的系统通知定「谁在回话」，而不是靠回复快慢 ——
 * 生产数据证明 AI 也会隔 60 / 120 分钟追问，「回得慢就是真人」走不通。
 */
describe('lastHumanPageReplyAt', () => {
  const T0 = Date.parse('2026-09-20T10:00:00Z')
  const at = (secs: number) => new Date(T0 + secs * 1000).toISOString()
  function msg(
    direction: 'inbound' | 'outbound',
    secs: number,
    body: string,
    over: Partial<ThreadMessage> = {},
  ): ThreadMessage {
    return { direction, sentAt: at(secs), body, tags: [], ...over }
  }

  it('客人来信 → AI 接管通知 → 50 秒后 AI 回复 → null（没有真人回过）', () => {
    const thread = [
      msg('inbound', 0, '你好，想问下价格'),
      msg('outbound', 2, '你的 AI 客服将会回复。'),
      msg('outbound', 50, '您好，我们的价格是……'),
    ]
    expect(lastHumanPageReplyAt(thread)).toBeNull()
  })

  it('AI 接管期间第 60 / 120 分钟的追问也不算真人（回得慢 ≠ 真人）', () => {
    const thread = [
      msg('inbound', 0, '你好'),
      msg('outbound', 2, '你的 AI 客服将会回复。'),
      msg('outbound', 50, '您好，有什么可以帮您？'),
      msg('outbound', 3_600, '还感兴趣吗？'),
      msg('outbound', 7_200, '需要我帮您下单吗？'),
    ]
    expect(lastHumanPageReplyAt(thread)).toBeNull()
  })

  it('「你已接管」之后 40 秒的回复算真人', () => {
    const thread = [
      msg('inbound', 0, '你好'),
      msg('outbound', 2, '你的 AI 客服将会回复。'),
      msg('outbound', 50, '您好，有什么可以帮您？'),
      msg('outbound', 60, '你已接管 AI 客服的这场聊天。'),
      msg('outbound', 100, '我是真人客服，帮您处理。'),
    ]
    expect(lastHumanPageReplyAt(thread)).toBe(at(100))
  })

  it('「转移给你」后 3 秒那条是 AI 收尾话，30 秒那条才是真人', () => {
    const thread = [
      msg('inbound', 0, '你好'),
      msg('outbound', 2, '你的 AI 客服将会回复。'),
      msg('outbound', 50, '您好，有什么可以帮您？'),
      msg('outbound', 60, '你的 AI 客服已将这个聊天转移给你。'),
      msg('outbound', 63, '还有什么可以帮您？'),
      msg('outbound', 90, '我是真人客服，帮您处理。'),
    ]
    expect(lastHumanPageReplyAt(thread)).toBe(at(90))
  })

  /**
   * 收尾话窗口**只**武装在「转移给你」上，不武装在「你已接管」上。
   *
   * 「转移给你」是 AI 把会话交出来，紧跟那条是它自己的收尾话（有实测证据：
   * 73 次里 28 次在 5 秒内，5–15 秒区间 0 条）。「你已接管」是真人主动点的按钮，
   * 他 5 秒内发出的话是他早就打好的，算他自己的。
   *
   * 这条断言是拿真实数据挣来的：把窗口也套到「你已接管」上，CTS 500 个会话里
   * 「整条没有真人回复」会从 377 变成 379 —— 多算的那 2 条正是接管后 5 秒内的
   * 真人回复。收窄之后 500 / 377 / 6 / 117 四个数字跟设计稿用 SQL 独立算的完全一致。
   */
  it('「你已接管」后 3 秒那条算真人 —— 收尾话窗口不套在这条通知上', () => {
    const thread = [
      msg('inbound', 0, '你好'),
      msg('outbound', 2, '你的 AI 客服将会回复。'),
      msg('outbound', 50, '您好，有什么可以帮您？'),
      msg('outbound', 60, '你已接管 AI 客服的这场聊天。'),
      msg('outbound', 63, '我看一下您的行程，稍等。'),
    ]
    expect(lastHumanPageReplyAt(thread)).toBe(at(63))
  })

  it('AI 恢复接管后，结果是中间那条真人回复，不是最后那条 AI 回复', () => {
    const thread = [
      msg('inbound', 0, '你好'),
      msg('outbound', 2, '你的 AI 客服将会回复。'),
      msg('outbound', 50, '您好，有什么可以帮您？'),
      msg('outbound', 60, '你已接管 AI 客服的这场聊天。'),
      msg('outbound', 100, '我是真人客服，帮您处理。'),
      msg('outbound', 200, '你的 AI 客服将会回复。'),
      msg('outbound', 250, '您好，还需要帮忙吗？'),
    ]
    expect(lastHumanPageReplyAt(thread)).toBe(at(100))
  })

  it('中性通知在 AI 接管期间：不算真人，也不解除 AI 接管', () => {
    const thread = [
      msg('inbound', 0, '你好'),
      msg('outbound', 2, '你的 AI 客服将会回复。'),
      msg('outbound', 50, '您好，有什么可以帮您？'),
      msg('outbound', 60, '张三 回复了一条广告。'),
      msg('outbound', 120, '您好，还需要帮忙吗？'),
    ]
    expect(lastHumanPageReplyAt(thread)).toBeNull()
  })

  it('sentByHumanViaMe: true 在 AI 接管期间也算真人（发送记录最硬）', () => {
    const thread = [
      msg('inbound', 0, '你好'),
      msg('outbound', 2, '你的 AI 客服将会回复。'),
      msg('outbound', 50, '您好，有什么可以帮您？'),
      msg('outbound', 60, '我是真人客服，帮您处理。', { sentByHumanViaMe: true }),
    ]
    expect(lastHumanPageReplyAt(thread)).toBe(at(60))
  })

  it('sentByHumanViaMe: false、隔 10 分钟、不在 AI 接管期间 → 走既有判据 → 真人', () => {
    const thread = [
      msg('inbound', 0, '你好'),
      msg('outbound', 600, '您好，帮您处理。', { sentByHumanViaMe: false }),
    ]
    expect(lastHumanPageReplyAt(thread)).toBe(at(600))
  })

  it('没有任何通知：客人来信 → 10 分钟后回复 → 真人（旧行为不变）', () => {
    const thread = [msg('inbound', 0, '你好'), msg('outbound', 600, '您好，帮您处理。')]
    expect(lastHumanPageReplyAt(thread)).toBe(at(600))
  })

  it('没有任何通知：客人来信 → 10 秒后回复 → 不算真人（秒回判据仍生效）', () => {
    const thread = [msg('inbound', 0, '你好'), msg('outbound', 10, '您好，帮您处理。')]
    expect(lastHumanPageReplyAt(thread)).toBeNull()
  })

  /**
   * 排序必须按**时刻**，不能按字符串（魏征复审 2026-09-26 抓到，本用例是复现）。
   *
   * `…T10:01:00Z` 和 `…T22:00:00+12:00` 是同一天的不同写法，字符串比较会把带
   * 偏移量的那条排到很后面。实测：客人 09:59Z 来信 → AI 接管通知写成 22:00+12:00
   * → AI 回复写成 10:01Z（间隔 120 秒，躲过秒回判据），字符串排序得到
   * 「来信 → AI 回复 → 通知」，那条 AI 回复于是在「还没接管」的状态下被判成真人。
   */
  it('通知带时区偏移、回复用 Z —— 仍按真实时刻排序，AI 回复不算真人', () => {
    const thread: ThreadMessage[] = [
      { direction: 'inbound', body: '你好', sentAt: '2026-09-20T09:59:00Z', tags: [] },
      { direction: 'outbound', body: '你的 AI 客服将会回复。', sentAt: '2026-09-20T22:00:00+12:00', tags: [] },
      { direction: 'outbound', body: '您好，有什么可以帮您？', sentAt: '2026-09-20T10:01:00Z', tags: [] },
    ]
    expect(lastHumanPageReplyAt(thread)).toBeNull()
  })

  it('时间解析不出来的那条排到最后，不去改变前面几条的判定', () => {
    const thread: ThreadMessage[] = [
      { direction: 'inbound', body: '你好', sentAt: '2026-09-20T09:59:00Z', tags: [] },
      { direction: 'outbound', body: '你的 AI 客服将会回复。', sentAt: '2026-09-20T10:00:00Z', tags: [] },
      { direction: 'outbound', body: '您好，有什么可以帮您？', sentAt: '2026-09-20T10:01:00Z', tags: [] },
      { direction: 'outbound', body: '这条时间是坏的', sentAt: 'not-a-date', tags: [] },
    ]
    // 坏时间那条排最后；此时 AI 仍在接管，所以它也不算真人。
    expect(lastHumanPageReplyAt(thread)).toBeNull()
  })

  it('空数组 → null', () => {
    expect(lastHumanPageReplyAt([])).toBeNull()
  })

  it('乱序传入结果一致（函数内部自己排序）', () => {
    const ordered = [
      msg('inbound', 0, '你好'),
      msg('outbound', 2, '你的 AI 客服将会回复。'),
      msg('outbound', 50, '您好，有什么可以帮您？'),
      msg('outbound', 60, '你已接管 AI 客服的这场聊天。'),
      msg('outbound', 100, '我是真人客服，帮您处理。'),
    ]
    const shuffled = [ordered[4], ordered[1], ordered[3], ordered[0], ordered[2]]
    expect(lastHumanPageReplyAt(shuffled)).toBe(lastHumanPageReplyAt(ordered))
    expect(lastHumanPageReplyAt(shuffled)).toBe(at(100))
  })
})
