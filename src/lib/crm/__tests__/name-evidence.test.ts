import { describe, expect, it } from 'vitest'
import { nameFromFormSubject, nameMatchesEmail, proposeNameFromEvidence, type NameEvidence } from '../name-evidence'

const ev = (over: Partial<NameEvidence> = {}): NameEvidence => ({ participantNames: [], subjects: [], senderNames: [], email: null, ...over })

describe('nameFromFormSubject', () => {
  it('取表单通知标题里最后一个破折号后面的名字', () => {
    expect(nameFromFormSubject('Re: Tailor-made enquiry — Tracey Ray')).toBe('Tracey Ray')
    expect(nameFromFormSubject('回复: Contact form: General Inquiry — Sumedha')).toBe('Sumedha')
  })
  it('后面是线路名 / 不是表单标题 → null', () => {
    expect(nameFromFormSubject('Re: Tour enquiry: China Discovery — Best of China')).toBeNull()
    expect(nameFromFormSubject('Partnership Opportunity — Acme')).toBeNull()
    expect(nameFromFormSubject('Hello there')).toBeNull()
  })
})

describe('nameMatchesEmail', () => {
  it('名字里的词出现在邮箱 @ 前面', () => {
    expect(nameMatchesEmail('Tracey Ray', 'traceyray@gmx.com')).toBe(true)
    expect(nameMatchesEmail('Brenda Girven', 'brendam@hotmail.co.nz')).toBe(true)
    expect(nameMatchesEmail('Linan', 'abc877050119@gmail.com')).toBe(false)
    expect(nameMatchesEmail('Tracey Ray', null)).toBe(false)
  })
})

describe('proposeNameFromEvidence', () => {
  it('会话里的全名最优先，把握高', () => {
    const p = proposeNameFromEvidence(ev({ participantNames: ['Brenda Girven'], email: 'brendam@hotmail.co.nz' }))
    expect(p).toMatchObject({ name: 'Brenda Girven', source: 'conversation_name', confidence: 'high' })
  })
  it('会话名是邮箱 / 太短 / 是我们自己（PA、CTS Tours）→ 不用', () => {
    expect(proposeNameFromEvidence(ev({ participantNames: ['a@b.com', 'PA', 'CTS Tours', 'Li'] }))).toBeNull()
  })
  it('没有会话名时用表单标题里的名字；名字像他邮箱则把握高', () => {
    const p = proposeNameFromEvidence(ev({ subjects: ['Re: Tailor-made enquiry — Tracey Ray'], email: 'traceyray@gmx.com' }))
    expect(p).toMatchObject({ name: 'Tracey Ray', source: 'form_subject', confidence: 'high' })
  })
  it('单个词的名字把握只有 medium / low，不冒充全名', () => {
    expect(proposeNameFromEvidence(ev({ participantNames: ['John'], email: 'someone@x.com' }))?.confidence).toBe('medium')
    expect(proposeNameFromEvidence(ev({ subjects: ['Contact form: General Inquiry — Sumedha'], email: 'x1@y.com' }))?.confidence).toBe('low')
  })
  it('多个候选：全名且像邮箱的优先；没有任何证据 → null', () => {
    const p = proposeNameFromEvidence(ev({ participantNames: ['greg lawrence', 'Greg Lawrence'], email: 'awesomegreg@hotmail.co.nz' }))
    expect(p?.name.toLowerCase()).toBe('greg lawrence')
    expect(proposeNameFromEvidence(ev())).toBeNull()
  })
})
