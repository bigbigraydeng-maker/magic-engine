'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MePanel, MePill } from '@/components/ui/me-primitives'
import { cx } from '@/components/ui/me-theme'
import { clientWorkflowSteps } from '../../prescription-entry'
import type { DiscoveryStatus, PrescriptionStatus } from '../NextStepCard'
import { NextStepCard } from '../NextStepCard'
import { ZhugePriorityWidget } from '../ZhugePriorityWidget'
import { IntelligenceSummarySection } from '../intelligence/IntelligenceSummarySection'
import { WorkLogPanel } from '../WorkLogPanel'
import { useClientHomeSignals } from './useClientHomeSignals'
import type { HomeEntry } from '@/lib/auth/home-entries'
import type { ZhugeOutput } from '@/lib/zhuge/types'

interface Client {
  id: string
  name: string
  domain?: string
  industry?: string | null
}

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
  zhugeRefreshKey: number
  zhugeFreshOutput: ZhugeOutput | null
  onAskZhuge: () => void
}

function Accordion({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <MePanel className="overflow-hidden p-0">
      <button type="button" className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left" onClick={() => setOpen(v => !v)}>
        <span className="font-display text-sm font-semibold text-me-charcoal">{title}</span>
        <span className="text-xs font-bold text-me-charcoal/45">{open ? '收起 ▴' : '展开 ▾'}</span>
      </button>
      {open && <div className="border-t border-black/[.06] px-5 pb-5 pt-4">{children}</div>}
    </MePanel>
  )
}

function WorkflowProgress({
  discoveryConfirmed,
  hasPrescription,
  prescriptionId,
  clientId,
}: {
  discoveryConfirmed: boolean
  hasPrescription: boolean
  prescriptionId: string | null
  clientId: string
}) {
  const steps = clientWorkflowSteps({ discoveryConfirmed, hasPrescription, prescriptionId, clientId })
  const firstPending = steps.findIndex(s => !s.done)
  return (
    <div className="overflow-x-auto rounded-xl border border-black/10 bg-white px-4 py-4 shadow-sm">
      <div className="flex min-w-max items-center gap-0">
        {steps.map((step, i) => {
          const active = i === firstPending
          const inner = (
            <div className={cx('flex items-center gap-2 rounded-lg px-3 py-2', active && 'bg-me-ochre/10')}>
              <div className={cx(
                'flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-black',
                step.done ? 'bg-[#5C8A4A] text-white' : active ? 'bg-me-charcoal text-white' : 'bg-me-ivory text-me-charcoal/45',
              )}>
                {step.done ? '✓' : i + 1}
              </div>
              <div>
                <p className={cx('text-xs font-black leading-none', step.done ? 'text-[#5C8A4A]' : active ? 'text-me-charcoal' : 'text-me-charcoal/45')}>{step.label}</p>
                <p className="mt-0.5 text-[10px] font-semibold text-me-charcoal/45">{step.sublabel}</p>
              </div>
            </div>
          )
          return (
            <div key={step.label} className="flex items-center">
              {(step.alwaysLink || (step.href && !step.done)) ? <a href={step.href}>{inner}</a> : inner}
              {i < steps.length - 1 && <div className={cx('mx-1 h-px w-8', step.done ? 'bg-[#5C8A4A]/70' : 'bg-me-stone')} />}
            </div>
          )
        })}
      </div>
    </div>
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
  zhugeRefreshKey,
  zhugeFreshOutput,
  onAskZhuge,
}: Props) {
  const signals = useClientHomeSignals(clientId, showEntry('ad-approval'))

  return (
    <div className="space-y-5 px-4 py-5 md:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-me-charcoal/45">客户工作台</p>
          <h1 className="font-display text-2xl font-bold tracking-tight text-me-charcoal">{client.name}</h1>
          <p className="mt-1 text-sm font-semibold text-me-charcoal/55">左侧导航进各功能；这里只看状态和今天要做的。</p>
          {client.domain && (
            <a href={`https://${client.domain}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex rounded-full border border-me-ochre/25 bg-me-ochre/10 px-2.5 py-0.5 font-mono text-xs font-bold text-me-ochre">
              {client.domain}
            </a>
          )}
        </div>
        <button type="button" onClick={onOpenSettings} className="shrink-0 rounded-lg border border-black/10 bg-white px-4 py-2 text-sm font-black text-me-charcoal/75 hover:border-me-ochre/30">
          设置
        </button>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-me-charcoal">现在怎么样</h2>
          {signals.updatedAt && <p className="text-xs font-semibold text-me-charcoal/45">更新于 {signals.updatedAt}（新西兰时间）</p>}
          <p className="mt-1 text-sm font-semibold text-me-charcoal/70">{signals.loading ? '读取中…' : signals.headline}</p>
        </div>
        {signals.cards.length > 0 && (
          <div className="grid gap-3 md:grid-cols-3">
            {signals.cards.map(card => (
              <MePanel key={card.label} className="p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-black uppercase tracking-wide text-me-ochre">{card.label}</span>
                  <MePill tone={card.tone}>{card.value}</MePill>
                </div>
                <p className="text-sm font-semibold text-me-charcoal/70 line-clamp-2">{card.sub}</p>
                <Link href={card.href} className="mt-3 inline-block text-xs font-black text-me-ochre hover:text-me-charcoal">{card.linkLabel}</Link>
              </MePanel>
            ))}
          </div>
        )}
      </section>

      {signals.todayActions.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold text-me-charcoal">今天要你做 {signals.todayActions.length} 件</h2>
          {signals.todayActions.map(action => (
            <MePanel key={action.id} className={cx('p-4', action.priority === 'high' && 'border-[#C2453A]/35 bg-[#C2453A]/[0.04]')}>
              <p className="text-sm font-black text-me-charcoal">{action.title}</p>
              <p className="mt-1 text-sm font-semibold text-me-charcoal/60">{action.description}</p>
              <Link href={action.href} className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-me-charcoal px-4 text-xs font-black text-white hover:bg-me-charcoal/85">{action.cta}</Link>
            </MePanel>
          ))}
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

      <NextStepCard discoveryStatus={discoveryStatus} prescriptionStatus={prescriptionStatus} clientId={clientId} />

      <div className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-me-charcoal">想看细节再点开</h2>
        <Accordion title="品牌健康快照">
          <p className="text-sm font-semibold text-me-charcoal/60">
            {discoveryStatus === 'confirmed'
              ? '雷达图在品牌扫描页查看。'
              : discoveryStatus === 'reviewing'
                ? '扫描结果待确认。'
                : '尚未完成品牌扫描。'}
          </p>
          <Link href={`/dashboard/clients/${clientId}/zhangqian`} className="mt-2 inline-block text-xs font-black text-me-ochre">
            去品牌扫描 →
          </Link>
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
          <MePanel className="border-me-ochre/30 bg-me-ochre/10 p-4">
            <p className="text-sm font-black text-me-charcoal">尚未配置 Master Brief</p>
            <button type="button" onClick={onOpenSettings} className="mt-2 text-xs font-black text-me-ochre">去配置 →</button>
          </MePanel>
        )}
        <MePanel className="p-4">
          <p className="text-sm font-semibold text-me-charcoal/60">其余工具与行业入口在左侧客户导航，与旧版「工具」Tab 相同门禁。</p>
        </MePanel>
      </div>
    </div>
  )
}
