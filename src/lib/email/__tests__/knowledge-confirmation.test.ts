/**
 * 确认邀请邮件 + 回执邮件（issue #1646）。
 *
 * 用注入的假发信器断言真正发出去的内容，不碰 Resend。
 */

import { describe, it, expect } from 'vitest'
import {
  CONFIRMATION_QUALITY_ASSURANCE_NOTE,
  CONFIRMATION_RESPONSIBILITY_NOTE,
  sendKnowledgeConfirmationReceipt,
  sendKnowledgeConfirmationRequest,
  type EmailSender,
} from '../knowledge-confirmation'

function captureSender() {
  const sent: Array<{ from: string; to: string; subject: string; text: string; html: string }> = []
  const sender: EmailSender = {
    async send(params) {
      sent.push(params)
      return {}
    },
  }
  return { sent, sender }
}

const CONFIRM_URL = 'https://app.example.com/knowledge-confirm/req-1?token=abc123'

describe('sendKnowledgeConfirmationRequest', () => {
  it('从统一的已验证域名地址发出', async () => {
    const { sent, sender } = captureSender()
    await sendKnowledgeConfirmationRequest(
      {
        to: 'owner@ctstours.co.nz',
        clientName: 'CTS Tours NZ',
        statements: ['20 公斤以下每公斤 NZD 4'],
        confirmUrl: CONFIRM_URL,
        expiresAt: '2026-09-28T00:00:00.000Z',
      },
      { sender },
    )
    expect(sent[0].from).toContain('hello@magicengine.cloud')
    expect(sent[0].to).toBe('owner@ctstours.co.nz')
  })

  it('🔴 §9.10：每条用「AI 以后会这样回复顾客」开头，且按钮旁那句责任说明逐字出现', async () => {
    const { sent, sender } = captureSender()
    await sendKnowledgeConfirmationRequest(
      {
        to: 'owner@ctstours.co.nz',
        clientName: 'CTS Tours NZ',
        statements: ['20 公斤以下每公斤 NZD 4'],
        confirmUrl: CONFIRM_URL,
        expiresAt: '2026-09-28T00:00:00.000Z',
      },
      { sender },
    )
    expect(sent[0].html).toContain('AI 以后会这样回复顾客：20 公斤以下每公斤 NZD 4')
    expect(sent[0].text).toContain(CONFIRMATION_RESPONSIBILITY_NOTE)
    expect(sent[0].html).toContain(CONFIRMATION_RESPONSIBILITY_NOTE)
  })

  it('🔴 §9.10：对客一句话（定心话）逐字出现在邀请邮件里（板桥复审：之前完全没写进去）', async () => {
    const { sent, sender } = captureSender()
    await sendKnowledgeConfirmationRequest(
      {
        to: 'owner@ctstours.co.nz',
        clientName: 'CTS Tours NZ',
        statements: ['20 公斤以下每公斤 NZD 4'],
        confirmUrl: CONFIRM_URL,
        expiresAt: '2026-09-28T00:00:00.000Z',
      },
      { sender },
    )
    expect(sent[0].text).toContain(CONFIRMATION_QUALITY_ASSURANCE_NOTE)
    expect(sent[0].html).toContain(CONFIRMATION_QUALITY_ASSURANCE_NOTE)
  })

  it('说清楚「打开只是看，点按钮才算数」—— 这是 §9.14 A.D 要客户理解的那件事', async () => {
    const { sent, sender } = captureSender()
    await sendKnowledgeConfirmationRequest(
      {
        to: 'owner@ctstours.co.nz',
        clientName: 'CTS',
        statements: ['x'],
        confirmUrl: CONFIRM_URL,
        expiresAt: '2026-09-28T00:00:00.000Z',
      },
      { sender },
    )
    expect(sent[0].text).toContain('打开只是看，点了页面上的按钮才算数')
  })

  it('邮件里不出现任何代码词（fact_key / scope / sensitivity 之类）', async () => {
    const { sent, sender } = captureSender()
    await sendKnowledgeConfirmationRequest(
      {
        to: 'owner@ctstours.co.nz',
        clientName: 'CTS',
        statements: ['20 公斤以下每公斤 NZD 4'],
        confirmUrl: CONFIRM_URL,
        expiresAt: '2026-09-28T00:00:00.000Z',
      },
      { sender },
    )
    const body = `${sent[0].text}\n${sent[0].html}`
    for (const codeWord of ['fact_key', 'scope', 'sensitivity', 'visibility', 'client_confirmed']) {
      expect(body).not.toContain(codeWord)
    }
  })

  it('超过 5 条时只预览 5 条，其余说明「都在确认页上」', async () => {
    const { sent, sender } = captureSender()
    await sendKnowledgeConfirmationRequest(
      {
        to: 'owner@ctstours.co.nz',
        clientName: 'CTS',
        statements: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        confirmUrl: CONFIRM_URL,
        expiresAt: '2026-09-28T00:00:00.000Z',
      },
      { sender },
    )
    expect(sent[0].html).toContain('还有 2 条')
  })

  it('没有链接就不发 —— 一封没法点的确认邮件比不发更糟', async () => {
    const { sent, sender } = captureSender()
    const result = await sendKnowledgeConfirmationRequest(
      { to: 'x@y.com', clientName: 'CTS', statements: ['a'], confirmUrl: '', expiresAt: '2026-09-28T00:00:00.000Z' },
      { sender },
    )
    expect(result.sent).toBe(false)
    expect(sent).toHaveLength(0)
  })

  it('发信器报错时如实返回 sent:false，不吞掉', async () => {
    const failing: EmailSender = { async send() { return { error: 'domain not verified' } } }
    const result = await sendKnowledgeConfirmationRequest(
      { to: 'x@y.com', clientName: 'CTS', statements: ['a'], confirmUrl: CONFIRM_URL, expiresAt: '2026-09-28T00:00:00.000Z' },
      { sender: failing },
    )
    expect(result).toEqual({ sent: false, reason: 'domain not verified' })
  })
})

describe('sendKnowledgeConfirmationReceipt', () => {
  it('三种结果分别写清楚：确认了什么、要改什么、哪几条要重发新链接', async () => {
    const { sent, sender } = captureSender()
    await sendKnowledgeConfirmationReceipt(
      {
        to: 'owner@ctstours.co.nz',
        clientName: 'CTS',
        confirmedStatements: ['20 公斤以下每公斤 NZD 4'],
        changeRequestedStatements: ['空运周五 18:00 截单'],
        needsFreshLinkCount: 2,
        confirmedAt: '2026-09-14T00:00:00.000Z',
      },
      { sender },
    )
    expect(sent[0].text).toContain('你确认了 1 条')
    expect(sent[0].text).toContain('20 公斤以下每公斤 NZD 4')
    expect(sent[0].text).toContain('你提出 1 条需要改')
    expect(sent[0].text).toContain('有 2 条在你打开链接之后我们这边改动过')
  })

  it('一条都没确认时不硬写"你确认了 0 条"', async () => {
    const { sent, sender } = captureSender()
    await sendKnowledgeConfirmationReceipt(
      {
        to: 'owner@ctstours.co.nz',
        clientName: 'CTS',
        confirmedStatements: [],
        changeRequestedStatements: ['x'],
        needsFreshLinkCount: 0,
        confirmedAt: '2026-09-14T00:00:00.000Z',
      },
      { sender },
    )
    expect(sent[0].text).not.toContain('你确认了 0 条')
  })
})
