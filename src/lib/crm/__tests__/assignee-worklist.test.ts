import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LeadDueItem } from '../lead-followup-due'
import type { ReplyDueItem } from '../email-reply-due'

vi.mock('../lead-followup-due', () => ({ findLeadFollowupDue: vi.fn() }))
vi.mock('../email-reply-due', () => ({ findEmailRepliesDue: vi.fn() }))

import { findLeadFollowupDue } from '../lead-followup-due'
import { findEmailRepliesDue } from '../email-reply-due'
import { UNASSIGNED, composeWorklist, findAssigneeWorklist } from '../assignee-worklist'

const NOW = new Date('2026-10-27T00:00:00Z')
const LISA = 'lisa@example.com'
const BAKER = 'baker@example.com'

const meta = (id: string, leadAt: string, interest: string | null = null): LeadDueItem => ({
  clientId: 'cts',
  contactId: id,
  displayName: `M-${id}`,
  interest,
  leadAt,
})
const mail = (id: string, at: string, subject: string | null = null, conv = `conv-${id}`): ReplyDueItem => ({
  clientId: 'cts',
  contactId: id,
  conversationId: conv,
  displayName: `E-${id}`,
  subject,
  lastMessageAt: at,
  waitingHours: 0,
})

const base = { metaForm: [], email: [], whatsapp: [], assignedTo: new Map<string, string | null>(), now: NOW }

describe('composeWorklist —— 三个来源并成一份名单', () => {
  it('三个渠道的人都进名单，来源如实标注，等最久的排最前', () => {
    const r = composeWorklist({
      ...base,
      metaForm: [meta('a', '2026-10-25T00:00:00Z', '长城团')],
      email: [mail('b', '2026-10-20T00:00:00Z', 'Tour enquiry')],
      whatsapp: [mail('c', '2026-10-26T12:00:00Z')],
    })
    expect(r.entries.map((e) => e.contactId)).toEqual(['b', 'a', 'c'])
    expect(r.entries.map((e) => e.sources)).toEqual([['email'], ['meta_form'], ['whatsapp']])
    expect(r.detected).toEqual({ meta_form: 1, email: 1, whatsapp: 1 })
  })

  it('等了多久按自然小时向下取整', () => {
    const r = composeWorklist({ ...base, metaForm: [meta('a', '2026-10-26T00:30:00Z')] })
    expect(r.entries[0].waitingHours).toBe(23) // 23.5 小时
  })

  it('🔴 同一个人在多个来源里只出现一次（官网表单既是表单又是邮件线程），来源都留着，等的时间取最早', () => {
    const r = composeWorklist({
      ...base,
      metaForm: [meta('x', '2026-10-24T00:00:00Z', '丝绸之路')],
      email: [mail('x', '2026-10-22T00:00:00Z', 'Re: enquiry')],
    })
    expect(r.entries).toHaveLength(1)
    expect(r.entries[0].sources).toEqual(['email', 'meta_form'])
    expect(r.entries[0].waitingSince).toBe('2026-10-22T00:00:00Z')
    expect(r.entries[0].headline).toBe('丝绸之路') // 先到的来源（表单）的标题
    expect(r.entries[0].conversationId).toBe('conv-x')
    // 「各来源找到几人」按来源算，不因合并而少
    expect(r.detected).toEqual({ meta_form: 1, email: 1, whatsapp: 0 })
  })
})

describe('composeWorklist —— 按跟进人切', () => {
  const assignedTo = new Map<string, string | null>([
    ['a', LISA],
    ['b', BAKER],
    ['c', null],
  ])
  const inputs = {
    ...base,
    assignedTo,
    metaForm: [meta('a', '2026-10-20T00:00:00Z')],
    email: [mail('b', '2026-10-21T00:00:00Z')],
    whatsapp: [mail('c', '2026-10-22T00:00:00Z')],
  }

  it('只给 Lisa 名下的', () => {
    expect(composeWorklist({ ...inputs, assignee: LISA }).entries.map((e) => e.contactId)).toEqual(['a'])
  })

  it('UNASSIGNED = 还没分给任何人的', () => {
    expect(composeWorklist({ ...inputs, assignee: UNASSIGNED }).entries.map((e) => e.contactId)).toEqual(['c'])
  })

  it('不传 = 全部', () => {
    expect(composeWorklist(inputs).entries).toHaveLength(3)
  })

  it('🔴 过滤只影响 entries，byAssignee 始终是过滤前的全貌（别人名下有几位说得出口）', () => {
    const r = composeWorklist({ ...inputs, assignee: LISA })
    expect(r.byAssignee).toEqual({ [LISA]: 1, [BAKER]: 1, [UNASSIGNED]: 1 })
  })

  it('查不到 assigned_to 的人按未分配算，不是丢掉', () => {
    const r = composeWorklist({ ...base, metaForm: [meta('z', '2026-10-20T00:00:00Z')], assignee: UNASSIGNED })
    expect(r.entries.map((e) => e.contactId)).toEqual(['z'])
  })

  it('指定了一个没人的跟进人 → 空名单，不是报错', () => {
    expect(composeWorklist({ ...inputs, assignee: 'nobody@example.com' }).entries).toEqual([])
  })
})

describe('composeWorklist —— 透传', () => {
  it('陌生发件人数量和检测器失败原样带出', () => {
    const r = composeWorklist({ ...base, strangerEmails: 7, errors: { email: '读库超时' } })
    expect(r.strangerEmails).toBe(7)
    expect(r.errors).toEqual({ email: '读库超时' })
  })
})

describe('findAssigneeWorklist —— 取数层', () => {
  const contactsRows = [
    { id: 'a', assigned_to: LISA },
    { id: 'b', assigned_to: null },
  ]
  const supabase = {
    from: vi.fn(() => ({
      select: () => ({
        in: () => ({ order: () => ({ range: () => Promise.resolve({ data: contactsRows, error: null }) }) }),
      }),
    })),
  } as never

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('三个检测器都跑；Meta 表单不封顶；WhatsApp 用 whatsapp 渠道；邮件把陌生发件人分出来', async () => {
    vi.mocked(findLeadFollowupDue).mockResolvedValue({ items: [meta('a', '2026-10-20T00:00:00Z')], dropped: 0, orphans: 0 })
    vi.mocked(findEmailRepliesDue)
      .mockResolvedValueOnce({ items: [mail('b', '2026-10-21T00:00:00Z')], dropped: 0, droppedByClient: {}, firstContacts: [mail('s1', 'x'), mail('s2', 'x')] })
      .mockResolvedValueOnce({ items: [], dropped: 0, droppedByClient: {} })

    const r = await findAssigneeWorklist(supabase, 'cts', NOW, { assignee: LISA })

    expect(findLeadFollowupDue).toHaveBeenCalledWith(supabase, 'cts', NOW, 0) // 0 = 不封顶
    const calls = vi.mocked(findEmailRepliesDue).mock.calls
    expect(calls[0][3]).toEqual({ separateFirstContacts: true })
    expect(calls[1][3]).toEqual({ channel: 'whatsapp' })
    expect(r.entries.map((e) => e.contactId)).toEqual(['a'])
    expect(r.strangerEmails).toBe(2)
    expect(r.errors).toEqual({})
  })

  it('🔴 邮件检测器抛错 → 记进 errors，Meta 和 WhatsApp 的结果照常给，不整体作废', async () => {
    vi.mocked(findLeadFollowupDue).mockResolvedValue({ items: [meta('a', '2026-10-20T00:00:00Z')], dropped: 0, orphans: 0 })
    vi.mocked(findEmailRepliesDue)
      .mockRejectedValueOnce(new Error('邮件读库失败'))
      .mockResolvedValueOnce({ items: [mail('b', '2026-10-21T00:00:00Z')], dropped: 0, droppedByClient: {} })

    const r = await findAssigneeWorklist(supabase, 'cts', NOW)

    expect(r.errors).toEqual({ email: '邮件读库失败' })
    expect(r.entries.map((e) => e.contactId).sort()).toEqual(['a', 'b'])
    expect(r.detected.email).toBe(0) // 失败了就是没测成，不假装是 0 条也不假装有
  })

  it('全部检测器都失败 → 空名单 + 三条错误，不抛', async () => {
    vi.mocked(findLeadFollowupDue).mockRejectedValue(new Error('m'))
    vi.mocked(findEmailRepliesDue).mockRejectedValue(new Error('e'))
    const r = await findAssigneeWorklist(supabase, 'cts', NOW)
    expect(r.entries).toEqual([])
    expect(Object.keys(r.errors).sort()).toEqual(['email', 'meta_form', 'whatsapp'])
  })
})
