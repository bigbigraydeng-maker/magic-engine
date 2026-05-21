/**
 * Tests for buildLubanSystemPrompt and the enrichment context sections.
 *
 * Strategy: test the public surface (buildLubanSystemPrompt) with varying
 * LubanContext shapes — full data, null/empty degradation, partial data.
 */

import { describe, it, expect } from 'vitest'
import { buildLubanSystemPrompt, type LubanContext, type DiagnosticFindingLite } from '../prompts'
import type { ExecutionItem, ExecutionLog } from '@/types/diagnostic'
import type { DiscoveryReport } from '@/lib/zhangqian/types'
import type { MasterBrief, CampaignBrief } from '@/types/magic-engine'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeItem(overrides?: Partial<ExecutionItem>): ExecutionItem {
  return {
    id: 'item-1',
    prescription_id: 'presc-1',
    client_id: 'client-1',
    finding_id: null,
    dimension: 'social',
    phase: 1,
    title: 'Facebook 高频内容重启',
    description: '每周发布 3-4 条内容，利用 1653 粉丝基础提升互动',
    fix_type: 'fde_manual',
    status: 'pending',
    steps_json: { estimated_hours: 2, required_skills: ['copywriting'], measurement_method: '互动率', module: 'social_matrix' },
    execution_target: null,
    assigned_to: null,
    due_date: null,
    started_at: null,
    completed_at: null,
    sort_order: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    content_post_id: null,
    ...overrides,
  }
}

function makeBaseCtx(overrides?: Partial<LubanContext>): LubanContext {
  return {
    item: makeItem(),
    prescriptionSummary: '先修复社媒发布频率，再建 SEO 基础',
    phaseName: 'Phase 1 — 即时修复',
    businessName: 'CTS Tours NZ',
    industry: 'Travel / Group Tours',
    crisisType: 'TYPE_C 社媒沉默',
    recentLogs: [],
    discovery: null,
    masterBrief: null,
    activeCampaigns: [],
    dimensionScores: null,
    topFindings: [],
    ...overrides,
  }
}

const FULL_DISCOVERY: DiscoveryReport = {
  schema_version: 1,
  domain: 'ctstours.co.nz',
  business: {
    name: 'CTS Tours NZ',
    industry: ['Travel', 'Group Tours'],
    location: { city: 'Auckland', region: null, country: 'NZ' },
    description: '98-year-old China travel specialist',
    target_audience: ['NZ travellers', 'Chinese diaspora'],
    unique_selling_points: ['98 years history', 'specialist in China'],
    confidence: 0.95,
  },
  social_profiles: [
    { platform: 'facebook', handle: 'CTSToursNZ', url: 'https://fb.com/CTSToursNZ', confidence: 0.9, followers_count: 1653, posts_last_30d: 2, engagement_rate: 0.018 },
  ],
  gbp: { place_id: 'abc', business_name: 'CTS Tours NZ', address: 'Auckland', rating: 4.2, review_count: 38, google_maps_url: null, confidence: 0.9 },
  review_platforms: [
    { platform: 'google', url: 'https://g.co/...', rating: 4.2, review_count: 38 },
    { platform: 'tripadvisor', url: 'https://ta.com/...', rating: 4.5, review_count: 12 },
  ],
  seed_keywords: [
    { keyword: 'china tour nz', type: 'category', rationale: 'core', semrush_rank: 3, semrush_volume: 320, semrush_kd: 22 },
    { keyword: 'beijing tour packages', type: 'category', rationale: 'core', semrush_rank: 7, semrush_volume: 140, semrush_kd: 35 },
  ],
  competitors: [],
  ai_tracker_questions: [],
  notes: '',
  semrush_snapshot: {
    monthly_traffic: 1200,
    trust_score: 42,
    keyword_count: 87,
    top_keywords: [
      { keyword: 'china tour nz', position: 3, volume: 320 },
      { keyword: 'beijing tour', position: 11, volume: 210 },
    ],
  },
  ai_visibility_results: [
    { question: 'best China tour from NZ', top_brands: ['ChinaHighlights', 'UTour'], client_mentioned: false },
    { question: 'China group tours New Zealand', top_brands: ['UTour', 'DragonTrail'], client_mentioned: false },
    { question: 'CTS Tours review', top_brands: ['CTS Tours NZ'], client_mentioned: true },
  ],
  meta: { model: 'claude-sonnet-4-5', tool_calls: 10, cost_usd: 0.05, duration_ms: 5000, truncated: false },
}

const FULL_BRIEF: Partial<MasterBrief> = {
  id: 'brief-1',
  client_id: 'client-1',
  version: 1,
  status: 'active',
  brand_name: 'CTS Tours NZ',
  tone: '专业温暖',
  avoid_words: ['便宜', '低价'],
  platforms: ['Facebook', 'Instagram'],
  content_pillars: [
    { id: 'travel', name: '旅行灵感', description: '目的地故事', post_ratio: 0.4, content_types: ['image', 'video'] },
    { id: 'tips', name: '实用攻略', description: '签证/行程', post_ratio: 0.3, content_types: ['text'] },
  ],
  platform_strategy: {
    facebook: { enabled: true, post_frequency: '4x/week', primary_content_type: 'image+caption' },
    instagram: { enabled: false, post_frequency: '2x/week', primary_content_type: 'reels' },
  },
  brand_voice: {
    tone_keywords: ['温暖', '专业', '可信赖'],
    avoid_keywords: ['便宜', '折扣'],
    formality: 'neutral',
    emoji_usage: 'minimal',
  },
} as MasterBrief

const FULL_CAMPAIGN: Partial<CampaignBrief> = {
  id: 'camp-1',
  client_id: 'client-1',
  title: 'Silk Road Summer 2027',
  description: '丝路夏季团体游推广',
  status: 'active',
  valid_from: '2026-06-01',
  valid_until: '2026-08-31',
  offer: '早鸟立减 $500，限前 20 名',
  primary_cta: '立即预订',
  campaign_angle: '98 年品牌，丝路首选',
} as CampaignBrief

const FULL_FINDINGS: DiagnosticFindingLite[] = [
  {
    dimension: 'social',
    severity: 'high',
    title: '发帖频率严重不足',
    description: '近30天仅发布 2 条内容，行业建议每周 3-4 条。受众流失风险高。',
    recommendation: '立即建立每周内容排期，优先图文类内容。',
  },
  {
    dimension: 'social',
    severity: 'medium',
    title: '互动率低于行业基准',
    description: '当前互动率 1.8%，旅游行业基准为 3-4%。',
    recommendation: '增加互动型内容（投票、问答、旅行故事征集）。',
  },
]

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('buildLubanSystemPrompt', () => {
  describe('基础结构', () => {
    it('始终包含执行项标题和说明', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx())
      expect(prompt).toContain('Facebook 高频内容重启')
      expect(prompt).toContain('每周发布 3-4 条内容')
    })

    it('包含处方摘要和客户背景', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx())
      expect(prompt).toContain('先修复社媒发布频率')
      expect(prompt).toContain('CTS Tours NZ')
      expect(prompt).toContain('TYPE_C 社媒沉默')
    })

    it('包含四个新 section 的标题', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx())
      expect(prompt).toContain('## 张骞发现的客观数据')
      expect(prompt).toContain('## 客户品牌约束')
      expect(prompt).toContain('## 当前推广活动')
      expect(prompt).toContain('## 华佗诊断明细')
    })

    it('包含内容创作约束指令', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx())
      expect(prompt).toContain('内容创作必须有据可依')
      expect(prompt).toContain('数据驱动')
      expect(prompt).toContain('品牌遵守')
      expect(prompt).toContain('Campaign 对齐')
    })

    it('包含执行维度中文名', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx())
      expect(prompt).toContain('社媒运营')
    })
  })

  describe('张骞发现 section — 降级路径', () => {
    it('discovery 为 null 时输出降级文案', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx({ discovery: null }))
      expect(prompt).toContain('张骞发现数据暂未完成')
    })
  })

  describe('张骞发现 section — 全量数据', () => {
    it('包含 SEMrush 流量数据', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx({ discovery: FULL_DISCOVERY }))
      expect(prompt).toContain('1,200')
      expect(prompt).toContain('42/100')
      expect(prompt).toContain('87')
    })

    it('包含 GBP 评分和评论数', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx({ discovery: FULL_DISCOVERY }))
      expect(prompt).toContain('4.2/5 星')
      expect(prompt).toContain('38 条评价')
    })

    it('包含评论平台列表', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx({ discovery: FULL_DISCOVERY }))
      expect(prompt).toContain('google')
      expect(prompt).toContain('tripadvisor')
    })

    it('包含社媒档案粉丝数', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx({ discovery: FULL_DISCOVERY }))
      expect(prompt).toContain('1,653 粉丝')
    })

    it('AI 可见度缺口只显示未被提及的问句', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx({ discovery: FULL_DISCOVERY }))
      expect(prompt).toContain('best China tour from NZ')
      expect(prompt).toContain('China group tours New Zealand')
      // 第三条 client_mentioned=true，不应出现在缺口列表
      expect(prompt).not.toContain('CTS Tours review')
    })

    it('包含核心关键词排名', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx({ discovery: FULL_DISCOVERY }))
      expect(prompt).toContain('china tour nz')
      expect(prompt).toContain('排名 #3')
    })
  })

  describe('Master Brief section — 降级路径', () => {
    it('masterBrief 为 null 时输出降级文案', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx({ masterBrief: null }))
      expect(prompt).toContain('Master Brief 尚未建立')
    })
  })

  describe('Master Brief section — 全量数据', () => {
    it('包含品牌名和语气', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx({ masterBrief: FULL_BRIEF as MasterBrief }))
      expect(prompt).toContain('CTS Tours NZ')
      expect(prompt).toContain('专业温暖')
    })

    it('包含禁忌词', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx({ masterBrief: FULL_BRIEF as MasterBrief }))
      expect(prompt).toContain('便宜')
      expect(prompt).toContain('低价')
    })

    it('包含内容支柱', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx({ masterBrief: FULL_BRIEF as MasterBrief }))
      expect(prompt).toContain('旅行灵感')
      expect(prompt).toContain('实用攻略')
      expect(prompt).toContain('40%')
    })

    it('包含平台策略（只显示 enabled 的平台）', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx({ masterBrief: FULL_BRIEF as MasterBrief }))
      expect(prompt).toContain('facebook')
      expect(prompt).toContain('4x/week')
      // instagram 是 disabled，不应出现在平台策略里
      // (brand_voice 里的 emoji 行为仍可出现)
    })

    it('包含结构化 brand voice', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx({ masterBrief: FULL_BRIEF as MasterBrief }))
      expect(prompt).toContain('语气关键词：温暖，专业，可信赖')
      expect(prompt).toContain('语气禁忌词：便宜，折扣')
      expect(prompt).toContain('neutral')
    })
  })

  describe('Campaign section — 降级路径', () => {
    it('无活动时输出降级文案', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx({ activeCampaigns: [] }))
      expect(prompt).toContain('当前无进行中的推广活动')
    })
  })

  describe('Campaign section — 有活动', () => {
    it('包含活动标题和优惠', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx({ activeCampaigns: [FULL_CAMPAIGN as CampaignBrief] }))
      expect(prompt).toContain('Silk Road Summer 2027')
      expect(prompt).toContain('早鸟立减 $500')
    })

    it('超过 MAX_CAMPAIGNS 时显示剩余数量提示', () => {
      const many = Array.from({ length: 4 }, (_, i) => ({
        ...FULL_CAMPAIGN,
        id: `camp-${i}`,
        title: `Campaign ${i}`,
      } as CampaignBrief))
      const prompt = buildLubanSystemPrompt(makeBaseCtx({ activeCampaigns: many }))
      expect(prompt).toContain('另有')
      expect(prompt).toContain('个推广活动未展开')
    })
  })

  describe('华佗诊断 section — 降级路径', () => {
    it('无分数时输出降级文案', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx({ dimensionScores: null, topFindings: [] }))
      expect(prompt).toContain('诊断尚未完成')
    })

    it('无 findings 时不输出 findings 区块', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx({
        dimensionScores: { social: 38, seo: 62 },
        topFindings: [],
      }))
      expect(prompt).not.toContain('华佗诊断发现的具体问题')
    })
  })

  describe('华佗诊断 section — 全量数据', () => {
    it('包含低分维度并标注警告', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx({
        dimensionScores: { social: 38, seo: 62, ai_visibility: 45, ads: 55 },
        topFindings: [],
      }))
      expect(prompt).toContain('38')
      expect(prompt).toContain('⚠️')
    })

    it('包含 findings 标题和建议', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx({
        dimensionScores: { social: 38 },
        topFindings: FULL_FINDINGS,
      }))
      expect(prompt).toContain('发帖频率严重不足')
      expect(prompt).toContain('立即建立每周内容排期')
      expect(prompt).toContain('互动率低于行业基准')
    })

    it('过长的 description 被截断', () => {
      const longDesc = 'A'.repeat(300)
      const findings: DiagnosticFindingLite[] = [{
        dimension: 'social',
        severity: 'high',
        title: '测试截断',
        description: longDesc,
        recommendation: '修复方法',
      }]
      const prompt = buildLubanSystemPrompt(makeBaseCtx({
        dimensionScores: { social: 30 },
        topFindings: findings,
      }))
      // Should contain truncated description with ellipsis
      expect(prompt).toContain('…')
      // Full 300-char string should not appear
      expect(prompt).not.toContain(longDesc)
    })
  })

  describe('工作记录', () => {
    it('有工作记录时正确显示', () => {
      const logs: ExecutionLog[] = [{
        id: 'log-1',
        execution_item_id: 'item-1',
        client_id: 'client-1',
        author: 'fde',
        kind: 'note',
        content: '已联系客户确认发帖方向',
        meta: null,
        created_at: '2026-01-01T00:00:00Z',
      }]
      const prompt = buildLubanSystemPrompt(makeBaseCtx({ recentLogs: logs }))
      expect(prompt).toContain('已联系客户确认发帖方向')
      expect(prompt).toContain('FDE')
    })

    it('无工作记录时输出提示', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx({ recentLogs: [] }))
      expect(prompt).toContain('暂无工作记录')
    })
  })

  describe('全量上下文集成', () => {
    it('所有四类数据同时注入时，prompt 包含全部关键信息', () => {
      const prompt = buildLubanSystemPrompt(makeBaseCtx({
        discovery:       FULL_DISCOVERY,
        masterBrief:     FULL_BRIEF as MasterBrief,
        activeCampaigns: [FULL_CAMPAIGN as CampaignBrief],
        dimensionScores: { social: 38, seo: 62 },
        topFindings:     FULL_FINDINGS,
      }))

      // Discovery
      expect(prompt).toContain('SEMrush')
      expect(prompt).toContain('1,653 粉丝')
      // Brief
      expect(prompt).toContain('旅行灵感')
      // Campaign
      expect(prompt).toContain('Silk Road Summer 2027')
      // Diagnosis
      expect(prompt).toContain('发帖频率严重不足')
      // Hard constraint
      expect(prompt).toContain('内容创作必须有据可依')
    })
  })
})
