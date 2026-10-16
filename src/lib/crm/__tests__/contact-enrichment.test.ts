import { describe, it, expect } from 'vitest'

import {
  isMissingName,
  nameFromEmail,
  emailFromHints,
  resolveDisplayName,
  sourcesOf,
  originOf,
  enrichContacts,
  type ConversationHint,
  type OutboundEmailMsg,
} from '../contact-enrichment'
import type { ContactRow, TouchRow } from '../contact-response-row'

function makeContact(over: Partial<ContactRow> = {}): ContactRow {
  return {
    id: 'c1',
    display_name: 'Jane Doe',
    primary_phone: null,
    primary_email: null,
    do_not_contact: false,
    snooze_until: null,
    stage: null,
    first_seen_at: '2026-09-26T00:00:00Z',
    pinned_at: null,
    important_note: null,
    important_due_at: null,
    ...over,
  }
}

function makeTouch(over: Partial<TouchRow> = {}): TouchRow {
  return {
    id: 't1',
    contact_id: 'c1',
    channel: 'phone',
    direction: 'inbound',
    occurred_at: '2026-09-20T00:00:00Z',
    summary: null,
    raw: null,
    metadata: null,
    source: null,
    ...over,
  }
}

describe('isMissingName', () => {
  it('空、带 @、占位串都算「等于没有」', () => {
    expect(isMissingName(null)).toBe(true)
    expect(isMissingName('')).toBe(true)
    expect(isMissingName('  ')).toBe(true)
    expect(isMissingName('a@b.com')).toBe(true)
    expect(isMissingName('WhatsApp Business')).toBe(true)
    expect(isMissingName('unknown')).toBe(true)
    expect(isMissingName('未知')).toBe(true)
    expect(isMissingName('未留姓名')).toBe(true)
  })

  it('真名不算缺失', () => {
    expect(isMissingName('Jane Doe')).toBe(false)
  })
})

describe('nameFromEmail', () => {
  it('抠出 @ 前面那段，首字母大写', () => {
    expect(nameFromEmail('Chriskavy@yahoo.com.sg')).toBe('Chriskavy')
    expect(nameFromEmail('john.smith@x.com')).toBe('John.smith')
  })

  it('太短、没有 @、null 都返回 null', () => {
    expect(nameFromEmail('a@x.com')).toBe(null)
    expect(nameFromEmail('noatsign')).toBe(null)
    expect(nameFromEmail(null)).toBe(null)
  })
})

describe('emailFromHints', () => {
  it('取第一个长得像邮箱的参与者，忽略人名', () => {
    const hints: ConversationHint[] = [
      { contactId: 'c1', channel: 'messenger', participantName: 'Wang Lei' },
      { contactId: 'c1', channel: 'email', participantName: 'wang@x.com' },
      { contactId: 'c1', channel: 'email', participantName: 'other@y.com' },
    ]
    expect(emailFromHints(hints)).toBe('wang@x.com')
  })

  it('没有邮箱时返回 null', () => {
    const hints: ConversationHint[] = [
      { contactId: 'c1', channel: 'messenger', participantName: 'Wang Lei' },
      { contactId: 'c1', channel: 'messenger', participantName: null },
    ]
    expect(emailFromHints(hints)).toBe(null)
  })
})

describe('resolveDisplayName', () => {
  it('真名原样保留', () => {
    expect(
      resolveDisplayName({ displayName: 'Jane Doe', email: null, hints: [] }),
    ).toBe('Jane Doe')
  })

  it('名字是邮箱时，优先用会话参与者里的真名', () => {
    const hints: ConversationHint[] = [
      { contactId: 'c1', channel: 'messenger', participantName: 'Wang Lei' },
    ]
    expect(
      resolveDisplayName({
        displayName: 'chris@yahoo.com.sg',
        email: null,
        hints,
      }),
    ).toBe('Wang Lei')
  })

  it('没有参与者真名时，退回 displayName 的邮箱前缀', () => {
    expect(
      resolveDisplayName({
        displayName: 'Chriskavy@yahoo.com.sg',
        email: null,
        hints: [],
      }),
    ).toBe('Chriskavy')
  })

  it('给了 email 时用 email 的前缀', () => {
    expect(
      resolveDisplayName({
        displayName: null,
        email: 'john.smith@x.com',
        hints: [],
      }),
    ).toBe('John.smith')
  })

  it('什么都拼不出来时返回 null', () => {
    expect(
      resolveDisplayName({ displayName: null, email: null, hints: [] }),
    ).toBe(null)
  })
})

describe('sourcesOf', () => {
  it('去重并按固定顺序输出', () => {
    expect(
      sourcesOf({
        conversationChannels: ['email', 'messenger'],
        touchChannels: ['meta_lead_form', 'phone'],
      }),
    ).toEqual(['messenger', 'email', 'phone', 'fb_form'])
  })

  it('忽略认不出的渠道', () => {
    expect(
      sourcesOf({
        conversationChannels: ['telegram'],
        touchChannels: ['carrier_pigeon'],
      }),
    ).toEqual([])
  })
})

describe('enrichContacts — Chriskavy 场景', () => {
  it('补出名字、邮箱和合成触点，且不改入参', () => {
    const contact = makeContact({
      id: 'c1',
      display_name: 'Chriskavy@yahoo.com.sg',
      primary_email: null,
      primary_phone: null,
    })
    const hints: ConversationHint[] = [
      {
        contactId: 'c1',
        channel: 'email',
        participantName: 'Chriskavy@yahoo.com.sg',
      },
    ]
    const outboundEmails: OutboundEmailMsg[] = [
      { contactId: 'c1', sentAt: '2026-09-25T03:46:34Z', messageId: 'm1' },
    ]
    const touches: TouchRow[] = []

    const result = enrichContacts({
      contacts: [contact],
      touches,
      hints,
      outboundEmails,
    })

    expect(result.contacts).toHaveLength(1)
    const enriched = result.contacts[0]
    expect(enriched.display_name).toBe('Chriskavy')
    expect(enriched.primary_email).toBe('Chriskavy@yahoo.com.sg')

    const synthetic = result.touches.filter((t) => t.id === 'email-msg:m1')
    expect(synthetic).toHaveLength(1)
    expect(synthetic[0]).toMatchObject({
      id: 'email-msg:m1',
      contact_id: 'c1',
      channel: 'email',
      direction: 'outbound',
      occurred_at: '2026-09-25T03:46:34Z',
      source: 'email_conversation',
    })

    expect(result.sources.get('c1')).toEqual(['email'])

    // 入参没被改
    expect(contact.display_name).toBe('Chriskavy@yahoo.com.sg')
    expect(touches).toHaveLength(0)
  })
})

describe('enrichContacts — 合成触点的去重', () => {
  it('已有外发邮件触点时不再补合成触点', () => {
    const contact = makeContact({ id: 'c1' })
    const touches: TouchRow[] = [
      makeTouch({
        id: 't-email',
        contact_id: 'c1',
        channel: 'email',
        direction: 'outbound',
      }),
    ]
    const outboundEmails: OutboundEmailMsg[] = [
      { contactId: 'c1', sentAt: '2026-09-25T03:46:34Z', messageId: 'm1' },
    ]

    const result = enrichContacts({
      contacts: [contact],
      touches,
      hints: [],
      outboundEmails,
    })

    expect(result.touches.filter((t) => t.id === 'email-msg:m1')).toHaveLength(0)
    expect(result.touches).toHaveLength(1)
  })

  it('只有外发电话触点时仍补合成邮件触点', () => {
    const contact = makeContact({ id: 'c1' })
    const touches: TouchRow[] = [
      makeTouch({
        id: 't-phone',
        contact_id: 'c1',
        channel: 'phone',
        direction: 'outbound',
      }),
    ]
    const outboundEmails: OutboundEmailMsg[] = [
      { contactId: 'c1', sentAt: '2026-09-25T03:46:34Z', messageId: 'm1' },
    ]

    const result = enrichContacts({
      contacts: [contact],
      touches,
      hints: [],
      outboundEmails,
    })

    expect(result.touches.filter((t) => t.id === 'email-msg:m1')).toHaveLength(1)
  })
})

describe('enrichContacts — messenger 联系人', () => {
  it('真名不动，来源只报 messenger', () => {
    const contact = makeContact({
      id: 'c1',
      display_name: 'Wang Lei',
      primary_email: null,
    })
    const hints: ConversationHint[] = [
      { contactId: 'c1', channel: 'messenger', participantName: 'Wang Lei' },
    ]

    const result = enrichContacts({
      contacts: [contact],
      touches: [],
      hints,
      outboundEmails: [],
    })

    expect(result.contacts[0].display_name).toBe('Wang Lei')
    expect(result.sources.get('c1')).toEqual(['messenger'])
  })
})

describe('originOf（最早从哪个渠道进来）', () => {
  it('取最早的一条触点的渠道，不是「来过哪些」', () => {
    expect(
      originOf({
        touches: [
          { channel: 'phone', occurred_at: '2026-09-20T00:00:00Z' },
          { channel: 'meta_lead_form', occurred_at: '2026-09-01T00:00:00Z' },
          { channel: 'messenger', occurred_at: '2026-09-10T00:00:00Z' },
        ],
        conversationChannels: ['email'],
      }),
    ).toBe('fb_form')
  })

  it('没有可认的触点就退回会话渠道；都没有返回 null', () => {
    expect(originOf({ touches: [{ channel: 'unknown', occurred_at: '2026-09-01T00:00:00Z' }], conversationChannels: ['email'] })).toBe('email')
    expect(originOf({ touches: [], conversationChannels: [] })).toBeNull()
  })
})
