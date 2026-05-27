'use client'

/**
 * NextStepCard — dynamic single-action guidance card (UX overhaul)
 *
 * Always shows FDE exactly one next action based on the client's current
 * pipeline state. Replaces the "none" and "reviewing" states that were
 * previously scattered across BrandHealthWidget.
 *
 * State machine:
 *   none       → Start 张骞 discovery
 *   reviewing  → Confirm 张骞 report
 *   confirmed, no diagnostic, no rx  → Run 华佗 diagnostic (+ skip option)
 *   confirmed, diagnostic done, no rx → Generate 诸葛亮 prescription
 *   rx generating   → In-progress pulse
 *   rx failed       → Re-generate
 *   rx draft        → Approve prescription
 *   rx approved     → Go to 鲁班 execution board
 */

import Link from 'next/link'

export type DiscoveryStatus    = 'none' | 'reviewing' | 'confirmed'
export type PrescriptionStatus = 'none' | 'generating' | 'failed' | 'draft' | 'approved'

interface Props {
  discoveryStatus:      DiscoveryStatus
  hasCompletedDiagnostic: boolean
  prescriptionStatus:   PrescriptionStatus
  clientId:             string
}

interface CardConfig {
  wrapCls:        string   // border + bg
  dotCls:         string   // status dot colour (+ optional animate-pulse)
  badge:          string
  title:          string
  desc:           string
  primaryHref?:   string
  primaryLabel?:  string
  primaryCls:     string   // button bg/text
  secondaryHref?: string
  secondaryLabel?: string
}

function resolve(
  discoveryStatus:        DiscoveryStatus,
  hasCompletedDiagnostic: boolean,
  prescriptionStatus:     PrescriptionStatus,
  clientId:               string,
): CardConfig {

  if (discoveryStatus === 'none') return {
    wrapCls:      'bg-rose-50 border-rose-200',
    dotCls:       'bg-rose-500',
    badge:        '未开始',
    title:        '启动张骞品牌发现',
    desc:         '品牌数据缺失，华佗诊断与诸葛亮分析均无法运行。扫描约 3 分钟完成。',
    primaryHref:  `/dashboard/clients/${clientId}/zhangqian`,
    primaryLabel: '启动品牌发现 →',
    primaryCls:   'bg-slate-950 hover:bg-slate-800 text-white',
  }

  if (discoveryStatus === 'reviewing') return {
    wrapCls:      'bg-amber-50 border-amber-200',
    dotCls:       'bg-amber-400',
    badge:        '待确认',
    title:        '确认张骞发现报告',
    desc:         '张骞已完成品牌扫描，请核查数据后确认导入，才能运行华佗分析。',
    primaryHref:  `/dashboard/clients/${clientId}/zhangqian`,
    primaryLabel: '查看 & 确认报告 →',
    primaryCls:   'bg-slate-950 hover:bg-slate-800 text-white',
  }

  // ── discovery confirmed ───────────────────────────────────────────────────

  if (prescriptionStatus === 'generating') return {
    wrapCls:      'bg-cyan-50 border-cyan-200',
    dotCls:       'bg-cyan-500 animate-pulse',
    badge:        '生成中',
    title:        '诸葛亮处方生成中…',
    desc:         '诸葛亮正在基于诊断数据开方，通常需 1–2 分钟，页面将自动更新。',
    primaryHref:  `/dashboard/clients/${clientId}/prescription/new`,
    primaryLabel: '查看进度 →',
    primaryCls:   'bg-slate-950 hover:bg-slate-800 text-white',
  }

  if (prescriptionStatus === 'failed') return {
    wrapCls:      'bg-rose-50 border-rose-200',
    dotCls:       'bg-rose-500',
    badge:        '生成失败',
    title:        '处方生成失败，请重新生成',
    desc:         '上次诸葛亮处方生成遇到错误。可重新发起生成，或先补充诊断数据后再试。',
    primaryHref:  `/dashboard/clients/${clientId}/prescription/new`,
    primaryLabel: '重新生成处方 →',
    primaryCls:   'bg-slate-950 hover:bg-slate-800 text-white',
    secondaryHref:  `/dashboard/clients/${clientId}/diagnostic`,
    secondaryLabel: '先补充诊断',
  }

  if (prescriptionStatus === 'draft') return {
    wrapCls:      'bg-cyan-50 border-cyan-200',
    dotCls:       'bg-cyan-600',
    badge:        '待审批',
    title:        '诸葛亮处方草稿待审批',
    desc:         '处方已生成，请审阅处方内容并批准，才能将行动推送至鲁班执行看板。',
    primaryHref:  `/dashboard/clients/${clientId}/prescription/new`,
    primaryLabel: '审阅 & 批准处方 →',
    primaryCls:   'bg-slate-950 hover:bg-slate-800 text-white',
  }

  if (prescriptionStatus === 'approved') return {
    wrapCls:      'bg-emerald-50 border-emerald-200',
    dotCls:       'bg-emerald-500',
    badge:        '就绪',
    title:        '处方已批准，执行追踪中',
    desc:         '诸葛亮处方已进入鲁班执行阶段。查看执行看板追踪进度，或询问诸葛亮获取本周战略建议。',
    primaryHref:  `/dashboard/clients/${clientId}/execution`,
    primaryLabel: '查看执行看板 →',
    primaryCls:   'bg-emerald-600 hover:bg-emerald-700 text-white',
    secondaryHref:  `/dashboard/clients/${clientId}/prescription/new`,
    secondaryLabel: '查看处方',
  }

  // confirmed + no prescription yet
  if (hasCompletedDiagnostic) return {
    wrapCls:      'bg-cyan-50 border-cyan-200',
    dotCls:       'bg-cyan-700',
    badge:        '下一步',
    title:        '生成诸葛亮处方',
    desc:         '六维度诊断已完成，诸葛亮可基于诊断结果生成针对性处方行动路线图。',
    primaryHref:  `/dashboard/clients/${clientId}/prescription/new`,
    primaryLabel: '生成诸葛亮处方 →',
    primaryCls:   'bg-slate-950 hover:bg-slate-800 text-white',
    secondaryHref:  `/dashboard/clients/${clientId}/diagnostic/report`,
    secondaryLabel: '先查看诊断报告',
  }

  // confirmed + no diagnostic + no prescription
  return {
    wrapCls:      'bg-cyan-50 border-cyan-200',
    dotCls:       'bg-cyan-600',
    badge:        '下一步',
    title:        '运行华佗深度诊断',
    desc:         '张骞发现已确认。建议先运行六维度深度诊断，诸葛亮处方将更精准（约 3–5 分钟）。',
    primaryHref:  `/dashboard/clients/${clientId}/diagnostic`,
    primaryLabel: '运行华佗诊断 →',
    primaryCls:   'bg-slate-950 hover:bg-slate-800 text-white',
    secondaryHref:  `/dashboard/clients/${clientId}/prescription/new`,
    secondaryLabel: '跳过，直接生成处方',
  }
}

export function NextStepCard({ discoveryStatus, hasCompletedDiagnostic, prescriptionStatus, clientId }: Props) {
  const c = resolve(discoveryStatus, hasCompletedDiagnostic, prescriptionStatus, clientId)

  return (
    <div className={`rounded-xl border px-5 py-5 shadow-sm ${c.wrapCls}`}>
      <div className="flex flex-wrap items-start justify-between gap-4 sm:flex-nowrap">

        {/* Left: status dot + text */}
        <div className="flex items-start gap-3 min-w-0">
          <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${c.dotCls}`} />
          <div className="min-w-0">
            <p className="mb-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
              {c.badge}
            </p>
            <p className="text-base font-black text-slate-950">{c.title}</p>
            <p className="mt-1 text-sm font-semibold leading-relaxed text-slate-600">{c.desc}</p>
          </div>
        </div>

        {/* Right: CTAs */}
        <div className="flex flex-shrink-0 items-center gap-2 pl-5 sm:pl-0">
          {c.secondaryHref && (
            <Link
              href={c.secondaryHref}
              className="whitespace-nowrap text-sm font-semibold text-slate-500 transition-colors hover:text-slate-800"
            >
              {c.secondaryLabel}
            </Link>
          )}
          {c.primaryHref && (
            <Link
              href={c.primaryHref}
              className={`min-h-10 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-black transition-colors ${c.primaryCls}`}
            >
              {c.primaryLabel}
            </Link>
          )}
        </div>

      </div>
    </div>
  )
}
