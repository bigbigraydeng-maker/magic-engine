'use client'

import Link from 'next/link'
import { dedicatedApprovalEntryFor } from '@/lib/kernel/dedicated-approval-entries'
import { ADS_AUTO_PAUSE_ACTION_KEY } from '@/lib/action-submission/ads-auto-pause-key'
import { industryFeatureFlags } from '@/lib/clients/industry-features'
import type { HomeEntry } from '@/lib/auth/home-entries'
import { prescriptionEntryHref } from '../prescription-entry'
import { BriefGateBanner } from './BriefGateBanner'
import type { Client } from './client-types'
import type { PrescriptionStatus } from './NextStepCard'
import { cx } from '@/components/ui/me-theme'

type ToolBadge = 'in_house' | 'external'

const BADGE_CONFIG: Record<ToolBadge, { label: string; cls: string }> = {
  in_house: { label: '系统内', cls: 'bg-me-ochre/10 text-me-ochre border-me-ochre/20' },
  external: { label: '外部执行', cls: 'bg-me-ochre/10 text-me-ochre border-me-ochre/20' },
}

function ToolCard({
  href, onClick, title, desc, badge, soon, compact,
}: {
  href?: string
  onClick?: () => void
  title: string
  desc: string
  badge: ToolBadge
  soon?: boolean
  compact?: boolean
}) {
  const b = BADGE_CONFIG[badge]
  const interactive = !soon && (!!href || !!onClick)
  const inner = (
    <div className={cx(
      'flex items-center gap-3 rounded-xl border bg-white transition-all',
      compact ? 'p-3' : 'p-4',
      soon ? 'cursor-not-allowed border-dashed border-black/10 opacity-60'
        : interactive ? 'group cursor-pointer border-black/10 hover:border-me-ochre/40 hover:shadow-sm'
          : 'border-black/10',
    )}>
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-me-charcoal text-[10px] font-black text-white">
        {title.slice(0, 2).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <motionDiv className="mb-0.5 flex flex-wrap items-center gap-2">
          <p className="text-sm font-black text-me-charcoal">{title}</p>
          <span className={cx('rounded-full border px-1.5 py-0.5 text-[10px] font-bold leading-none', b.cls)}>{b.label}</span>
          {soon && <span className="rounded-full bg-me-ivory px-1.5 py-0.5 text-[10px] font-bold text-me-charcoal/45">Soon</span>}
        </motionDiv>
        {!compact && <p className="text-xs font-semibold text-me-charcoal/55">{desc}</p>}
      </div>
      {interactive && <span className="flex-shrink-0 text-me-charcoal/35 group-hover:text-me-ochre">→</span>}
    </div>
  )
  if (href && !soon) return <Link href={href}>{inner}</Link>
  if (onClick && !soon) return <button type="button" className="w-full text-left" onClick={onClick}>{inner}</button>
  return inner
}

type SubLink = { label: string; href?: string; onClick?: () => void }

function autoPauseHref(clientId: string): string {
  const entry = dedicatedApprovalEntryFor(ADS_AUTO_PAUSE_ACTION_KEY)
  return entry ? entry.path(clientId) : `/dashboard/clients/${encodeURIComponent(clientId)}/ads-health`
}

function ToolDoorCard(props: {
  href?: string; onClick?: () => void; title: string; desc: string; badge: ToolBadge; links: SubLink[]; compact?: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <ToolCard {...props} />
      <div className="flex flex-wrap gap-x-3 gap-y-1 px-1">
        {props.links.map(l => l.href
          ? <Link key={l.label} href={l.href} className="text-xs font-semibold text-me-charcoal/55 hover:text-me-ochre">{l.label}</Link>
          : <button key={l.label} type="button" onClick={l.onClick} className="text-xs font-semibold text-me-charcoal/55 hover:text-me-ochre">{l.label}</button>)}
      </div>
    </div>
  )
}

function motionDiv({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={className}>{children}</div>
}

export function ClientToolsGrid({
  clientId,
  client,
  showEntry,
  onOpenGeneration,
  prescriptionStatus = 'none',
  prescriptionId = null,
  compact = false,
}: {
  clientId: string
  client: Client
  showEntry: (entry: HomeEntry) => boolean
  onOpenGeneration: () => void
  prescriptionStatus?: PrescriptionStatus
  prescriptionId?: string | null
  compact?: boolean
}) {
  const grid = compact ? 'grid grid-cols-1 sm:grid-cols-2 gap-2' : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'
  const feat = industryFeatureFlags(client?.industry)

  return (
    <div className="space-y-6">
      <BriefGateBanner clientId={clientId} featureLabel="workspace production entry points">
        <section>
          <p className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-me-ochre">内容生产</p>
          <div className={grid}>
            <ToolDoorCard compact={compact}
              href={showEntry('week-overview') ? `/dashboard/clients/${clientId}/daily-plan?tab=overview` : `/dashboard/clients/${clientId}/daily-plan?tab=post`}
              title="社媒" desc="社媒日常 · 这周 Post / Story / Reel 一眼看清、审核通过或打回" badge="in_house"
              links={[{ label: '图文帖子', href: `/dashboard/clients/${clientId}/daily-plan?tab=post` }]}
            />
            <ToolCard compact={compact} href={`/dashboard/clients/${clientId}/blog`} title="博客" desc="双信号博客生产与管理" badge="in_house" />
            {showEntry('story') && (
              <ToolCard compact={compact} href={`/dashboard/clients/${clientId}/story`} title="Story 自动发布" desc="看这一周要发的 Story · 一键授权 / 随时停（仅管理员）" badge="in_house" />
            )}
            {showEntry('geo-composer') && (
              <ToolCard compact={compact} href={`/dashboard/geo-composer/${clientId}`} title="GEO Composer" desc="部署 AI 搜索优化指令" badge="in_house" />
            )}
            {showEntry('ai-visibility') && (
              <ToolCard compact={compact} href={`/dashboard/ai-visibility/${clientId}`} title="AI 可见度追踪" desc="监控 AI 搜索中的品牌曝光" badge="in_house" />
            )}
            <ToolCard compact={compact} href={`/dashboard/clients/${clientId}/settings?tab=connect`} title="平台连接" desc="连接 GBP · GSC · GA4 · Meta 广告账户" badge="in_house" />
            <ToolDoorCard compact={compact}
              href={`/dashboard/clients/${clientId}/ads-health`}
              title="广告" desc="广告健康 · 每天自动体检、疲劳预警" badge="in_house"
              links={[
                { label: '计划', href: `/dashboard/clients/${clientId}/promo-plan` },
                ...(showEntry('ad-approval') ? [{ label: '等你点头的广告', href: '/dashboard/ad-approval' }] : []),
                { label: '自动暂停', href: autoPauseHref(clientId) },
                { label: 'Meta 账户连接', href: `/dashboard/clients/${clientId}/settings?tab=connect` },
              ]}
            />
            <ToolDoorCard compact={compact}
              href={showEntry('factory') ? `/dashboard/factory?client=${clientId}` : `/dashboard/clients/${clientId}/content-factory`}
              title="出片" desc="视频工厂 · 看片审片、拍板" badge="in_house"
              links={[
                { label: '素材库', href: `/dashboard/clients/${clientId}/assets` },
                ...(showEntry('factory-clips') ? [{ label: '视频工厂素材标签与审核', href: `/dashboard/clients/${clientId}/factory-clips` }] : []),
                { label: '内容工厂', href: `/dashboard/clients/${clientId}/content-factory` },
                { label: '生成单条内容', onClick: onOpenGeneration },
              ]}
            />
          </div>
        </section>
      </BriefGateBanner>

      <section>
        <p className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-me-ochre">经营工具</p>
        <div className={grid}>
          {feat.tailor_made && (
            <ToolCard compact={compact} href={`/dashboard/clients/${clientId}/tailor-made`} title="Tailor-made 行程单" desc="定制行程单" badge="in_house" />
          )}
          {feat.tour_catalog && (
            <ToolCard compact={compact} href={`/dashboard/clients/${clientId}/tour-catalog`} title="团目录 · Beta" desc="团名、行程、展示价、出发班期" badge="in_house" />
          )}
          {feat.business_calculator && showEntry('business-calculator') && (
            <ToolCard compact={compact} href={`/dashboard/clients/${clientId}/business-calculator`} title="经营测算 · 内部" desc="仅内部模拟" badge="in_house" />
          )}
          {feat.projects && (
            <ToolCard compact={compact} href={`/dashboard/clients/${clientId}/projects`} title="楼盘" desc="开发项目素材与策略" badge="in_house" />
          )}
          {feat.listings && (
            <ToolCard compact={compact} href={`/dashboard/clients/${clientId}/listings`} title="房子" desc="每一套房的建档与线索" badge="in_house" />
          )}
        </div>
      </section>

      <section>
        <p className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-me-ochre">诊断与分析</p>
        <div className={grid}>
          <ToolCard compact={compact} href={`/dashboard/clients/${clientId}/crm/all`} title="CRM 管理" desc="客人清单与跟进" badge="in_house" />
          <ToolCard compact={compact} href={`/dashboard/clients/${clientId}/zhangqian`} title="张骞发现" desc="品牌现状全景报告" badge="in_house" />
          <ToolCard compact={compact} href={`/dashboard/clients/${clientId}/operating-agent`} title="经营 Agent" desc="下一步经营判断" badge="in_house" />
          <ToolCard compact={compact} href={prescriptionEntryHref(clientId, prescriptionStatus === 'none' ? null : prescriptionId)} title="处方" desc="跟华佗开方或改方" badge="in_house" />
          <ToolCard compact={compact} href={`/dashboard/clients/${clientId}/site-audit/pages`} title="站点审计" desc="SEO 技术项修复清单" badge="in_house" />
          <ToolCard compact={compact} href={`/dashboard/clients/${clientId}/seo-gap`} title="SEO Gap 分析" desc="关键词机会" badge="in_house" />
          {showEntry('memory') && (
            <ToolCard compact={compact} href={`/dashboard/clients/${clientId}/memory`} title="客户记忆库" desc="L3 长期学习（仅 FDE）" badge="in_house" />
          )}
          <ToolCard compact={compact} title="口碑管理" desc="Google 评价 · 公众号舆情" badge="external" soon />
          <ToolCard compact={compact} title="竞品追踪" desc="持续监控竞品动态" badge="external" soon />
        </div>
      </section>

      <section>
        <p className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-me-ochre">SEO 工具</p>
        <div className={compact ? 'grid grid-cols-1 sm:grid-cols-2 gap-2' : 'grid grid-cols-1 sm:grid-cols-2 gap-3'}>
          <ToolCard compact={compact} href={`/dashboard/clients/${clientId}/strategy`} title="内容策略" desc="博客选题与发布计划" badge="in_house" />
          <ToolCard compact={compact} href={`/dashboard/clients/${clientId}/seo-intelligence`} title="SEO Intelligence" desc="排名与流量趋势" badge="in_house" />
        </div>
      </section>
    </div>
  )
}
