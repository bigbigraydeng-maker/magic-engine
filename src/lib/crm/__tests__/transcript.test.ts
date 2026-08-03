/**
 * 读一整通电话。
 *
 * 这一层每错一次都是真实伤害，所以测试全部对着**具体的伤**写，不是对着函数写：
 *   · 把销售的客套当成客户的拒绝 → 一个真客户被永久排除，没人会发现
 *   · 把没接通判在有对话的电话上 → 聊了十分钟的人变回「还没搭上话」
 *   · 分不清谁说的时硬猜 → 上面两种错各有一半概率
 *
 * 最后一条是这一层跟 note-parser 最大的区别：那边「宁可多报」是对的，
 * 这边不对 —— 多报和漏报都是真实损失，所以判不了就交给人。
 */

import { describe, expect, it } from 'vitest'
import {
  assignSides,
  hasSpeakerLabels,
  outcomeFromRules,
  readByRules,
  splitTurns,
} from '../transcript'

/** CTS 那个固定打电话的人。真实场景里来自客户设置。 */
const AGENT = ['大瑞']

function sided(raw: string, agents: string[] = AGENT) {
  return assignSides(splitTurns(raw), agents)
}

describe('把转写切成一句一句', () => {
  it('中文识别 App 的「说话人N」格式', () => {
    const t = splitTurns('说话人1：喂你好\n说话人2：你好，请问是张先生吗')
    expect(t).toHaveLength(2)
    expect(t[0]).toEqual({ label: '说话人1', text: '喂你好' })
  })

  it('英文 Speaker N 格式', () => {
    const t = splitTurns('Speaker 1: hello\nSpeaker 2: hi there')
    expect(t.map((x) => x.label)).toEqual(['Speaker 1', 'Speaker 2'])
  })

  it('带时间戳的格式', () => {
    const t = splitTurns('[00:12] 大瑞：你好\n[00:15] 客户：你好')
    expect(t[0]).toEqual({ label: '大瑞', text: '你好' })
  })

  /** 没有说话人标签的整段文字是常态 —— 大多数识别 App 不做说话人分离。 */
  it('完全没有标签 → 一整段，不报错', () => {
    const t = splitTurns('喂你好我是CTS的 你好 我想问一下九月那个团')
    expect(t).toHaveLength(1)
    expect(t[0].label).toBeNull()
  })

  /**
   * 正文里的冒号不能被当成说话人。
   * 「他说：我不去了」被切成一个叫「他说」的说话人，后面的归属判断就全乱了。
   */
  it('正文里的冒号不算说话人（只出现一次的标签不算）', () => {
    const raw = '客户跟我讲了一句话，他说：我再想想吧'
    expect(hasSpeakerLabels(splitTurns(raw))).toBe(false)
  })

  it('要有两个不同的说话人才算「分出了说话人」', () => {
    expect(hasSpeakerLabels(splitTurns('备注：这通电话很顺利\n备注：客户挺有兴趣'))).toBe(false)
    expect(hasSpeakerLabels(splitTurns('大瑞：你好\n客户：你好'))).toBe(true)
  })
})

describe('这句话是谁说的', () => {
  it('标签是我们自己人的名字 → 销售', () => {
    const t = sided('大瑞：你好，我是CTS的\n李太太：你好')
    expect(t[0].side).toBe('agent')
    expect(t[1].side).toBe('customer')
  })

  it('标签里带客户公司品牌词 → 销售', () => {
    const t = sided('CTS客服：你好\n王先生：你好', [])
    expect(t[0].side).toBe('agent')
    expect(t[1].side).toBe('customer')
  })

  /**
   * 这一条是整层的地基：「说话人1/2」里认不出哪个是我们自己人，
   * 就**不许**推断另一个是客户。宁可说不知道。
   */
  it('只有「说话人1/2」认不出自己人 → 全部 unknown，不猜', () => {
    const t = sided('说话人1：你好\n说话人2：你好')
    expect(t.every((x) => x.side === 'unknown')).toBe(true)
  })

  it('压根没有标签 → 全部 unknown', () => {
    expect(sided('喂你好 我想问一下').every((x) => x.side === 'unknown')).toBe(true)
  })
})

describe('「别再联系」只认客户说的话', () => {
  /** 落 DNC = 这个人从此没有任何人会碰他。必须是客户自己说的。 */
  it('客户说别再打了 → 落 DNC', () => {
    const r = readByRules(sided('大瑞：那我下周再联系您\n李太太：不用了，以后别再打了'))
    expect(r.doNotContact).toBe(true)
    expect(r.needsReview).toBeNull()
  })

  /**
   * 这是这一层存在的头号理由。
   * 销售的客套话里有一模一样的字眼，note-parser 那套规则会直接判成永久拒绝。
   */
  it('销售说「我以后别再打扰您了」→ 不落 DNC', () => {
    const r = readByRules(sided('大瑞：那我以后别再打扰您了\n李太太：好的谢谢，你们那个九月的团我再看看'))
    expect(r.doNotContact).toBe(false)
    expect(r.needsReview).toBeNull()
  })

  /** 判不了就交给人 —— 不落 DNC，也不当没发生。 */
  it('有拒绝的说法但分不清谁说的 → 不落 DNC，标出来给人看', () => {
    const r = readByRules(sided('说话人1：以后别再打了\n说话人2：好的'))
    expect(r.doNotContact).toBe(false)
    expect(r.needsReview).toContain('别再联系')
  })

  /** 收紧过的规则：临时不方便 ≠ 永久拒绝。 */
  it('客户说「今天不方便讲」→ 不是永久拒绝', () => {
    const r = readByRules(sided('大瑞：现在方便吗\n李太太：今天不太方便讲电话，改天吧'))
    expect(r.doNotContact).toBe(false)
  })

  it.each([
    ['李太太：把我从名单里删掉'],
    ['李太太：stop calling me'],
    ['李太太：please take me off your list'],
  ])('%s → 落 DNC', (line) => {
    expect(readByRules(sided(`大瑞：你好\n${line}`)).doNotContact).toBe(true)
  })
})

describe('「不买了」也只认客户说的话', () => {
  it('客户说不感兴趣 → 是', () => {
    expect(readByRules(sided('大瑞：您考虑得怎么样\n李太太：我不感兴趣')).notInterested).toBe(true)
  })

  /** 同样的字眼从销售嘴里说出来意思相反。 */
  it('销售说「如果您不感兴趣的话」→ 不是', () => {
    const r = readByRules(sided('大瑞：如果您不感兴趣的话我就不多说了\n李太太：说说看吧，什么时候出发'))
    expect(r.notInterested).toBe(false)
  })

  it('客户说已经在别家订了 → 是', () => {
    expect(readByRules(sided('大瑞：您好\n李太太：我们已经在另外一家订了')).notInterested).toBe(true)
  })
})

describe('有对话就说明电话接通了', () => {
  /**
   * 这一层**永远不会**产生「没打通」和「号码是坏的」。
   *
   * note-parser 那边读到 "voice message" 就判没打通，那是对的 —— 它读的是
   * 销售写的结论。这里读的是通话内容：销售在电话里说「我上周给您留过言」
   * 是聊天内容，不是这通电话没打通。判错了这个人就从「还没搭上话」里消失。
   */
  it('对话里提到「留言」也不会变成没打通', () => {
    const r = readByRules(sided('大瑞：我上周给您留过言，voice message 没回\n李太太：不好意思我没看到'))
    expect(outcomeFromRules(r)).not.toBe('no_answer')
    expect(outcomeFromRules(r)).toBe('spoke')
  })

  it('对话里有人说「打错了」也不会把号码判成坏号', () => {
    const r = readByRules(sided('大瑞：不好意思刚才那个分机打错了\n李太太：没事'))
    expect(outcomeFromRules(r)).not.toBe('bad_number')
  })

  it.each([
    [{ doNotContact: true, notInterested: false, callbackMentioned: false }, 'do_not_contact'],
    [{ doNotContact: false, notInterested: true, callbackMentioned: false }, 'not_interested'],
    [{ doNotContact: false, notInterested: false, callbackMentioned: true }, 'callback_set'],
    [{ doNotContact: false, notInterested: false, callbackMentioned: false }, 'spoke'],
  ])('规则 %o → %s', (r, want) => {
    expect(outcomeFromRules({ ...r, needsReview: null })).toBe(want)
  })

  /** 拒绝压过约回电：客户说「别打了，下周吧」，前半句才是结论。 */
  it('既有拒绝又提到下次 → 拒绝优先', () => {
    expect(
      outcomeFromRules({
        doNotContact: true,
        notInterested: false,
        callbackMentioned: true,
        needsReview: null,
      }),
    ).toBe('do_not_contact')
  })
})

describe('约下次谁提的都算', () => {
  it('销售提的下周三 → 算约了', () => {
    expect(readByRules(sided('大瑞：那我周三再打给您\n李太太：好')).callbackMentioned).toBe(true)
  })

  it('客户提的 → 也算', () => {
    expect(readByRules(sided('大瑞：您好\n李太太：你下周再打给我吧')).callbackMentioned).toBe(true)
  })
})
