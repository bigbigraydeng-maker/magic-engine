'use client'

/**
 * NextStepCard — one next action on the client page.
 *
 * State machine:
 *   none       → Start brand scan
 *   reviewing  → Confirm brand scan
 *   confirmed, no rx → Open the prescription dialog
 *   rx generating / failed / draft → Open that dialog
 *   rx approved → Execution board, with a link back to the prescription
 */

import Link from 'next/link'

export type DiscoveryStatus    = 'none' | 'reviewing' | 'confirmed'
export type PrescriptionStatus = 'none' | 'generating' | 'failed' | 'draft' | 'approved'

interface Props {
  discoveryStatus: DiscoveryStatus
  prescriptionStatus: PrescriptionStatus
  clientId: string
}

interface CardConfig {
  wrapCls: string
  dotCls: string
  badge: string
  title: string
  desc: string
  primaryHref?: string
  primaryLabel?: string
  primaryCls: string
  secondaryHref?: string
  secondaryLabel?: string
}

function resolve(
  discoveryStatus: DiscoveryStatus,
  prescriptionStatus: PrescriptionStatus,
  clientId: string,
): CardConfig {
  const prescriptionHref = `/dashboard/clients/${clientId}/prescription/new`
  if (discoveryStatus === 'none') return scanCard(clientId, '未开始', '先做品牌扫描', '还没有品牌扫描，开不了处方。', '开始品牌扫描 →')
  if (discoveryStatus === 'reviewing') return scanCard(clientId, '待确认', '确认品牌扫描', '扫描结果还没确认。确认之后才能开处方。', '查看并确认 →')
  return prescriptionCard(prescriptionStatus, clientId, prescriptionHref)
}

function scanCard(clientId: string, badge: string, title: string, desc: string, primaryLabel: string): CardConfig {
  return {
    wrapCls: badge === '未开始' ? 'bg-[#C2453A]/10 border-[#C2453A]/30' : 'bg-me-ochre/10 border-me-ochre/30',
    dotCls: badge === '未开始' ? 'bg-[#C2453A]' : 'bg-me-ochre',
    badge,
    title,
    desc,
    primaryHref: `/dashboard/clients/${clientId}/zhangqian`,
    primaryLabel,
    primaryCls: 'bg-me-charcoal hover:bg-me-charcoal/85 text-white',
  }
}

function prescriptionCard(status: PrescriptionStatus, clientId: string, href: string): CardConfig {
  if (status === 'generating') return step('生成中', '处方正在写', '华佗正在写，写完会出现在处方对话里。', href, '打开处方 →', true)
  if (status === 'failed') return step('没写成', '处方没写成', '打开处方对话再说一次。', href, '打开处方 →', false)
  if (status === 'draft') return step('待看', '处方可以审了', '打开对话看这版处方。合适就点同意。', href, '打开处方 →', false)
  if (status === 'approved') {
    return {
      ...step('已同意', '处方已经同意', '可以去看执行进度，也可以再打开处方对话。', `/dashboard/clients/${clientId}/execution`, '查看执行进度 →', false),
      wrapCls: 'bg-[#5C8A4A]/10 border-[#5C8A4A]/30',
      dotCls: 'bg-[#5C8A4A]',
      primaryCls: 'bg-[#5C8A4A] hover:bg-[#5C8A4A] text-white',
      secondaryHref: href,
      secondaryLabel: '打开处方',
    }
  }
  return step('下一步', '开一份处方', '直接跟华佗说要什么结果、每月预算。', href, '打开处方 →', false)
}

function step(badge: string, title: string, desc: string, href: string, label: string, pulse: boolean): CardConfig {
  return {
    wrapCls: 'bg-me-ochre/10 border-me-ochre/30',
    dotCls: pulse ? 'bg-me-ochre animate-pulse' : 'bg-me-ochre',
    badge,
    title,
    desc,
    primaryHref: href,
    primaryLabel: label,
    primaryCls: 'bg-me-charcoal hover:bg-me-charcoal/85 text-white',
  }
}

export function NextStepCard({ discoveryStatus, prescriptionStatus, clientId }: Props) {
  const c = resolve(discoveryStatus, prescriptionStatus, clientId)
  return (
    <div className={`rounded-xl border px-5 py-5 shadow-sm ${c.wrapCls}`}>
      <div className="flex flex-wrap items-start justify-between gap-4 sm:flex-nowrap">
        <div className="flex items-start gap-3 min-w-0">
          <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${c.dotCls}`} />
          <div className="min-w-0">
            <p className="mb-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-me-charcoal/45">{c.badge}</p>
            <p className="text-base font-black text-me-charcoal">{c.title}</p>
            <p className="mt-1 text-sm font-semibold leading-relaxed text-me-charcoal/60">{c.desc}</p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2 pl-5 sm:pl-0">
          {c.secondaryHref && (
            <Link href={c.secondaryHref} className="whitespace-nowrap text-sm font-semibold text-me-charcoal/55 transition-colors hover:text-me-charcoal/75">
              {c.secondaryLabel}
            </Link>
          )}
          {c.primaryHref && (
            <Link href={c.primaryHref} className={`min-h-10 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-black transition-colors ${c.primaryCls}`}>
              {c.primaryLabel}
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
