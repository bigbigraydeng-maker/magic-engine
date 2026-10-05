/**
 * 「谁改的阶段」翻成人话。
 *
 * 🔴 钉死的是**员工不该看到内部字符串**：`ai:conversation-read` 这串东西现在
 * 就在「今天要联系」页上原样显示给 CTS 的销售看（`changedByLabel` 只翻译了
 * 另一个机器身份，其余一律 `raw.split('@')[0]`，而这串里没有 `@`，于是原样输出）。
 *
 * 取值清单来自 2026-09-27 查生产库的真实分布，不是想象的：
 *   971 次 ai:conversation-read · 26 次 system:qualified-buyer · 18 次 system
 *   · 12 次 info@ctstours.co.nz（真人）
 */

import { describe, expect, it } from 'vitest'
import {
  describeStageActor,
  isAutomatedActor,
  stageChangeWasAutomated,
  STAGE_INFER_ACTOR,
  AUTOMATED_SENDER_EMAILS,
  stageReasonForDisplay,
} from '../actors'
import { AUTO_TAG_ACTOR } from '../qualified-buyer'

describe('describeStageActor —— 生产上真实出现过的四类', () => {
  it('971 次的那个：AI 读往来记录判的', () => {
    expect(describeStageActor('ai:conversation-read')).toBe('系统读往来记录判的')
    // 常量和字面量必须是同一个东西 —— 免得哪天改了常量而翻译还认旧值
    expect(describeStageActor(STAGE_INFER_ACTOR)).toBe('系统读往来记录判的')
  })

  it('26 次的那个：系统自动标真买家', () => {
    expect(describeStageActor(AUTO_TAG_ACTOR)).toBe('系统自动标的')
  })

  it('18 次的那个：系统回填', () => {
    expect(describeStageActor('system')).toBe('系统回填的')
  })

  it('12 次的那个是真人 —— 显示邮箱前缀，不显示整个邮箱', () => {
    expect(describeStageActor('info@ctstours.co.nz')).toBe('info 改的')
  })
})

describe('describeStageActor —— 不许把内部字符串丢给员工', () => {
  it('认不出来的机器身份说「系统」，不原样输出', () => {
    const out = describeStageActor('ai:some-future-judge')
    expect(out).toBe('系统')
    expect(out).not.toContain('ai:')
  })

  it('认不出来的 system: 前缀同理', () => {
    expect(describeStageActor('system:brand-new-thing')).toBe('系统')
  })

  it('空 / null / 全空格 → 说「系统」，不显示空白', () => {
    expect(describeStageActor(null)).toBe('系统')
    expect(describeStageActor(undefined)).toBe('系统')
    expect(describeStageActor('')).toBe('系统')
    expect(describeStageActor('   ')).toBe('系统')
  })

  it('大小写不该影响判定', () => {
    expect(describeStageActor('AI:Conversation-Read')).toBe('系统读往来记录判的')
  })
})

describe('机器发件身份：长得像邮箱但不是人', () => {
  /**
   * 🔴 这一条是整个文件的重点。
   *
   * `governed-reply-agent@magicengine.cloud` 带 `@`，而 `isHumanActor` 的判据
   * 就是「含 @ 就算人」—— 它会把这个机器判成真人。那个函数今天还没有生产调用方，
   * 所以没出事；但**显示这一侧现在就不许认错**，否则员工会以为自动回复是同事发的，
   * 把一批其实没人碰过的热线索当成已处理。
   */
  it('自动回复机器人不能被显示成一个人', () => {
    const bot = 'governed-reply-agent@magicengine.cloud'
    expect(AUTOMATED_SENDER_EMAILS.has(bot)).toBe(true)
    expect(isAutomatedActor(bot)).toBe(true)
    const out = describeStageActor(bot)
    expect(out).toBe('系统自动回复')
    // 绝不能退化成「governed-reply-agent 改的」那种像人名的说法
    expect(out).not.toContain('改的')
  })

  it('真人的邮箱不会被误判成机器', () => {
    expect(isAutomatedActor('info@ctstours.co.nz')).toBe(false)
    expect(isAutomatedActor('bigbigraydeng@gmail.com')).toBe(false)
  })
})

describe('stageChangeWasAutomated —— 决定要不要显示「凭这句」', () => {
  it('机器判的要显示凭据', () => {
    expect(stageChangeWasAutomated('ai:conversation-read')).toBe(true)
    expect(stageChangeWasAutomated(AUTO_TAG_ACTOR)).toBe(true)
    expect(stageChangeWasAutomated('system')).toBe(true)
  })

  it('真人改的没有凭据可显示 —— 生产上那 12 条 note 全是空的，人不解释自己', () => {
    expect(stageChangeWasAutomated('info@ctstours.co.nz')).toBe(false)
  })
})

describe('stageReasonForDisplay —— 剥掉「谁改的」那一格已经说过的开头', () => {
  /**
   * 2026-09-27 拿生产数据试跑时肉眼抓到的：不剥的话员工看到的是
   * 「系统读往来记录判的 · 读往来记录判的：客户对旅游信息感兴趣」，同一句说两遍。
   * 单元测试抓不到这种「难看」，是试跑抓到的 —— 所以这几条是补上的护栏。
   */
  it('剥掉 AI 那个开头，客人原话必须留着', () => {
    const real = '读往来记录判的：客户对旅游信息感兴趣，已经联系。｜原话：「Hello! I filled out your form」'
    const out = stageReasonForDisplay(real)
    expect(out).toBe('客户对旅游信息感兴趣，已经联系。｜原话：「Hello! I filled out your form」')
    expect(out).not.toContain('读往来记录判的')
    // 🔴 凭据是整件事的重点，剥开头绝不能顺手吃掉它
    expect(out).toContain('原话')
    expect(out).toContain('Hello! I filled out your form')
  })

  it('剥掉「系统自动标为真买家」那个开头', () => {
    const real = '系统自动标为真买家：客户自己发了 5 条消息（门槛 3 条）'
    expect(stageReasonForDisplay(real)).toBe('客户自己发了 5 条消息（门槛 3 条）')
  })

  it('开头不认识就一个字都不动 —— 剥错了会吃掉真正的理由，比啰嗦严重得多', () => {
    expect(stageReasonForDisplay('小王打电话确认过了')).toBe('小王打电话确认过了')
    expect(stageReasonForDisplay('客户说：先不考虑')).toBe('客户说：先不考虑')
  })

  it('空的 / 只剩开头 → 返回 null，让调用方干脆别显示这一格', () => {
    expect(stageReasonForDisplay(null)).toBeNull()
    expect(stageReasonForDisplay(undefined)).toBeNull()
    expect(stageReasonForDisplay('   ')).toBeNull()
    expect(stageReasonForDisplay('读往来记录判的：')).toBeNull()
  })

  /**
   * `break` 守的是「同一条理由里恰好出现了两种开头」这一种，不是「同一个开头出现两次」
   * —— 循环遍历的是两个**不同**的前缀，同一个本来就不可能被剥两次。
   * 第一版测试用的是同一个开头重复，所以把 `break` 删掉照样绿（实测存活），
   * 那条断言什么都没钉住。换成真正能触发它的组合。
   */
  it('只剥最外面那一层开头，不连着剥第二种', () => {
    const out = stageReasonForDisplay('读往来记录判的：系统自动标为真买家：两种开头都在')
    expect(out).toBe('系统自动标为真买家：两种开头都在')
  })

  it('同一个开头写了两遍，只剥掉外面那一个', () => {
    const out = stageReasonForDisplay('读往来记录判的：读往来记录判的：奇怪但合法')
    expect(out).toBe('读往来记录判的：奇怪但合法')
  })
})
