/**
 * NAL 私信「有效咨询」判定测试。
 *
 * 🔴 用的是**虚构的合成对话**，不是真实客户对话原文——设计评审明确要求：
 * 判定理由/测试夹具不得摘录真实客户聊天内容（隐私红线，见 PR 评审记录）。
 * 每个用例对应研究报告里标注过的一类真实场景（Dundee/Craig Jager/
 * Rangiora/Lance Searancke/John D NZ 等案例的形状），文字全部改写。
 */

import { describe, it, expect } from 'vitest'
import {
  findCargoDetailHit,
  findNalReplyHit,
  classifyNalConversation,
  nalMessengerSourceRef,
  type InboundMessage,
  type OutboundMessage,
} from '../nal-messenger-lead-classify'

function inbound(messageId: string, body: string, sentAt: string): InboundMessage {
  return { messageId, body, sentAt }
}
function outbound(messageId: string, body: string, sentAt: string): OutboundMessage {
  return { messageId, body, sentAt }
}

describe('findCargoDetailHit', () => {
  it('命中重量信息', () => {
    const hit = findCargoDetailHit([inbound('m1', 'I have 24kg of toys to ship', '2026-08-01T00:00:00Z')])
    expect(hit?.rule).toBe('measure')
  })

  it('命中三维尺寸', () => {
    const hit = findCargoDetailHit([inbound('m1', 'Box size 90*42*82 CM', '2026-08-01T00:00:00Z')])
    expect(hit?.rule).toBe('dimension')
  })

  it('单独的意图词不算——没有度量/地址就不能命中（防「你们做什么业务」类问候）', () => {
    const hit = findCargoDetailHit([inbound('m1', 'Hi, do you provide shipping and freight services?', '2026-08-01T00:00:00Z')])
    expect(hit).toBeNull()
  })

  it('意图词 + 新西兰地址 = 命中（Lance Searancke 案例形状：没给重量但给了地址）', () => {
    const hit = findCargoDetailHit([
      inbound('m1', 'Looking for a freight quote for my shipment', '2026-08-01T00:00:00Z'),
      inbound('m2', 'Deliver to 15 Willcott Street Mt Albert, Auckland 1025', '2026-08-01T00:05:00Z'),
    ])
    expect(hit?.rule).toBe('intent_with_address')
    expect(hit?.messageId).toBe('m2')
  })

  it('否定句不算命中：「不需要海运」不能被判成给了货物信息', () => {
    const hit = findCargoDetailHit([inbound('m1', '我们暂不需要 20kg 这批货的海运服务', '2026-08-01T00:00:00Z')])
    expect(hit).toBeNull()
  })

  it('英文否定句同样不算命中（大小写不敏感）', () => {
    const hit = findCargoDetailHit([inbound('m1', 'Not interested in shipping 30kg right now', '2026-08-01T00:00:00Z')])
    expect(hit).toBeNull()
  })

  it('跨消息的短句拼接也能找到货物信息（Dundee 案例形状：一句话拆好几条发）', () => {
    const hit = findCargoDetailHit([
      inbound('m1', 'Hi there', '2026-08-01T00:00:00Z'),
      inbound('m2', 'I need a freight quote', '2026-08-01T00:01:00Z'),
      inbound('m3', 'Send to 85a Hobsonville Point Road Auckland 0616', '2026-08-01T00:02:00Z'),
    ])
    expect(hit?.rule).toBe('intent_with_address')
  })
})

describe('findNalReplyHit', () => {
  const after = '2026-08-01T00:00:00Z'

  it('命中真实报价数字', () => {
    const hit = findNalReplyHit(
      [outbound('r1', 'Your shipping cost is NZD 136 for this shipment', '2026-08-01T01:00:00Z')],
      after,
    )
    expect(hit?.rule).toBe('real_quote')
  })

  it('命中仓库码/收货地址分配', () => {
    const hit = findNalReplyHit(
      [outbound('r1', 'Your warehouse code is TJJ28967', '2026-08-01T01:00:00Z')],
      after,
    )
    expect(hit?.rule).toBe('warehouse_code')
  })

  it('命中「已发送报价」确认话术', () => {
    const hit = findNalReplyHit(
      [outbound('r1', 'We have emailed you the quotation', '2026-08-01T01:00:00Z')],
      after,
    )
    expect(hit?.rule).toBe('quote_sent_phrase')
  })

  it('🔴 通用费率播报模板不算实质回应——十个真实联系人都撞过的坑', () => {
    const hit = findNalReplyHit(
      [
        outbound(
          'r1',
          'Shipping rates • Under 20 kg: NZD 4/kg • 20 kg or more: NZD 2/kg + NZD 12 service fee',
          '2026-08-01T01:00:00Z',
        ),
      ],
      after,
    )
    expect(hit).toBeNull()
  })

  it('模板 + 之后真的给了针对性报价——模板不算，后面那句才算', () => {
    const hit = findNalReplyHit(
      [
        outbound(
          'r1',
          'Shipping rates • Under 20 kg: NZD 4/kg • 20 kg or more: NZD 2/kg + NZD 12 service fee',
          '2026-08-01T01:00:00Z',
        ),
        outbound('r2', 'Your warehouse code is TJJ28967', '2026-08-01T01:05:00Z'),
      ],
      after,
    )
    expect(hit?.messageId).toBe('r2')
  })

  it('系统自动生成的操作日志不算 NAL 说的话', () => {
    const hit = findNalReplyHit(
      [outbound('r1', 'Ben Wang 把这个对话分配给了 Leah Xu，TJJ99999。', '2026-08-01T01:00:00Z')],
      after,
    )
    expect(hit).toBeNull()
  })

  it('只看 after 之后的消息——之前的回复不该算这次咨询的回应', () => {
    const hit = findNalReplyHit(
      [outbound('r1', 'Your warehouse code is TJJ11111', '2026-07-01T00:00:00Z')],
      after,
    )
    expect(hit).toBeNull()
  })
})

describe('classifyNalConversation', () => {
  it('两侧都命中才算：客户给了细节 + NAL 给了实质回应', () => {
    const leads = classifyNalConversation(
      [inbound('m1', 'I have 24kg of RC toy cars to ship', '2026-08-25T11:00:00Z')],
      [outbound('r1', 'Your shipping cost is NZD 136', '2026-08-25T22:00:00Z')],
    )
    expect(leads).toHaveLength(1)
    expect(leads[0].leadMessageId).toBe('m1')
    expect(leads[0].replyMessageId).toBe('r1')
  })

  it('🔴 只有客户给了细节，NAL 还没实质回应——这轮故意不算（John D NZ 反例形状）', () => {
    const leads = classifyNalConversation(
      [inbound('m1', 'I have 30kg to ship', '2026-08-25T11:00:00Z')],
      [outbound('r1', 'We have emailed you the quotation already', '2026-08-20T00:00:00Z')], // 早于咨询，不算回应
    )
    expect(leads).toHaveLength(0)
  })

  it('只有闲聊、没有货物信息——就算 NAL 回了模板报价也不算', () => {
    const leads = classifyNalConversation(
      [inbound('m1', 'Hi, how much does shipping cost?', '2026-08-25T11:00:00Z')],
      [
        outbound(
          'r1',
          'Shipping rates • Under 20 kg: NZD 4/kg • 20 kg or more: NZD 2/kg + NZD 12 service fee',
          '2026-08-25T11:05:00Z',
        ),
      ],
    )
    expect(leads).toHaveLength(0)
  })

  it('同一票货隔多天才回来接着聊——不算第二次咨询（Rangiora 案例形状）', () => {
    const leads = classifyNalConversation(
      [
        inbound('m1', 'Looking to ship a container, 6 tonne of goods', '2026-08-01T00:00:00Z'),
        // 12 天后回来补充细节，同一批货（signalToken 里都含 "6 tonne"）
        inbound('m2', 'Following up — still that 6 tonne shipment, ready now', '2026-08-13T00:00:00Z'),
      ],
      [outbound('r1', 'Your warehouse code is TJJ55555', '2026-08-13T01:00:00Z')],
    )
    expect(leads).toHaveLength(1)
  })

  it('不同批次的货、间隔超过窗口——算两次独立咨询（Craig Jager 案例形状）', () => {
    const leads = classifyNalConversation(
      [
        inbound('m1', 'Shipping a steel garage, 36cbm', '2026-08-24T00:00:00Z'),
        inbound('m2', 'New shipment — a tent, 1800kg this time', '2026-09-08T00:00:00Z'),
      ],
      [
        outbound('r1', 'Your warehouse code is TJJ11111', '2026-08-24T01:00:00Z'),
        outbound('r2', 'Your warehouse code is TJJ22222', '2026-09-08T01:00:00Z'),
      ],
    )
    expect(leads).toHaveLength(2)
    expect(leads[0].leadMessageId).toBe('m1')
    expect(leads[1].leadMessageId).toBe('m2')
  })
})

describe('nalMessengerSourceRef', () => {
  it('幂等键只引用消息 id，不含对话原文', () => {
    expect(nalMessengerSourceRef('contact-1', 'mid.abc123')).toBe('nal_messenger:contact-1:mid.abc123')
  })
})
