/**
 * `buildMessengerAgentSystemPrompt` 的基础组装测试(Issue #1580 · v3 改接客户
 * 知识库)。
 *
 * 不在本 issue 的 A 级验证要求清单里(清单只要求 tools.ts 的 ctx 注入测试和
 * 输出契约 schema 测试),但这是新增的纯函数、分支不少(无 brief / 空知识库 /
 * 空对话历史),按 coding-style.md「行为变更要配回归测试」顺手补上。
 */

import { describe, it, expect } from 'vitest'
import { buildMessengerAgentSystemPrompt } from '../prompt'
import type { MasterBrief } from '@/types/magic-engine'
import type { KnowledgeEntry } from '@/lib/knowledge'

function fact(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: 'fact-1',
    clientId: 'c0000000-0000-0000-0000-000000000000',
    factKey: 'tour.active.golden-china',
    scope: {},
    statement: 'Golden China tour',
    structuredValue: { code: 'golden-china', price_nzd: 4999 },
    conflictGroupId: null,
    status: 'approved',
    visibility: 'customer_ok',
    sensitivity: 'price',
    validFrom: '2026-09-01T00:00:00Z',
    validUntil: null,
    lastVerifiedAt: null,
    approvedByEmail: 'ray@magicengine.cloud',
    approvedAt: '2026-09-01T00:00:00Z',
    clientConfirmedByEmail: 'client@ctstours.co.nz',
    clientConfirmedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

describe('buildMessengerAgentSystemPrompt', () => {
  it('没有 brief 时明确提示不要编造品牌信息，而不是留空', () => {
    const prompt = buildMessengerAgentSystemPrompt({
      brief: null,
      customerFacingFacts: [],
      brandFacts: [],
      conversationHistory: [],
    })
    expect(prompt).toContain('不要编造')
  })

  it('没有任何已确认商业事实时明确提示不要报价/说团期', () => {
    const prompt = buildMessengerAgentSystemPrompt({
      brief: null,
      customerFacingFacts: [],
      brandFacts: [],
      conversationHistory: [],
    })
    expect(prompt).toContain('不要向客户报价')
  })

  it('包含知识库里的已确认商业事实(fact_key + 正文)', () => {
    const prompt = buildMessengerAgentSystemPrompt({
      brief: null,
      customerFacingFacts: [
        fact({ factKey: 'tour.active.golden-china', statement: 'Golden China tour departs 2026-11-16, NZ$4999' }),
      ],
      brandFacts: [],
      conversationHistory: [],
    })
    expect(prompt).toContain('tour.active.golden-china')
    expect(prompt).toContain('4999')
  })

  it('包含品牌/公司事实', () => {
    const prompt = buildMessengerAgentSystemPrompt({
      brief: null,
      customerFacingFacts: [],
      brandFacts: [fact({ factKey: 'company.years_operating', sensitivity: 'general', statement: 'Operated in NZ for 25 years' })],
      conversationHistory: [],
    })
    expect(prompt).toContain('Operated in NZ for 25 years')
  })

  it('硬闸文案要求对查不到的产品当作未知交给人工，不是假设已下架', () => {
    const prompt = buildMessengerAgentSystemPrompt({
      brief: null,
      customerFacingFacts: [],
      brandFacts: [],
      conversationHistory: [],
    })
    expect(prompt).toContain('一律当作"未知"处理')
  })

  it('空对话历史时说明"第一条消息"，而不是留空段落', () => {
    const prompt = buildMessengerAgentSystemPrompt({
      brief: null,
      customerFacingFacts: [],
      brandFacts: [],
      conversationHistory: [],
    })
    expect(prompt).toContain('第一条消息')
  })

  it('包含对话历史里的正文', () => {
    const prompt = buildMessengerAgentSystemPrompt({
      brief: null,
      customerFacingFacts: [],
      brandFacts: [],
      conversationHistory: [
        { direction: 'inbound', senderName: 'Alice', body: '请问 Silk Road 团还能订吗', sentAt: '2026-09-13T00:00:00Z' },
      ],
    })
    expect(prompt).toContain('请问 Silk Road 团还能订吗')
  })

  it('硬闸文案里包含输出契约的三个字段名', () => {
    const prompt = buildMessengerAgentSystemPrompt({
      brief: null,
      customerFacingFacts: [],
      brandFacts: [],
      conversationHistory: [],
    })
    expect(prompt).toContain('reply_text')
    expect(prompt).toContain('confidence')
    expect(prompt).toContain('offerings')
  })

  it('有 brief 时使用 formatBriefForPrompt 的输出（品牌名会出现）', () => {
    const brief: MasterBrief = {
      id: 'brief-1',
      client_id: 'client-1',
      version: 1,
      status: 'active',
      brand_name: 'CTS Tours NZ',
    }
    const prompt = buildMessengerAgentSystemPrompt({
      brief,
      customerFacingFacts: [],
      brandFacts: [],
      conversationHistory: [],
    })
    expect(prompt).toContain('CTS Tours NZ')
  })
})
