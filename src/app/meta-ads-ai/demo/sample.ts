import type { ReportAnalysis } from '../[clientId]/ReportView'
import {
  toClientFinding,
  renderRuleSection,
  shiftDay,
  type ClientRuleFinding,
  type RuleSectionInput,
} from '@/lib/ads-strategy/rules/client-copy'
import type { RuleFinding } from '@/lib/ads-strategy/rules/patrol-findings'
import { buildRuleCards } from '@/lib/meta/ai/rule-cards'

/** 在 YYYY-MM-DD 上加 n 天（复用 client-copy 的 shiftDay）。 */
export function localDayOffset(today: string, n: number): string {
  return shiftDay(today, n)
}

const CAMPAIGNS = [
  { campaign_name: '秋季补水套餐 · 预约表单', spend: 450, impressions: 24000, clicks: 360 },
  { campaign_name: '皮肤管理咨询 · 私信', spend: 200, impressions: 12000, clicks: 180 },
  { campaign_name: '玻尿酸护理 · 短视频', spend: 50, impressions: 6000, clicks: 60 },
]

const COMPARISON = {
  spend: { current: 700, previous: 680, percent_change: 2.9 },
  impressions: { current: 42000, previous: 40000, percent_change: 5 },
  clicks: { current: 600, previous: 540, percent_change: 11.1 },
  ctr: { current: 0.0143, previous: 0.0135, percent_change: 5.9 },
  reach: { current: 15000, previous: 14500, percent_change: 3.4 },
  frequency: { current: 2.8, previous: 2.76, percent_change: 1.4 },
}

const DAILY_SPEND = [110, 105, 100, 98, 96, 95, 96]
const DAILY_IMPRESSIONS = [6600, 6300, 6000, 5880, 5760, 5700, 5760]
const DAILY_CLICKS = [94, 90, 86, 84, 82, 82, 82]

const PLACEMENTS = [
  { publisher_platform: 'facebook', platform_position: 'feed', spend: 380, impressions: 22000, clicks: 400 },
  { publisher_platform: 'instagram', platform_position: 'story', spend: 180, impressions: 12000, clicks: 110 },
  { publisher_platform: 'instagram', platform_position: 'reels', spend: 100, impressions: 6000, clicks: 70 },
  { publisher_platform: 'audience_network', platform_position: 'classic', spend: 40, impressions: 2000, clicks: 20 },
]

const AGE_GENDER = [
  { age: '25-34', gender: 'female', spend: 70 },
  { age: '25-34', gender: 'male', spend: 40 },
  { age: '35-44', gender: 'female', spend: 90 },
  { age: '35-44', gender: 'male', spend: 50 },
  { age: '45-54', gender: 'female', spend: 180 },
  { age: '45-54', gender: 'male', spend: 70 },
  { age: '55-64', gender: 'female', spend: 150 },
  { age: '55-64', gender: 'male', spend: 50 },
]

const DEVICES = [
  { device_platform: 'mobile_app', spend: 610 },
  { device_platform: 'desktop', spend: 90 },
]

const REGIONS = [{ country: 'NZ', spend: 700 }]

function dailyCampaigns(windowSince: string) {
  return DAILY_SPEND.map((spend, index) => ({
    date_start: localDayOffset(windowSince, index),
    spend,
    impressions: DAILY_IMPRESSIONS[index],
    clicks: DAILY_CLICKS[index],
  }))
}

function demoFindings(dataDate: string): ClientRuleFinding[] {
  const raw: RuleFinding[] = [
    {
      code: 'D10',
      status: 'hit',
      title: '点进来之后留下联系方式的比例下降',
      clientVisible: true,
      units: [{ level: 'ad', id: 'demo-ad-1', name: '秋季补水套餐 · 预约表单 · 第 2 版' }],
      evidence: {
        core_metric: 'lead',
        baseline_source: 'own_history',
        base_rate: 0.16,
        recent_rate: 0.07,
        base_cost_per_result: 15,
        recent_cost_per_result: 32,
        recent_spend: 96,
      },
    },
    {
      code: 'D2',
      status: 'hit',
      title: '看到广告后点进来的人变少',
      clientVisible: true,
      units: [{ level: 'ad', id: 'demo-ad-2', name: '玻尿酸护理 · 短视频 A' }],
      evidence: {
        base_rate: 0.014,
        recent_rate: 0.008,
        frequency_7d: 1.6,
        fatigue_kind: 'creative',
        recent_spend: 21,
      },
    },
  ]
  const opts = { currency: 'NZD', dataDate, campaignFrequency: () => null }
  return raw
    .map((f) => toClientFinding(f, opts))
    .filter((f): f is ClientRuleFinding => f !== null)
}

function reportSections(section: RuleSectionInput): string[] {
  return [
    '一、总体结果\n这 7 天一共花了 NZ$700，广告被看到约 42,000 次，看到的人约 15,000 位，平均每人看到接近 3 次。一共被点击 600 次，点击率约 1.4%，比前 7 天略高。30 人留下联系方式，20 人发来私信，平均每位咨询花 NZ$13，比前 7 天便宜 NZ$2。',
    '二、广告系列效率排行\n私信咨询系列每带来一位咨询只要 NZ$10，是这周效率最高的；预约表单系列花得最多（NZ$450），每位 NZ$15；短视频系列这周主要是让更多人看到，花了 NZ$50，不算咨询成本。',
    renderRuleSection(section),
    '四、广告出现的位置\nFacebook 动态花了一半多一点，点击率约 1.8%，是效果最好的位置；Instagram 快拍的点击率只有它的一半左右；Meta 合作的其它 App 只占不到一成花费，影响不大。',
    '五、视频表现\n看过短视频的人里，约四成看到了一半，约一成半看完了整条。开头几秒留住人的效果还可以。',
    '六、受众\n近一半花费（约 47%）落在 45 岁以上的女性身上，但留下联系方式和发私信的人大多在 25 到 44 岁之间。',
    '七、每日趋势\n每天花费比较平稳，在 NZ$95 到 NZ$110 之间；点击率每天都在 1.4% 左右，很稳定。',
    '八、三条可以考虑的方向\n1. 私信咨询系列每位只要 NZ$10，比预约表单便宜三分之一，可以和团队商量往它多放一些预算。\n2. Instagram 快拍的点击率只有 Facebook 动态的一半，可以考虑专门做一版竖屏的图片或视频。\n3. 近一半花费落在 45 岁以上女性身上，但咨询大多来自 25 到 44 岁，可以把重点人群往年轻一些调。',
  ]
}

export function demoAnalysis(today: string): ReportAnalysis {
  const windowUntil = localDayOffset(today, -1)
  const windowSince = localDayOffset(today, -7)
  const findings = demoFindings(windowUntil)
  const section: RuleSectionInput = {
    source: 'patrol',
    dataDate: windowUntil,
    adsChecked: 12,
    findings,
  }
  const reportText = reportSections(section).join('\n\n')
  const { cards, report } = buildRuleCards(section, reportText, today)
  const evidence = {
    campaigns: CAMPAIGNS,
    comparison: COMPARISON,
    daily_campaigns: dailyCampaigns(windowSince),
    placements: PLACEMENTS,
    age_gender: AGE_GENDER,
    devices: DEVICES,
    regions: REGIONS,
    rule_cards: cards,
  }
  return {
    id: 'demo',
    status: 'completed',
    ad_account_id: '示例账户',
    window_since: windowSince,
    window_until: windowUntil,
    report_markdown: report,
    error_code: null,
    created_at: `${today}T01:00:00Z`,
    completed_at: `${today}T01:00:00Z`,
    evidence,
  }
}
