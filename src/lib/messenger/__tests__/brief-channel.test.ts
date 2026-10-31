import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, type ClientIdentity } from '../brief'

const identity: ClientIdentity = { name: 'Acme Travel', industry: 'travel' }

describe('buildSystemPrompt —— 按渠道说话', () => {
  it('不传渠道时跟私信**一字不差**：私信这条路在跑，这次不许顺手改它', () => {
    expect(buildSystemPrompt(identity, [])).toBe(buildSystemPrompt(identity, [], 'messenger'))
  })

  it('私信说 Facebook Messenger，邮件说 email —— 卡里的下一步动作靠这个才不会指错地方', () => {
    expect(buildSystemPrompt(identity, [], 'messenger')).toContain('Facebook Messenger thread between Acme Travel')
    expect(buildSystemPrompt(identity, [], 'email')).toContain('an email thread between Acme Travel')
    expect(buildSystemPrompt(identity, [], 'email')).not.toContain('Facebook Messenger')
  })

  it('只有邮件那条多一句「要有称呼和署名、不许写主题行」，私信一句都不多', () => {
    const m = buildSystemPrompt(identity, [], 'messenger').split('\n')
    const e = buildSystemPrompt(identity, [], 'email').split('\n')
    const extra = e.filter((l) => !m.includes(l))
    expect(extra).toHaveLength(2) // 开头那行（渠道名不同）+ 回信那句
    expect(extra.join(' ')).toContain('sign off as Acme Travel')
    expect(extra.join(' ')).toContain('Never write a subject line')
    // 反过来：私信不该有任何邮件没有的行，除了开头那行渠道名
    expect(m.filter((l) => !e.includes(l))).toHaveLength(1)
  })

  it('共享提示词里不许出现任何客户名字（客户事实不进共享运行时）', () => {
    const p = buildSystemPrompt(identity, [], 'email')
    // 按完整词匹配，不能用 includes：提示词里的 `CLIENT FACTS` 本身就含有
    // "CTS" 这三个连续字母（FACTS），第一版这么写直接误报了一次。
    for (const name of ['CTS Tours', 'CTS', 'Oztop', 'Roman', 'NAL']) {
      expect(p).not.toMatch(new RegExp(`\\b${name}\\b`))
    }
  })

  it('摘要保留来源中的客户原名，不翻译或音译', () => {
    const prompt = buildSystemPrompt(identity, [])
    expect(prompt).toContain('Never translate or transliterate a name')
    expect(prompt).toContain('copy their spelling exactly')
  })
})
