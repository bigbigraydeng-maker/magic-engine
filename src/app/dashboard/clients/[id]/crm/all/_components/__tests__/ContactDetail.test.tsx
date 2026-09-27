/**
 * 「全部客人」页的展开区（ContactDetail）——2026-09-28 补 WhatsApp 回复框。
 *
 * 🔴 **这一页原来连 Messenger / 邮件的回复框都没有**（PM 当场测试撞到的真实缺口，
 * 不是猜的）：「今天要联系」页的 PersonDrawer 早就有 MessengerReply / EmailReply /
 * WhatsAppReply 三块，而这一页是独立组件、历史上一直没跟着长。这次只补 WhatsApp
 * 那一块——查证经过写在 `docs/ledger/`，Messenger / 邮件的同款缺口记了台账，
 * 不在这次一起改。
 *
 * WhatsAppReply 组件本身的行为（没有会话就不渲染、渠道文案对不对）已经在
 * `WhatsAppReply.test.tsx` 里钉过，这里只钉「接线接对了没有」：
 * 传给它的 clientId / contactId / viewerEmail 是不是这一页自己的数据，
 * 不是抄错了别处的变量名。
 */

import React from 'react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { ContactDetail } from '../ContactDetail'
import type { ContactRow } from '../contact-table-types'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'

const row = (over: Partial<ContactRow> = {}): ContactRow => ({
  contactId: 'contact-1',
  name: 'Kam',
  firstSeenAt: '2026-09-01T00:00:00Z',
  lastTouchAt: null,
  phone: null,
  email: null,
  hasMessenger: false,
  stage: null,
  stageLabel: null,
  pinnedAt: null,
  important: { note: null, dueAt: null },
  segment: 'new',
  segmentLabel: '新线索',
  temperature: 'warm',
  custom: {},
  ...over,
})

const draw = (over: Parameters<typeof ContactDetail>[0] extends infer P ? Partial<P> : never = {}) =>
  render(
    <ContactDetail
      clientId={CLIENT}
      row={row()}
      stages={[]}
      timeline={[]}
      omitted={0}
      loading={false}
      onWrote={vi.fn()}
      viewerEmail="fde@example.com"
      {...over}
    />,
  )

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ContactDetail 接上 WhatsAppReply，接线接对了没有', () => {
  it('查询打的是这一页自己的 clientId / contactId，不是抄错的', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ conversationId: null }) })
    vi.stubGlobal('fetch', f)
    draw()

    await waitFor(() => expect(f).toHaveBeenCalled())
    expect(String(f.mock.calls[0][0])).toBe(`/api/clients/${CLIENT}/crm/contacts/contact-1/whatsapp`)
  })

  it('有 WhatsApp 线的人，展开区里真的出现回复框（不是被漏渲染）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          conversationId: 'convo-wa-1',
          participantName: null,
          replyWindow: { kind: 'standard', msRemaining: 6 * 3_600_000 },
        }),
      }),
    )
    // 🔴 不能用 getByRole('textbox') —— 这一页顶上的「要记住的事」也是个 textarea，
    // 两个 textbox 会撞上 getMultipleElementsFoundError（实测踩过）。
    const { getByText, getByRole } = draw()

    await waitFor(() => expect(getByText(/回他的 WhatsApp/)).toBeInTheDocument())
    expect(getByRole('button', { name: /发送给客户/ })).toBeInTheDocument()
  })

  it('viewerEmail 没传时（旧调用方漏传）不炸——WhatsAppReply 拿到的是 null，不是 undefined 造成崩溃', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ conversationId: null }) }))
    expect(() => draw({ viewerEmail: undefined })).not.toThrow()
  })
})
