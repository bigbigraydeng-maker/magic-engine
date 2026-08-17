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
    '7.14大瑞更新， 客户明确说了不要电话，只邮件联系',
    '客户直接说不需要联系',
    'do not follow up',
    'do not want to talk about it',
    'indian no need follow up',
    'does not want to talk',
    'follow up with best of china neve been to China but do not like phone call',
  ])('抓到: %s', (note) => {
    expect(dnc(note)).toBe(true)
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

/**
 * 🔴 魏征 2026-08-16 直接跑 `classifyNote` 实测出来的四族，每一条都是红线。
 * 原先的下场写在各自的用例名里。
 */
describe('英文划界词表整组退回了 —— 钉住「不认」，别再加词（见 #1019）', () => {
  /**
   * 🔴 这一组曾经有六条（`do not call me again` / `stop contacting me` /
   * `take me off your list` / `unsubscribe` / `opt out` / `no further contact`），
   * 每条都补过限定、都有用例和变异验证。魏征 2026-08-17 在最新 head 上逐句实跑，
   * **六条全部还在误伤真实客人**，而且是旅游生意最日常的话。PO 的原则是
   * 「判不准的整条退回线上现有行为」—— 于是整组删除。
   *
   * **这些用例钉住的是「不认」。看到某句没被认出来想加一条正则？去 #1019。**
   * 加词能让眼前这句过，代价是下一句真实客人的话被判成永久拒联。
   */
  const NOT_DNC_ANYMORE = [
    'stop contacting me',
    'unsubscribe me',
    'take me off your list',
    'remove me from your database',
    "don't contact me again",
    'do not call me again',
    'customer wants to unsubscribe from your list',
  ]
  for (const note of NOT_DNC_ANYMORE) {
    it(`有意认不出：「${note}」（与 origin/main 一致）`, () => {
      expect(classifyNote(note).do_not_contact).toBe(false)
    })
  }

  /**
   * 换来的是这一批不再被永久封死。每一句都在删词之前实测过是 `do_not_contact`，
   * 而在 `origin/main` 上都只是普通记一笔。它们全是一家旅行社每天都在写的话。
   */
  const NO_LONGER_MISJUDGED: [string, string][] = [
    ['take me off the waiting list for the March departure', '候补位释放'],
    ['remove me from the group list, I want a private tour instead', '正在加钱升级私家团'],
    ['remove her from the rooming list, she is sharing with her husband', '排房'],
    ['take me off the passenger list for day 3', '当天不参加'],
    ['do not call me tomorrow', '改约时间'],
    ["don't email me next week", '改约时间'],
    ['do not email her again until the booking is confirmed', '带时间限定'],
    ['do not call me again until I get back from China', '带时间限定'],
    ['do not call him at work, call the home number', '给了另一个号码'],
    ['do not phone her, she is deaf, email only', '只走邮件，不是不要联系'],
    ['I never asked you to unsubscribe me', '否定隔着一个谓语'],
    ['stop contacting me for now, call me tomorrow', '暂时勿扰 + 新预约'],
  ]
  for (const [note, why] of NO_LONGER_MISJUDGED) {
    it(`不再误判成永久拒联：「${note}」（${why}）`, () => {
      expect(classifyNote(note).do_not_contact).toBe(false)
    })
  }

  /**
   * 🔴 客人回信引用了我们自己邮件的页脚 —— 全 PR 最贵的一条。
   * `mail-ingest` 存的 `raw` 是 `bodyPreview`（约 255 字），短回信完全够碰到引用块。
   * 删词之前：这句 `do_not_contact`，一个说「要订」的客人被永久封死。
   */
  it('🔴 客人回信里引到我们自己的退订页脚 → 不是拒联', () => {
    const reply =
      'Yes please book us in! On Mon 12 Aug CTS Tours wrote: Best of China 12 days from $4990pp. ' +
      'You are receiving this because you enquired. Unsubscribe from the list here.'
    expect(classifyNote(reply).do_not_contact).toBe(false)
  })

  /** main 原有的那几条照旧成立 —— 这次删的只是本 PR 新加的那一组。 */
  it('main 原有的词条一条没动', () => {
    expect(classifyNote('客户明确说了不要电话，只邮件联系').do_not_contact).toBe(true)
    expect(classifyNote('别再联系我').do_not_contact).toBe(true)
    expect(classifyNote('do not follow up').do_not_contact).toBe(true)
    expect(classifyNote('does not want to talk').do_not_contact).toBe(true)
  })
})

describe('明确说了不要，就不许再判成「约了回电」', () => {
  it('🔴「not interested, no need to call back」→ 明确不要了', () => {
    expect(classifyNote('not interested, no need to call back').outcome).toBe('not_interested')
  })

  it('软拒绝 + 约好的回电 → 照旧是约了回电（这条规矩不能被上一条弄坏）', () => {
    expect(classifyNote('not ready to talk, call back tomorrow').outcome).toBe('callback_set')
  })

  it('「暂时不感兴趣」→ 仍然是暂时不考虑，没被硬拒绝吞掉', () => {
    expect(classifyNote('客户暂时不感兴趣').outcome).toBe('not_interested_now')
  })

  /**
   * 🔴 **「不用回电」只否得掉它自己那一句**（Codex 复审 2026-08-16 / PO 2026-08-17）。
   *
   * 原先是拿整段文本判：整段里出现过一次「不用回电」，后面**所有**回电命中
   * 就全被否掉。于是一句「团队游不用回电了，私家团明天打给我」，前半句把
   * 后半句那个明确的新安排一起丢掉 —— 销售那天不会收到提醒，答应客人的事砸了。
   *
   * 改成逐个命中看它自己那一句，跟拒联侧 `matchedUnnegated` 是同一条纪律。
   */
  it('🔴 前半句「不用回电」，后半句真正的预约还要看得见', () => {
    expect(
      classifyNote(
        'No need to call back about the group tour; call me tomorrow about the private option',
      ).outcome,
    ).toBe('callback_set')
  })

  /**
   * 中文没有对应用例：`CALLBACK_PATTERNS` 里**一条中文都没有**（「明天打给我」
   * 这类靠解析器答，不靠这张表）。所以中文的回电本来就走不到这道闸，
   * 写一条中文用例只会给人「中文也覆盖了」的错觉。
   */
  it('整句只有被否定的回电 → 照旧不算约了回电', () => {
    expect(classifyNote('no need to call back').outcome).not.toBe('callback_set')
    expect(classifyNote("don't call me back").outcome).not.toBe('callback_set')
  })
})

describe('「all sorted」得分清是跟谁订的', () => {
  it('🔴「all sorted with us」→ 不许判成「他不买了」（那是一单成交）', () => {
    expect(classifyNote('all sorted with us').outcome).not.toBe('not_interested')
  })

  it('🔴「all sorted, deposit paid last week」→ 同上', () => {
    expect(classifyNote('all sorted, deposit paid last week').outcome).not.toBe('not_interested')
  })

  it('没说跟谁订的 → 照旧判「已经在别家订了」', () => {
    expect(classifyNote('all sorted, thanks anyway').outcome).toBe('not_interested')
  })
})

/**
 * 🔴 **词表改了，存量不会自己回来**（Codex 复审 2026-08-16）。
 *
 * 上面那一族划界说法在补进词表之前，原话被存成了 `spoke` / `callback_set`，
 * 镜像列也是 false。读的时候不重判的话，一个两个月前写下「stop contacting
 * me」的客人照旧在今天的名单上，还能穿过这一轮刚加的私信发送闸。
 */
/** 客人自己写的。 */
const CUSTOMER = { direction: 'inbound', source: 'ms_graph' }
/** 销售手打的那句「客户说…」—— 方向是出站，但记的是客人的话。 */
const SALES_NOTE = { direction: 'outbound', source: 'me_manual' }
/** 我们自己发出去的邮件 —— 页脚里就有 unsubscribe。 */
const OUR_EMAIL = { direction: 'outbound', source: 'ms_graph' }

describe('存量重判**不做**拒联升级 —— 钉住「退回去了」', () => {
  /**
   * 🔴 曾经这里做过「存量原话重判成拒联」。立意对（词表改了存量不会自己回来），
   * 但它是**所有误判的放大器**：判不准的词不再只影响以后写的笔记，而是每次读取
   * 时把全库存量重放成永久拒联。魏征 2026-08-17 实跑出来的代价 ——
   * 这三句命中的是 main 原有的中文词表，说的都是**第三方**，不是客人在划界限。
   */
  const THIRD_PARTY: [string, string][] = [
    ['别再联系那家酒店，已经换了', '说的是酒店'],
    ['不需要联系保险，客户自己买了', '说的是保险公司'],
    ['别再打给她老公了，打她本人', '说的是她先生，而且给了另一个人'],
  ]
  for (const [raw, why] of THIRD_PARTY) {
    it(`销售手记「${raw}」不许把这个客人封死（${why}）`, () => {
      expect(reclassifyStoredOutcome('spoke', raw, SALES_NOTE)).toBe('spoke')
      expect(reclassifyStoredOutcome('spoke', raw, CUSTOMER)).toBe('spoke')
    })
  }

  it('客人自己写的真拒联，存量也不升级 —— 这一步整个退回了（见 #1019）', () => {
    expect(reclassifyStoredOutcome('spoke', '别再联系我', CUSTOMER)).toBe('spoke')
  })

  it('原话没说过划界的，原样返回', () => {
    expect(reclassifyStoredOutcome('spoke', '聊得不错，下周发行程', CUSTOMER)).toBe('spoke')
  })

  it('原有的「明确不要 → 暂时不考虑」那条照旧', () => {
    expect(reclassifyStoredOutcome('not_interested', '客户暂时不感兴趣')).toBe('not_interested_now')
  })
})

/**
 * 🔴 这两条都是补词表那一轮**自己造出来的误伤**（Codex 复审 2026-08-16 实测）。
 * 一家旅游公司的备注里，「take me from A to B」是最正常不过的接送需求。
 */

describe('句子别处的拒绝词，不许否掉一个明确的新回电安排', () => {
  it('🔴「不要团队游，回电聊私家团」→ 约了回电（原先判成明确不要了、人退出名单）', () => {
    expect(
      classifyNote('not interested in the group tour, call me back about a private option').outcome,
    ).toBe('callback_set')
  })

  it('回电本身被否定 → 才不算约了回电', () => {
    expect(classifyNote('not interested, no need to call back').outcome).toBe('not_interested')
    expect(classifyNote('do not call me back').outcome).not.toBe('callback_set')
  })

  it('软拒绝 + 明确回电 → 照旧是约了回电', () => {
    expect(classifyNote('not ready to talk, call back tomorrow').outcome).toBe('callback_set')
  })
})

/**
 * 🔴 **不看「谁写的」就会把我们自己的话当成客人的**（Codex 复审 2026-08-16）。
 *
 * `mail-ingest` 把**出站**邮件也原样存进 `raw`，而我们群发的页脚里写着
 * 「click here to unsubscribe」。读的时候重判会把这句合规文案当成客人要求
 * 退订，于是今日名单、群发、私信发送闸一起把他永久挡住 —— 一个从没说过
 * 任何话的客人，被我们自己的邮件模板拉黑。
 */

/**
 * 🔴 「opt out」在旅游备注里最常见的意思是**不参加某个自费项目**
 * （Codex 复审 2026-08-16），跟「别再联系我」毫无关系。
 */

/**
 * 🔴 「no further contact」在销售手记里最常见的意思是**陈述现状**
 * （Codex 复审 2026-08-16）：报价后还没再联系上、没留更多联系方式。
 * 而手工触点的 source 是 me_manual —— 会被存量重判当成客人意愿。
 */

/**
 * 🔴 **拒联的两条统一否决条件**（PM 限定任务 R1，2026-08-16）。
 *
 * 前几轮每加一个拒联词，就要再往那个词上补一层「除非前面有 did not」
 * 「除非后面跟着 now」—— 补一处漏一处（`I don't want to unsubscribe`
 * 就从 `did/do/does not` 那个断言底下钻了过去）。
 *
 * 这两件事跟具体哪个词无关，是语义层面的，所以判在**命中词所在那一句**上，
 * 一次覆盖整张词表：被否定的不算，只是暂时的也不算。
 */
describe('别再联系：被否定的不算', () => {
  it('🔴「客户没有要求别再联系」→ 不是拒联', () => {
    expect(classifyNote('客户没有要求别再联系').do_not_contact).toBe(false)
  })

  it('🔴「客户没有说不要打电话」→ 不是拒联', () => {
    expect(classifyNote('客户没有说不要打电话').do_not_contact).toBe(false)
  })

  /**
   * 🔴 否定只看**同一句**。前一句的否定不能把后一句真正的拒联否掉 ——
   * 那正是这个人明确说出来的话。
   */
  it('🔴 前一句的否定不算：「客户不感兴趣，别再联系我」仍是拒联', () => {
    expect(classifyNote('客户不感兴趣，别再联系我').do_not_contact).toBe(true)
  })
})

describe('别再联系：只是这一阵别打，不是永久', () => {
  it('🔴 中文：「现在别再打电话给他」→ 不是永久拒联', () => {
    expect(classifyNote('客户说现在别再打电话给他').do_not_contact).toBe(false)
  })

  it('没有时间限定 → 照旧是拒联', () => {
    expect(classifyNote('别再联系我').do_not_contact).toBe(true)
    expect(classifyNote('客户直接说不需要联系').do_not_contact).toBe(true)
    expect(classifyNote('do not follow up').do_not_contact).toBe(true)
  })
})

/**
 * 🔴 本文件里有几处 `\b` 曾被写成**退格符**（0x08），那几条正则从来没生效过。
 * 修好之后 `POSITIVE_INTENT_NOW` 复活，随即暴露出它自己的洞：裸的
 * `ready to book` 会把「**not** ready to book yet」判成「他现在就想订」。
 * 同一条否定判据兜住 —— 这就是「统一语义」该起的作用。
 */
describe('「他现在就想订」同样怕被否定', () => {
  it('🔴「not ready to book yet」→ 暂时不考虑，不是想订了', () => {
    expect(classifyNote('not ready to book yet').outcome).toBe('not_interested_now')
  })

  it('「now ready to book」→ 他现在就想订', () => {
    expect(classifyNote('now ready to book').outcome).toBe('spoke')
  })
})

/**
 * 🔴 **同一条词表要走完所有命中**（Codex 复审 2026-08-16，R2）。
 *
 * 只看第一次命中的话，第一次被否掉就直接换下一条正则 —— 后面那句真正的
 * 拒联根本没被看到。前半句是幌子，后半句才是他的结论。
 */
describe('前半句被否掉，后半句真正的拒联还要看得见', () => {
  /**
   * 🔴 同一条正则要走完**所有**命中。只看第一次命中的话，第一次被否掉就直接
   * 换下一条正则 —— 后面那句真正的拒联根本没被看到。前半句是幌子，
   * 后半句才是他的结论。
   */
  it('🔴「客户没有要求别再联系，实际上他明确说了别再联系我」→ 是拒联', () => {
    expect(
      classifyNote('客户没有要求别再联系，实际上他明确说了别再联系我').do_not_contact,
    ).toBe(true)
  })
})

/**
 * 🔴 **否定 / 时间词必须真的修饰那句拒联**（Codex 复审 2026-08-16，R2）。
 *
 * 「同一句里出现过」就算数是不行的 —— 会误伤两种再正常不过的写法，
 * 而且方向最危险：明确要求退订的人被判成可以继续联系。
 */
describe('否定和时间词要真的修饰那句拒联', () => {
  /**
   * 🔴 「同一句里出现过」就算数是不行的 —— 会误伤再正常不过的写法，
   * 而且方向最危险：明确划了界限的人被判成可以继续联系。所以看**距离**。
   */
  it('🔴 否定隔着一整个谓语 → 管不到后面那句：「客户不感兴趣但是明确要求别再联系」', () => {
    expect(classifyNote('客户不感兴趣但是明确要求别再联系').do_not_contact).toBe(true)
  })

  it('否定紧贴着才算：「客户没有说不要打电话」仍不是拒联', () => {
    expect(classifyNote('客户没有说不要打电话').do_not_contact).toBe(false)
  })

  it('时间词紧贴在前面才算：「现在别再打电话」不是永久拒联', () => {
    expect(classifyNote('客户说现在别再打电话给他').do_not_contact).toBe(false)
  })

  it('时间词落在别处不算暂时：「客户今天明确要求别再联系」仍是拒联', () => {
    expect(classifyNote('客户今天明确要求别再联系').do_not_contact).toBe(true)
  })
})
