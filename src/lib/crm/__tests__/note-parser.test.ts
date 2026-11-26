/**
 * 跟进记录分类。
 *
 * 每一条用例都是 CTS 六周里的真实原话（含原始拼写错误），不是编的。
 * 重点在「别再联系」：漏判一条，下次就有人打给明确说过别打的客户 —— 那是
 * 骚扰，不是准确率问题。所以规则宁可多报，也不交给 AI 决定。
 */

import { describe, expect, it } from 'vitest'
import { classifyNote, reclassifyStoredOutcome, todayContext } from '../note-parser'

const outcome = (s: string) => classifyNote(s).outcome
const dnc = (s: string) => classifyNote(s).do_not_contact

describe('别再联系 —— 一条都不能漏', () => {
  it.each([
    '客户直接说不需要联系',
    'do not follow up',
    'do not want to talk about it',
    'indian no need follow up',
    'does not want to talk',
  ])('抓到: %s', (note) => {
    expect(dnc(note)).toBe(true)
  })

  /**
   * 2026-11-09 PM 定：只说「不要电话」的人只拦电话，邮件照常（「只别打电话」第 2 刀 2B）。
   * 这两条原来在上面那组里，是这次唯一改了预期的用例。
   */
  it.each([
    '7.14大瑞更新， 客户明确说了不要电话，只邮件联系',
    'follow up with best of china neve been to China but do not like phone call',
  ])('只别打电话，不是别再联系: %s', (note) => {
    expect(classifyNote(note)).toEqual({ outcome: 'do_not_call', do_not_contact: false })
  })

  /**
   * 🔴 **`not intending to go` 从这一组移走了**（Codex 复审 2026-08-16）。
   *
   * 它说的是「我不打算去」，不是「别再联系我」。而 `do_not_contact` 会被
   * **永久写进联系人**（任何渠道都不许再发），是全系统最重的一个标记 ——
   * 一句「not intending to go **right now**」落在这里，等于「今年先不去了」
   * 把人永久封死。
   *
   * 现在它落到「停止营销」（可逆），带时间限定时更会先被「暂时不考虑」接住。
   * 这一组只留**客户真的在划界限**的说法。
   */
  it('「不打算去」不算划界限 —— 那是没兴趣，不是别再联系我', () => {
    expect(dnc('not intending to go')).toBe(false)
  })

  it('正常的记录不会被误判成拒绝', () => {
    expect(dnc('good talk')).toBe(false)
    expect(dnc('nice talk and very keen March Best of China')).toBe(false)
    expect(dnc('follow up with Best of China itinerary')).toBe(false)
  })

  it('号码是坏的同时客户也拒绝过，两个信号都要保住', () => {
    const r = classifyNote('invalid mumber do not follow up')
    expect(r.outcome).toBe('bad_number')
    expect(r.do_not_contact).toBe(true)
  })
})

describe('没联系上 —— 占了 CTS 六周的 15%', () => {
  it.each([
    // 主流写法是 message 不是 mail —— 六周里 message 出现 82 次、mail 只有 16 次，
    // 还带各种手误。只匹配 "voice mail" 会漏掉 82 条，等于漏掉大半个漏斗损耗。
    'voice message',
    'voice messsage',
    'voice messge',
    'voice message 9 July',
    'can not leave voice message',
    'voice mail',
    'can not get through',
    'can not go through',
    'cannot reach',
    'no answer',
    'does not answer the phone',
    'home phone no answer',
    'dropped',
    'cut off',
  ])('抓到: %s', (note) => {
    expect(outcome(note)).toBe('no_answer')
  })
})

describe('号码本身是坏的', () => {
  it('认得原始数据里的拼写错误 mumber', () => {
    // Sheet1 里真的是这么拼的，出现 25 次
    expect(outcome('invalid mumber')).toBe('bad_number')
  })

  it('认得 wrong number', () => {
    expect(outcome('wrong number')).toBe('bad_number')
  })
})

describe('其余分类', () => {
  it('聊过但没兴趣', () => {
    expect(outcome('not interested (buddy gone sounds very senoir)')).toBe('not_interested')
    expect(outcome('already booked with another company')).toBe('not_interested')
    expect(outcome('all sorted')).toBe('not_interested')
  })

  it('约了下次', () => {
    expect(outcome('busy call tomorrow 2:30pm')).toBe('callback_set')
    expect(outcome('call after 9am tomorrow 7 JUL')).toBe('callback_set')
    expect(outcome('call in two weeks after back to NZ 13 July')).toBe('callback_set')
    expect(outcome('will call me back')).toBe('callback_set')
  })

  it('真的聊上了', () => {
    expect(outcome('good talk')).toBe('spoke')
    expect(outcome('great talk about 15 days tour')).toBe('spoke')
    expect(outcome('86 years old has been to china')).toBe('spoke')
  })

  it('空记录不装懂', () => {
    expect(outcome('')).toBe('unknown')
    expect(outcome('   ')).toBe('unknown')
  })
})

describe('优先级：坏号码 > 拒绝 > 没接通 > 没兴趣 > 约回电', () => {
  it('没接通的记录不会被里面的 call 字样误判成约了回电', () => {
    // "can not get through" 里没有 call，但真实数据里有混着写的
    expect(outcome('voice mail call tomorrow')).toBe('no_answer')
  })
})

/**
 * AI 层的清洗。第一轮富化 287 条真实记录时，模型交出了这些垃圾：
 * 把客户自己的品牌 CTS 和自家团名 Legacy / Panorama 当成竞品、
 * 把销售的族裔备注 "indian" 当公司、返回字符串 "null"、
 * 把备注末尾的通话日期 "9 July" 当成客户的出行时间。
 * 提示词已经改过，这里是最后一道闸 —— 提示词会漂，代码不会。
 */
import { cleanCompetitorForTest, cleanTravelWindowForTest, cleanNullishForTest } from '../note-parser'

describe('AI 输出清洗', () => {
  it('字符串 "null" 不是值', () => {
    expect(cleanNullishForTest('null')).toBeNull()
    expect(cleanNullishForTest('N/A')).toBeNull()
    expect(cleanNullishForTest('  ')).toBeNull()
    expect(cleanNullishForTest('not specified')).toBeNull()
  })

  it('客户自己的品牌和团名不是竞品', () => {
    expect(cleanCompetitorForTest('CTS')).toBeNull()
    expect(cleanCompetitorForTest('Legacy')).toBeNull()
    expect(cleanCompetitorForTest('Panorama')).toBeNull()
    expect(cleanCompetitorForTest('Best of China')).toBeNull()
  })

  it('族裔不是公司', () => {
    expect(cleanCompetitorForTest('indian')).toBeNull()
  })

  it('没名字的说法留不下情报', () => {
    expect(cleanCompetitorForTest('another company')).toBeNull()
  })

  it('真竞品留下 —— 这条是全批唯一有价值的一条', () => {
    expect(cleanCompetitorForTest('Inspiring Vacations')).toBe('Inspiring Vacations')
  })

  it('过去的年份不可能是出行时间', () => {
    const now = new Date('2026-07-26T00:00:00Z')
    expect(cleanTravelWindowForTest('2023-07-09', now)).toBeNull()
    expect(cleanTravelWindowForTest('2024 年底', now)).toBeNull()
  })

  it('未来的时间留下', () => {
    const now = new Date('2026-07-26T00:00:00Z')
    expect(cleanTravelWindowForTest('明年三月', now)).toBe('明年三月')
    expect(cleanTravelWindowForTest('2027 年三月', now)).toBe('2027 年三月')
  })
})

/**
 * 「说好周五给报价，周五名单上就有他」—— 这一段钉的是那句话的**前提**。
 *
 * PM 2026-08-15 拍板要的功能：销售在卡片上敲一行「三月两个人去南岛，周五给报价」，
 * 回车，系统自己在周五那天的名单上生成一张卡。
 *
 * 后半段（约定时间到了自动回名单）早就通了 —— `segmentContact` 的规则 3 读
 * `callbackAt`。缺的是前半段：解析器**不知道今天几号**，于是「周五」这种相对
 * 日期要么被判成 null（没排上，销售以为排上了），要么被瞎猜成某个过去的日期
 * （被 `saneCallbackInstant` 丢掉，同样没排上）。
 *
 * 而销售嘴里说出来的下一步**基本都是相对的**：「周五」「下周二」「明天上午」。
 * 几乎没人说「2026 年 8 月 21 日」。所以这一句上下文不是锦上添花，
 * 它决定这个功能成不成立。
 */
describe('告诉模型今天几号 —— 相对日期的下一步能不能排上，全看这一句', () => {
  const NOW = new Date('2026-08-15T04:00:00.000Z') // 新西兰 8/15 周六下午 4 点

  it('带上星期几 —— 「周五」要靠它才算得出来', () => {
    expect(todayContext(NOW, 'Pacific/Auckland')).toContain('Saturday')
  })

  it('带上完整日期', () => {
    const s = todayContext(NOW, 'Pacific/Auckland')
    expect(s).toContain('2026')
    expect(s).toContain('15')
  })

  /**
   * 必须按**客户所在地**报，不能按服务器。
   *
   * 服务器跑在 UTC。新西兰 8/15 下午 4 点，UTC 还是 8/15 上午 4 点 —— 这次同一天，
   * 但一天里有 12 个小时两边不同日（NZ 是 UTC+12/+13）。销售晚上 9 点记一笔
   * 「明天上午给他打」，按 UTC 算出来的「明天」是他心里的**今天**，
   * 这一笔当场就过期了。
   */
  it('按客户所在地的日子报，不按服务器', () => {
    // 新西兰已经是 8/15 周六上午，UTC 还停在 8/14 周五晚上。
    const nzMorning = new Date('2026-08-14T20:00:00.000Z')
    expect(todayContext(nzMorning, 'Pacific/Auckland')).toContain('Saturday')
    expect(todayContext(nzMorning, 'UTC')).toContain('Friday')
  })

  it('时区名原样写进去 —— 模型要靠它定「上午 9 点」是哪个 9 点', () => {
    expect(todayContext(NOW, 'Australia/Sydney')).toContain('Australia/Sydney')
  })
})

/**
 * 🔴 **「暂时不考虑」和「明确不要了」必须分开**（PM 2026-08-16 给的业务事实）。
 *
 * 「leads 沟通后会变成暂时不感兴趣、还需要继续营销的，或者明确表达不感兴趣的。」
 *
 * 分不开的代价是真实的：线上 17 个人被标成终结性的 `not_interested`，
 * 从此不出现在任何名单上、没有任何东西会把他们叫醒 —— 而按 PM 的说法，
 * 其中「明年再说」那一类才是多数。跟「号码是坏的」是同一个病：
 * **一个软信号被当成了最终结论。**
 */
describe('暂时不考虑 ≠ 明确不要了', () => {

  it.each([
    ['暂时不感兴趣'],
    ['客户说现在不考虑，明年再说'],
    ['过段时间再说'],
    ['他要再看看'],
    ['还没决定，考虑一下'],
    ['not interested right now'],
    ['thinking about it'],
    ['maybe later'],
    ['too early to book'],
    ['not ready to book yet'],
  ])('「%s」→ 暂时不考虑，继续跟', (note) => {
    expect(outcome(note)).toBe('not_interested_now')
  })

  /**
   * ⚠️ 这一条是整组的关键：「暂时不感兴趣」**里面就含着「不感兴趣」**。
   * 硬拒绝先判的话，那个「暂时」当场被吞掉，人被永久停掉。
   */
  it('「暂时」压得住「不感兴趣」—— 顺序不能反', () => {
    expect(outcome('暂时不感兴趣')).toBe('not_interested_now')
    expect(outcome('暂时不感兴趣')).not.toBe('not_interested')
  })

  it.each([
    ['客户对旅游不感兴趣'],
    ['已经在别家订了'],
    ['not interested'],
  ])('「%s」→ 明确不要了，停掉', (note) => {
    expect(outcome(note)).toBe('not_interested')
  })

  /**
   * 🔴 **时间限定词必须贴着「买不买」那件事**（Codex 复审 2026-08-16）。
   *
   * 第一版写成「只要出现『现在不』就算」，于是这些跟买卖毫无关系的日常备注
   * 全被判成「暂时不考虑」—— 人被移出真人通话名单，还收到一个
   * 「改成短期内不考虑」的阶段提议。一个只是此刻没空接电话的客人，
   * 被系统判成「这阵子别碰他」。
   */
  it.each([
    ['客户现在不方便接电话'],
    ['客户现在不在新西兰'],
    ['他现在不在办公室'],
    // 🔴 否定管不到转折后面那半句（Codex 复审 2026-08-16）：这个人
    //    **明确说想去**，只是此刻不方便 —— 判成暂时不考虑等于把他移出名单。
    ['客户目前不方便，但想去'],
    ['现在不太好联系，不过他想走三月那班'],
  ])('「%s」→ 跟买不买无关，不许判成暂时不考虑', (note) => {
    expect(outcome(note)).not.toBe('not_interested_now')
  })

  /** 🔴 跟**我们**订的是一单成交，不是「明确不要了」。 */
  it('「already booked Best of China with us」→ 不许判成不要了', () => {
    expect(outcome('already booked Best of China with us')).not.toBe('not_interested')
  })

  it('对照：在别家订的 → 照旧是明确不要了', () => {
    expect(outcome('already booked with another company')).toBe('not_interested')
  })

  /**
   * 🔴 中文同样要认（Codex 复审 2026-08-16）—— CTS 的备注绝大多数是中文，
   * 只给英文加保护等于对真实数据不生效。
   */
  it.each([
    ['客户已经跟我们订了 Best of China'],
    ['已经订了我们的团'],
  ])('「%s」→ 是成交，不许判成不要了', (note) => {
    expect(outcome(note)).not.toBe('not_interested')
  })

  it('对照：中文在别家订的 → 照旧是明确不要了', () => {
    expect(outcome('已经在别家订了')).toBe('not_interested')
  })

  /**
   * 🔴 **他现在就想买的话，前面那半句犹豫不算数** —— 一条规则覆盖一整族
   * （Codex 复审 2026-08-16）。
   *
   * 前七轮反复出现同一种形状：前半句是过去的犹豫、后半句是当下的结论，
   * 而软拒绝词命中了前半句。每次给那一条正则单独加前瞻是在按词打地鼠。
   */
  it.each([
    ['之前不考虑，但现在想去'],
    ['客户之前说考虑一下，但现在想报名'],
    ['本来还在想，决定了要订'],
    ['was thinking about it, but now ready to book'],
  ])('「%s」→ 他要买了，不许判成暂时不考虑', (note) => {
    expect(outcome(note)).not.toBe('not_interested_now')
  })

  /** ⚠️ 「想买」的判断里不许夹否定词 —— 「目前没打算去」还是软拒绝。 */
  it('对照：「目前没打算去」照旧是暂时不考虑', () => {
    expect(outcome('目前没打算去')).toBe('not_interested_now')
  })

  /**
   * 🔴 **说定了的下一次通话压过含糊的「现在还不…」** —— 同样是一次性结清一族
   * （Codex 复审 2026-08-16）。
   *
   * 「not ready to talk, call back tomorrow」「not going to talk right now,
   * call back tomorrow」—— 软拒绝词吃掉前半句，**约好的回电整个丢了**。
   */
  it.each([
    ['not ready to talk, call back tomorrow'],
    ['not ready yet, call back tomorrow'],
    ['not going to talk right now, call back tomorrow'],
    ['not ready to book, ring me next week'],
  ])('「%s」→ 约了回电', (note) => {
    expect(outcome(note)).toBe('callback_set')
  })

  /**
   * 🔴 **事实压过心情**（同一轮复审）：前半句是犹豫，后半句是这单已经没了。
   * 软的赢会让一个已经在别家下单的人继续收我们的跟进邮件。
   */
  it('「想了想，但已经在别家订了」→ 明确不要了', () => {
    expect(outcome('I was thinking about it but already booked with another company')).toBe(
      'not_interested',
    )
    expect(outcome('本来还在考虑，已经在别家订了')).toBe('not_interested')
  })

  /**
   * 🔴 **「我不打算去」不是「别再联系我」**（同一轮复审）。
   *
   * 它原先在 DNC 词表里，而 DNC 会把「任何渠道都不许再发」**永久写进联系人**
   * —— 全系统最重的一个标记。一句带时间限定的「not intending to go right now」
   * 落在那里，等于「今年先不去了」把人永久封死。
   */
  it('「not intending to go right now」→ 暂时不考虑，绝不是永久拉黑', () => {
    const r = classifyNote('not intending to go right now')
    expect(r.outcome).toBe('not_interested_now')
    expect(r.do_not_contact).toBe(false)
  })

  it('「not intending to go」（没有时间限定）→ 停止营销，仍然不是永久拉黑', () => {
    const r = classifyNote('not intending to go')
    expect(r.outcome).toBe('not_interested')
    expect(r.do_not_contact).toBe(false)
  })

  /** 对照：真的划界限的说法照旧永久拉黑。 */
  it('对照：「别再联系」照旧是永久拉黑', () => {
    expect(classifyNote('客户说别再联系了').do_not_contact).toBe(true)
  })

  /**
   * 🔴 **「暂不」自己就含着那个「不」**（Codex 复审 2026-08-16）。
   *
   * 把它当成普通时间词的话，规则会再要一个「不」，于是这两条最常见的写法整个漏掉：
   *   · 「暂不考虑」→ 退化成「聊过了」，人白白留在名单上被反复打
   *   · 「暂不感兴趣」→ 命中硬拒绝，**人被永久停掉** —— 正是本 PR 要修的那件事
   */
  /**
   * 🔴 **`ready` / `early` 必须绑住买卖或出行**（Codex 复审 2026-08-16）。
   *
   * 裸的 `not ready` 会吃掉「not ready to talk, call back tomorrow」——
   * 那明明是**约了回电**，却被判成「暂时不考虑」，回电时间也一并丢了，
   * 这个人还会收到一个「改成短期内不考虑」的提议。
   */
  /**
   * 🔴 **过去时的犹豫不算数**（Codex 复审 2026-08-16）。
   *
   * 「was thinking about it, but now ready to book」前半句是过去时、后半句才是
   * 结论。裸词会把一个**正要成交**的人判成「暂时不考虑」、移出销售名单 ——
   * 而规则结果模型覆盖不了。
   */
  it('对照：真的还在犹豫 → 照旧算暂时不考虑', () => {
    expect(outcome('still thinking about it')).toBe('not_interested_now')
    expect(outcome('thinking about it')).toBe('not_interested_now')
  })

  /**
   * 🔴 **中文的否定不止一个「不」**（Codex 复审 2026-08-16）。
   *
   * 只认「不」的话，「暂时没兴趣」会落到硬拒绝的 `/没有?兴趣/`，
   * **人被永久停掉** —— 正是本 PR 要修的那件事，而且这是最常见的写法之一。
   * 「目前没打算去」更惨：连硬拒绝都不命中，退化成「聊过了」。
   */
  it.each([
    ['暂时没兴趣'],
    ['现在没有兴趣'],
    ['目前没打算去'],
    ['客户暂时没考虑'],
  ])('「%s」→ 暂时不考虑（「没」也是否定）', (note) => {
    expect(outcome(note)).toBe('not_interested_now')
  })

  it.each([
    ['暂不考虑'],
    ['暂不感兴趣'],
    ['客户暂不打算出行'],
    ['暂时不考虑'],
  ])('「%s」→ 暂时不考虑', (note) => {
    expect(outcome(note)).toBe('not_interested_now')
  })
})

/**
 * 🔴 **存量记录读的时候要重判一次**（Codex 复审 2026-08-16）。
 *
 * 没有这一步，这次改动只对**以后**记的笔记生效：线上那些已经被标成
 * `not_interested` 的人，`segmentContact` 一看到旧值就把他们排除，
 * **永远走不到新加的「暂时不考虑」那一支**。PM 打开页面会看到「什么都没变」——
 * 而这个改动存在的全部意义就是把那批人放回来。
 */
describe('存量记录读的时候重判一次', () => {
  it('旧的「明确不要」+ 原话其实是「暂时」→ 读成暂时不考虑', () => {
    expect(reclassifyStoredOutcome('not_interested', '客户暂时不感兴趣，明年再说')).toBe(
      'not_interested_now',
    )
  })

  it('原话确实是明确不要 → 原样不动', () => {
    expect(reclassifyStoredOutcome('not_interested', '客户对旅游不感兴趣')).toBe('not_interested')
  })

  /** 🔴 只做一个方向 —— 绝不把「暂时」升级成「明确不要」，那会凭空停掉客人。 */
  it('绝不反过来：暂时不考虑不会被升级成明确不要', () => {
    expect(reclassifyStoredOutcome('not_interested_now', '客户对旅游不感兴趣')).toBe(
      'not_interested_now',
    )
  })

  it('别的结果值一概不碰', () => {
    expect(reclassifyStoredOutcome('bad_number', '暂时不考虑')).toBe('bad_number')
    expect(reclassifyStoredOutcome('spoke', '暂时不考虑')).toBe('spoke')
  })

  it('没有原话就没得重判 —— 原样返回', () => {
    expect(reclassifyStoredOutcome('not_interested', null)).toBe('not_interested')
    expect(reclassifyStoredOutcome(null, '暂时不考虑')).toBe(null)
  })
})
