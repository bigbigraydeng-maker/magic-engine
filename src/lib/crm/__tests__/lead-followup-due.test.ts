/**
 * 「客人填了表还没人回」判据测试。
 *
 * 每一条都对着 `lead-followup-due` 文件头里某一条**具体**的红线，
 * 尤其是那条最容易被后人「顺手优化掉」的：Facebook 私信外发整类不算联系过。
 */
import { describe, it, expect } from 'vitest'
import {
  pickLeadFollowupDue,
  isHumanFollowup,
  LEAD_SLA_HOURS,
  LEAD_WINDOW_DAYS,
  SETTLED_STAGES,
  type LeadCandidate,
  type LeadTouch,
} from '../lead-followup-due'

const NOW = new Date('2026-09-24T00:00:00Z')
const HOUR = 3_600_000
const DAY = 24 * HOUR

function iso(msAgo: number): string {
  return new Date(NOW.getTime() - msAgo).toISOString()
}

function touch(over: Partial<LeadTouch> = {}): LeadTouch {
  return {
    channel: 'email',
    direction: 'outbound',
    occurredAt: iso(DAY),
    source: 'microsoft_mail',
    metadata: null,
    ...over,
  }
}

function candidate(over: Partial<LeadCandidate> = {}): LeadCandidate {
  return {
    clientId: 'client-1',
    contactId: 'p1',
    displayName: '王女士',
    leadAt: iso(2 * DAY),
    interest: 'Best of China',
    touches: [],
    doNotContactFlag: false,
    stage: 'new',
    snoozeUntil: null,
    ...over,
  }
}

describe('isHumanFollowup —— 什么才算真人跟过', () => {
  it('info@ 发出去的邮件算', () => {
    expect(isHumanFollowup(touch({ channel: 'email', source: 'microsoft_mail' }))).toBe(true)
  })

  it('电话记录算，打不通也算（打过了就是打过了）', () => {
    expect(isHumanFollowup(touch({ channel: 'phone', direction: 'inbound', source: null }))).toBe(true)
  })

  it('有人在系统里手写了一笔算', () => {
    expect(isHumanFollowup(touch({ channel: 'email', direction: 'inbound', source: 'me_manual' }))).toBe(true)
  })

  it('🔴 Facebook 私信的外发整类不算 —— Meta 的 AI 客服在库里跟真人回复长得一模一样', () => {
    expect(isHumanFollowup(touch({ channel: 'messenger', source: 'messenger' }))).toBe(false)
  })

  it('Mailchimp 群发不算（isAutomatedTouch 整类认掉）', () => {
    expect(isHumanFollowup(touch({ channel: 'email', source: 'mailchimp' }))).toBe(false)
  })

  it('写入方自己标了 automated 的不算', () => {
    expect(isHumanFollowup(touch({ metadata: { automated: true } }))).toBe(false)
  })

  it('客人自己发进来的不算「我们跟过他」', () => {
    expect(isHumanFollowup(touch({ direction: 'inbound', source: 'microsoft_mail' }))).toBe(false)
  })
})

describe('pickLeadFollowupDue', () => {
  it('没人回的进名单', () => {
    const r = pickLeadFollowupDue([candidate()], NOW)
    expect(r.items.map((i) => i.contactId)).toEqual(['p1'])
    expect(r.backlog).toBe(0)
  })

  it('有真人回过的不进', () => {
    const r = pickLeadFollowupDue([candidate({ touches: [touch()] })], NOW)
    expect(r.items).toEqual([])
  })

  it('🔴 只被 Facebook AI 客服回过的**照样进** —— 这正是 PM 反映的那批人', () => {
    const r = pickLeadFollowupDue(
      [candidate({ touches: [touch({ channel: 'messenger', source: 'messenger' })] })],
      NOW,
    )
    expect(r.items.map((i) => i.contactId)).toEqual(['p1'])
  })

  it(`刚填完不到 ${LEAD_SLA_HOURS} 小时的不催`, () => {
    const r = pickLeadFollowupDue([candidate({ leadAt: iso(2 * HOUR) })], NOW)
    expect(r.items).toEqual([])
    expect(r.backlog).toBe(0)
  })

  it(`窗口（${LEAD_WINDOW_DAYS} 天）之外的不逐条列，但要算进积压`, () => {
    const r = pickLeadFollowupDue([candidate({ leadAt: iso(40 * DAY) })], NOW)
    expect(r.items).toEqual([])
    expect(r.backlog).toBe(1)
  })

  it('标了别再联系的不进', () => {
    const r = pickLeadFollowupDue([candidate({ doNotContactFlag: true })], NOW)
    expect(r.items).toEqual([])
  })

  it('别再联系被人推翻过的，重新进名单（判据只有 crm/dnc 一份）', () => {
    const r = pickLeadFollowupDue(
      [
        candidate({
          doNotContactFlag: true,
          touches: [touch({ direction: 'inbound', source: 'messenger', channel: 'messenger', metadata: { outcome: 'dnc_cleared' }, occurredAt: iso(DAY) })],
        }),
      ],
      NOW,
    )
    expect(r.items.map((i) => i.contactId)).toEqual(['p1'])
  })

  it.each([...SETTLED_STAGES])('已经到「%s」这一档的不再提醒', (stage) => {
    const r = pickLeadFollowupDue([candidate({ stage })], NOW)
    expect(r.items).toEqual([])
  })

  it('🔴 停在「已联系」的**照样提醒** —— 这一档可能是系统从 AI 对话里自动推出来的', () => {
    const r = pickLeadFollowupDue([candidate({ stage: 'contacted' })], NOW)
    expect(r.items.map((i) => i.contactId)).toEqual(['p1'])
  })

  it('被按了「过阵子再提醒」且还没到点的不进', () => {
    const until = new Date(NOW.getTime() + 3 * DAY).toISOString()
    expect(pickLeadFollowupDue([candidate({ snoozeUntil: until })], NOW).items).toEqual([])
  })

  it('「过阵子再提醒」已经到点的重新进', () => {
    const until = new Date(NOW.getTime() - DAY).toISOString()
    expect(pickLeadFollowupDue([candidate({ snoozeUntil: until })], NOW).items).toHaveLength(1)
  })

  it('等最久的排最前', () => {
    const r = pickLeadFollowupDue(
      [
        candidate({ contactId: 'new', leadAt: iso(2 * DAY) }),
        candidate({ contactId: 'old', leadAt: iso(6 * DAY) }),
      ],
      NOW,
    )
    expect(r.items.map((i) => i.contactId)).toEqual(['old', 'new'])
  })

  it('封顶之后被压掉的要算进 dropped，不能静默消失', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      candidate({ contactId: `p${i}`, leadAt: iso((2 + i) * DAY) }),
    )
    const r = pickLeadFollowupDue(many, NOW, 2)
    expect(r.items).toHaveLength(2)
    expect(r.dropped).toBe(3)
  })

  it('时间戳坏掉的不丢，算进积压', () => {
    const r = pickLeadFollowupDue([candidate({ leadAt: 'not-a-date' })], NOW)
    expect(r.items).toEqual([])
    expect(r.backlog).toBe(1)
  })
})
