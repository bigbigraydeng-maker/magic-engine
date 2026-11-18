import { dedicatedApprovalEntryFor } from '@/lib/kernel/dedicated-approval-entries'
import { ADS_AUTO_PAUSE_ACTION_KEY } from '@/lib/action-submission/ads-auto-pause-key'
import { industryFeatureFlags } from '@/lib/clients/industry-features'
import { homeEntryVisible, type ViewerFacts } from '@/lib/auth/home-entries'
import type { NavItem, NavSection } from './nav-active'

function autoPausePath(clientId: string): string {
  const entry = dedicatedApprovalEntryFor(ADS_AUTO_PAUSE_ACTION_KEY)
  return entry ? entry.path(clientId) : `/dashboard/clients/${encodeURIComponent(clientId)}/ads-health`
}

export function buildClientFdeSections(
  clientId: string,
  industry: string | null,
  facts: ViewerFacts,
  goalHref: string,
): NavSection[] {
  const at = (p: string) => `/dashboard/clients/${clientId}${p}`
  const feat = industryFeatureFlags(industry)

  const industryTools: NavItem[] = [
    ...(feat.tour_catalog
      ? [{ key: 'tour-catalog', label: '线路库', mark: '线', href: at('/tour-catalog') }]
      : []),
    ...(feat.tailor_made
      ? [{ key: 'tailor-made', label: '定制行程', mark: '程', href: at('/tailor-made') }]
      : []),
    ...(feat.agents ? [{ key: 'agents', label: '同行渠道', mark: '渠', href: at('/agents') }] : []),
    ...(feat.business_calculator && homeEntryVisible(facts, 'business-calculator')
      ? [{ key: 'business-calculator', label: '生意计算器', mark: '算', href: at('/business-calculator') }]
      : []),
    ...(feat.projects ? [{ key: 'projects', label: '楼盘', mark: '盘', href: at('/projects') }] : []),
    ...(feat.listings ? [{ key: 'listings', label: '房子', mark: '房', href: at('/listings') }] : []),
  ]

  const internalItems: NavItem[] = [
  ]
  internalItems.push({
    key: 'operating-agent',
    label: '经营 Agent',
    mark: '经',
    href: at('/operating-agent'),
  })
  if (homeEntryVisible(facts, 'memory')) {
    internalItems.push({
      key: 'memory',
      label: '客户记忆库',
      mark: '忆',
      href: at('/memory'),
      badge: 'fde',
    })
  }
  internalItems.push({
    key: 'knowledge',
    label: '客户知识库审核',
    mark: '审',
    href: at('/knowledge'),
    badge: 'fde',
  })
  internalItems.push({
    key: 'production',
    label: '生产包',
    mark: '包',
    href: at('/production'),
  })

  const contentItems: NavItem[] = [
    { key: 'daily-plan', label: '社媒每日计划', mark: '社', href: at('/daily-plan') },
    { key: 'blog', label: '博客', mark: '博', href: at('/blog') },
    { key: 'assets', label: '素材库', mark: '材', href: at('/assets') },
    { key: 'documents', label: '资料库', mark: '资', href: at('/documents') },
    { key: 'content-factory', label: '内容工厂', mark: '厂', href: at('/content-factory') },
    ...(homeEntryVisible(facts, 'factory-clips')
      ? [{ key: 'factory-clips', label: '出片', mark: '片', href: at('/factory-clips') }]
      : []),
  ]
  if (homeEntryVisible(facts, 'story')) {
    contentItems.push({
      key: 'story',
      label: 'Story 自动发布',
      mark: 'St',
      href: at('/story'),
      badge: 'admin',
    })
  }

  const adsItems: NavItem[] = [
    { key: 'ads-health', label: '广告健康', mark: '健', href: at('/ads-health') },
    { key: 'promo-plan', label: '推广计划', mark: '推', href: at('/promo-plan') },
  ]
  if (homeEntryVisible(facts, 'ad-approval')) {
    adsItems.push({
      key: 'ad-approval',
      label: '等你点头的广告',
      mark: '批',
      href: '/dashboard/ad-approval',
    })
  }
  adsItems.push(
    { key: 'auto-pause', label: '自动暂停', mark: '停', href: autoPausePath(clientId) },
    { key: 'goals', label: '目标', mark: '标', href: goalHref },
    { key: 'prescription', label: '处方', mark: '方', href: at('/prescription/new') },
    { key: 'marketing-plan', label: '营销计划', mark: '营', href: at('/marketing-plan') },
    { key: 'strategy', label: '策略', mark: '策', href: at('/strategy') },
  )

  const sections: NavSection[] = [
    {
      title: '常用',
      items: [
        { key: 'client-home', label: '概览', mark: '览', href: at('') },
        { key: 'confirmation-cards', label: '确认卡', mark: '卡', href: at('/confirmation-cards') },
        { key: 'execution', label: '任务', mark: '任', href: at('/execution') },
      ],
    },
    { title: '广告与推广', items: adsItems },
    { title: '内容', items: contentItems },
    {
      title: '客人',
      items: [
        { key: 'crm', label: '客人跟进', mark: '跟', href: at('/crm/all') },
        { key: 'contacts', label: '我的客人', mark: '客', href: at('/contacts') },
      ],
    },
  ]

  if (industryTools.length > 0) {
    const industryLabel =
      feat.listings || feat.projects
        ? '行业工具 · 地产'
        : feat.tour_catalog || feat.tailor_made || feat.agents
          ? '行业工具 · 旅游'
          : '行业工具'
    sections.push({ title: industryLabel, items: industryTools })
  }

  sections.push({
    title: '诊断',
    items: [
      { key: 'zhangqian', label: '品牌扫描', mark: '品', href: at('/zhangqian') },
      { key: 'site-audit', label: '网站体检', mark: '站', href: at('/site-audit/pages') },
      { key: 'seo-gap', label: 'SEO 机会', mark: 'SE', href: at('/seo-gap') },
    ],
  })

  if (internalItems.length > 0) {
    sections.push({ title: '更多 · 内部', items: internalItems })
  }

  sections.push({
    title: '设置',
    items: [
      { key: 'settings', label: '资料与连接', mark: '设', href: at('/settings?tab=connect') },
    ],
  })

  return sections
}
