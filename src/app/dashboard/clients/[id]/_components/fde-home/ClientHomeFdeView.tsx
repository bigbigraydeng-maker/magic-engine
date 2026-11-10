'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MePanel, MePill } from '@/components/ui/me-primitives'
import { cx } from '@/components/ui/me-theme'
import { WorkflowProgress } from '../ClientWorkflowProgress'
import type { DiscoveryStatus, PrescriptionStatus } from '../NextStepCard'
import { NextStepCard } from '../NextStepCard'
import { BrandHealthWidget } from '../BrandHealthWidget'
import { ZhugePriorityWidget } from '../ZhugePriorityWidget'
import { IntelligenceSummarySection } from '../intelligence/IntelligenceSummarySection'
import { WorkLogPanel } from '../WorkLogPanel'
import { ClientToolsGrid } from '../ClientToolsGrid'
import { useClientHomeSignals } from './useClientHomeSignals'
import type { Client } from '../client-types'
import type { HomeEntry } from '@/lib/auth/home-entries'
import type { ZhugeOutput } from '@/lib/zhuge/types'

interface Props {
  client: Client
  clientId: string
  discoveryStatus: DiscoveryStatus
  prescriptionStatus: PrescriptionStatus
  prescriptionId: string | null
  discoveryConfirmed: boolean
  showEntry: (entry: HomeEntry) => boolean
  hasActiveBrief: boolean | null
  onOpenSettings: () => void
  onOpenGeneration: () => void
  zhugeRefreshKey: number
  zhugeFreshOutput: ZhugeOutput | null
  onAskZhuge: () => void
}

function Accordion({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <MePanel className="p-0 overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
        onClick={() => setOpen(v => !v)}
      >
        <span className="font-display text-sm font-semibold text-me-charcoal">{title}</span>
        <span className="text-me-charcoal/45 text-xs font-bold">{open ? '收起 ▴' : '展开 ▾'}</span>
      </button>
      {open && <div className="border-t border-black/[.06] px-5 pb-5 pt-4">{children}</div>}
    </MePanel>
  )
}

export function ClientHomeFdeView({
  client,
  clientId,
  discoveryStatus,
  prescriptionStatus,
  prescriptionId,
  discoveryConfirmed,
  showEntry,
  hasActiveBrief,
  onOpenSettings,
  onOpenGeneration,
  zhugeRefreshKey,
  zhugeFreshOutput,
  onAskZhuge,
}: Props) {
  const signals = useClientHomeSignals(clientId, showEntry('ad-approval'))

  return (
    <div className="space-y-5 px-4 py-5 md:px-6">
      <motionDiv className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-me-charcoal/45">客户工作台</p>
          <h1 className="font-display text-2xl font-bold tracking-tight text-me-charcoal">{client.name}</h1>
          <p className="mt-1 text-sm font-semibold text-me-charcoal/55">
            这位客户现在怎么样、今天要你先做哪几件。其余功能在左侧导航。
          </p>
          {client.domain && (
            <a
              href={`https://${client.domain}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex rounded-full border border-me-ochre/25 bg-me-ochre/10 px-2.5 py-0.5 font-mono text-xs font-bold text-me-ochre"
            >
              {client.domain}
            </a>
          )}
        </div>
        <button
          type="button"
          onClick={onOpenSettings}
          className="shrink-0 rounded-lg border border-black/10 bg-white px-4 py-2 text-sm font-black text-me-charcoal/75 hover:border-me-ochre/30"
        >
          设置
        </button>
      </motionDiv>

      <section className="space-y-3">
        <motionDiv>
          <h2 className="font-display text-lg font-semibold text-me-charcoal">现在怎么样</h2>
          {signals.updatedAt && (
            <p className="text-xs font-semibold text-me-charcoal/45">更新于 {signals.updatedAt}（新西兰时间）</p>
          )}
          <p className="mt-1 text-sm font-semibold text-me-charcoal/70">
            {signals.loading ? '读取中…' : signals.headline}
          </p>
        </motionDiv>
        {signals.cards.length > 0 && (
          <div className="grid gap-3 md:grid-cols-3">
            {signals.cards.map(card => (
              <MePanel key={card.label} className="p-4">
                <motionDiv className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-black uppercase tracking-wide text-me-ochre">{card.label}</span>
                  <MePill tone={card.tone}>{card.value}</MePill>
                </motionDiv>
                <p className="text-sm font-semibold text-me-charcoal/70 line-clamp-2">{card.sub}</p>
                <Link href={card.href} className="mt-3 inline-block text-xs font-black text-me-ochre hover:text-me-charcoal">
                  {card.linkLabel}
                </Link>
              </MePanel>
            ))}
          </div>
        )}
      </section>

      {signals.todayActions.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold text-me-charcoal">
            今天要你做 {signals.todayActions.length} 件
          </h2>
          <motionDiv className="space-y-3">
            {signals.todayActions.map(action => (
              <MePanel
                key={action.id}
                className={cx('p-4', action.priority === 'high' && 'border-[#C2453A]/35 bg-[#C2453A]/[0.04]')}
              >
                <p className="text-sm font-black text-me-charcoal">{action.title}</p>
                <p className="mt-1 text-sm font-semibold text-me-charcoal/60">{action.description}</p>
                <Link
                  href={action.href}
                  className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-me-charcoal px-4 text-xs font-black text-white hover:bg-me-charcoal/85"
                >
                  {action.cta}
                </Link>
              </MePanel>
            ))}
          </motionDiv>
        </section>
      )}

      <section>
        <h2 className="mb-3 font-display text-lg font-semibold text-me-charcoal">做到哪一步</h2>
        <WorkflowProgress
          discoveryConfirmed={discoveryConfirmed}
          hasPrescription={prescriptionStatus !== 'none'}
          prescriptionId={prescriptionStatus === 'none' ? null : prescriptionId}
          clientId={clientId}
        />
      </section>

      <NextStepCard
        discoveryStatus={discoveryStatus}
        prescriptionStatus={prescriptionStatus}
        clientId={clientId}
      />

      <div className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-me-charcoal">想看细节再点开</h2>
        <Accordion title="品牌健康快照">
          <BrandHealthWidget clientId={clientId} />
        </Accordion>
        <Accordion title="数据趋势">
          <IntelligenceSummarySection clientId={clientId} variant="compact" />
        </Accordion>
        <Accordion title="系统建议">
          {discoveryConfirmed ? (
            <ZhugePriorityWidget
              clientId={clientId}
              discoveryConfirmed={discoveryConfirmed}
              refreshKey={zhugeRefreshKey}
              freshOutput={zhugeFreshOutput}
              onAskZhuge={onAskZhuge}
            />
          ) : (
            <p className="text-sm font-semibold text-me-charcoal/55">品牌扫描确认后才会出现优先级建议。</p>
          )}
        </Accordion>
        {showEntry('work-logs') && (
          <Accordion title="工作日志">
            <WorkLogPanel clientId={clientId} />
          </Accordion>
        )}
        {hasActiveBrief === false && (
          <MePanel className="border-me-ochre/30 bg-me-ochre/10">
            <p className="text-sm font-black text-me-charcoal">尚未配置 Master Brief</p>
            <button type="button" onClick={onOpenSettings} className="mt-2 text-xs font-black text-me-ochre">
              去配置 →
            </button>
          </MePanel>
        )}
        <Accordion title="工作台快捷入口（与侧栏相同，收在这里省空间）">
          <ClientToolsGrid
            clientId={clientId}
            client={client}
            showEntry={showEntry}
            onOpenGeneration={onOpenGeneration}
            prescriptionStatus={prescriptionStatus}
            prescriptionId={prescriptionId}
            compact
          />
        </Accordion>
      </div>
    </div>
  )
}

/** Avoid pulling in motion libs — plain div wrapper for layout grouping */
function motionDiv({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return <div className={className}>{children}</div>
}
