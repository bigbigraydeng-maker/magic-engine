'use client'

import { useState } from 'react'
import type { ExecutionItem } from '@/types/diagnostic'
import type { ExecutionTarget, FlywheelActionRow } from '@/lib/flywheel/adapters/types'
import {
  ADS_ACTION_TYPE,
  ADS_METRIC_KEY,
  GEO_ACTION_TYPE,
  GEO_METRIC_KEY,
  SEO_ACTION_TYPE,
  SEO_METRIC_KEY,
  SOCIAL_ACTION_TYPE,
  SOCIAL_METRIC_KEY,
} from '@/lib/flywheel/vocabulary'

const FLYWHEEL_LABELS: Record<ExecutionTarget['flywheel'], string> = {
  seo:    'SEO 引擎',
  geo:    'GEO Composer',
  ads:    '广告工作台',
  social: '社媒矩阵',
}

const ACTION_OPTIONS_BY_FLYWHEEL: Record<ExecutionTarget['flywheel'], string[]> = {
  seo:    Object.values(SEO_ACTION_TYPE),
  geo:    Object.values(GEO_ACTION_TYPE),
  ads:    Object.values(ADS_ACTION_TYPE),
  social: Object.values(SOCIAL_ACTION_TYPE),
}

const METRIC_OPTIONS_BY_FLYWHEEL: Record<ExecutionTarget['flywheel'], string[]> = {
  seo:    Object.values(SEO_METRIC_KEY),
  geo:    Object.values(GEO_METRIC_KEY),
  ads:    Object.values(ADS_METRIC_KEY),
  social: Object.values(SOCIAL_METRIC_KEY),
}

interface Props {
  clientId: string
  item: ExecutionItem
  target: ExecutionTarget
  onClose: () => void
  onOpenLuban?: (initialMessage: string) => void
}

type Phase = 'form' | 'submitting' | 'done' | 'error'

export function FlywheelDrawer({ clientId, item, target, onClose, onOpenLuban }: Props) {
  const flywheelLabel = FLYWHEEL_LABELS[target.flywheel] ?? target.flywheel
  const actionOptions = ACTION_OPTIONS_BY_FLYWHEEL[target.flywheel]
  const metricOptions = METRIC_OPTIONS_BY_FLYWHEEL[target.flywheel]

  const [actionType, setActionType]         = useState(defaultActionTypeFor(target))
  const [expectedMetric, setExpectedMetric] = useState('')
  const [expectedDelta, setExpectedDelta]   = useState<string>('')
  const [phase, setPhase]                   = useState<Phase>('form')
  const [result, setResult]                 = useState<FlywheelActionRow | null>(null)
  const [errorMsg, setErrorMsg]             = useState('')

  const actionSelectOptions = actionType && !actionOptions.includes(actionType)
    ? [actionType, ...actionOptions]
    : actionOptions

  async function handleSubmit() {
    if (!actionType) return
    setPhase('submitting')

    try {
      const res = await fetch('/api/flywheel/execute', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          flywheel:        target.flywheel,
          clientId,
          executionItemId: item.id,
          actionType,
          executionMode:   target.mode,
          vendor:          target.vendor,
          expectedMetric:  expectedMetric || undefined,
          expectedDelta:   expectedDelta !== '' ? Number(expectedDelta) : undefined,
        }),
      })

      const data = (await res.json()) as FlywheelActionRow & { error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)

      setResult(data)
      setPhase('done')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-slate-950/35"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="fixed right-0 top-0 z-[80] flex h-dvh w-full flex-col bg-[#fbfcf7] shadow-2xl lg:w-[min(780px,calc(100vw-30rem))] xl:w-[min(880px,48vw)]">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-cyan-800">
              Execute in {flywheelLabel}
            </p>
            <h2 className="mt-1 truncate text-xl font-black text-slate-950">
              {item.title}
            </h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              记录这一步执行动作，后续用于归因与 outcome 证明。
            </p>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-xl font-black text-slate-400 transition-colors hover:border-slate-300 hover:text-slate-700"
            aria-label="关闭执行面板"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {phase === 'done' && result && (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
                <p className="text-sm font-black text-emerald-700">执行记录已写入</p>
                <p className="mt-1 text-sm font-semibold text-emerald-900">
                  flywheel_actions 新增一条记录，后续可以被归因任务读取。
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
                <Row label="Action ID" value={result.id} mono />
                <Row label="飞轮" value={result.flywheel} />
                <Row label="Action Type" value={result.actionType} />
                <Row label="执行模式" value={result.executionMode} />
                {result.expectedMetric && <Row label="期望指标" value={result.expectedMetric} />}
                {result.expectedDelta !== undefined && <Row label="期望变化" value={String(result.expectedDelta)} />}
                <Row label="执行时间" value={new Date(result.executedAt).toLocaleString('zh-CN')} />
              </div>

              {target.flywheel === 'seo' && onOpenLuban && (
                <button
                  onClick={() => {
                    onClose()
                    onOpenLuban(`请直接帮我生成一篇 SEO 博客草稿，主题来自这个执行项：「${item.title}」。${item.description ? `背景：${item.description}` : ''}`)
                  }}
                  className="w-full rounded-lg bg-slate-950 px-4 py-3 text-sm font-black text-white transition-colors hover:bg-slate-800"
                >
                  让鲁班继续生成博客 →
                </button>
              )}
              {target.flywheel === 'geo' && onOpenLuban && (
                <button
                  onClick={() => {
                    onClose()
                    onOpenLuban(`请帮我为这个执行项起草一条本地动态：「${item.title}」。${item.description ? `内容背景：${item.description}` : ''}`)
                  }}
                  className="w-full rounded-lg bg-slate-950 px-4 py-3 text-sm font-black text-white transition-colors hover:bg-slate-800"
                >
                  让鲁班继续起草内容 →
                </button>
              )}
              {target.flywheel === 'social' && (
                <a
                  href={`/dashboard/clients/${clientId}?tab=campaigns`}
                  className="block w-full rounded-lg bg-cyan-50 px-4 py-3 text-center text-sm font-black text-cyan-800 ring-1 ring-cyan-200 transition-colors hover:bg-cyan-100"
                >
                  前往社媒矩阵创建内容 →
                </a>
              )}
              {target.flywheel === 'ads' && (
                <a
                  href={`/dashboard/clients/${clientId}?tab=campaigns`}
                  className="block w-full rounded-lg bg-cyan-50 px-4 py-3 text-center text-sm font-black text-cyan-800 ring-1 ring-cyan-200 transition-colors hover:bg-cyan-100"
                >
                  前往广告工作台 →
                </a>
              )}
              <button
                onClick={onClose}
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-950"
              >
                关闭
              </button>
            </div>
          )}

          {phase === 'error' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-red-200 bg-red-50 p-5">
                <p className="text-sm font-black text-red-700">执行失败</p>
                <p className="mt-1 break-all text-sm font-semibold text-red-900">{errorMsg}</p>
              </div>
              <button
                onClick={() => setPhase('form')}
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-950"
              >
                重试
              </button>
            </div>
          )}

          {(phase === 'form' || phase === 'submitting') && (
            <div className="space-y-5">
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
                <Row label="飞轮" value={flywheelLabel} />
                <Row label="执行模式" value={target.mode} />
                {target.vendor && <Row label="执行方" value={target.vendor} />}
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-black text-slate-800">
                  Action Type <span className="text-red-500">*</span>
                </label>
                <select
                  value={actionType}
                  onChange={e => setActionType(e.target.value)}
                  disabled={phase === 'submitting'}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100 disabled:opacity-50"
                >
                  {actionSelectOptions.map(value => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
                <p className="text-xs font-semibold leading-5 text-slate-500">
                  Action Type 是写入飞轮数据表的动作名称，表示“这一步到底做了什么”。后续系统用它把执行、指标变化和 outcome 串起来。
                </p>
                {target.flywheel === 'social' && <SocialActionHelp />}
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-black text-slate-800">
                  期望改善指标 <span className="text-slate-400">（可选）</span>
                </label>
                <select
                  value={expectedMetric}
                  onChange={e => setExpectedMetric(e.target.value)}
                  disabled={phase === 'submitting'}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100 disabled:opacity-50"
                >
                  <option value="">不指定</option>
                  {metricOptions.map(value => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
                <p className="text-xs font-semibold leading-5 text-slate-500">
                  不确定可以留空。留空也会记录执行动作，只是不会自动进入“指标前后对比”的归因队列。
                </p>
              </div>

              {expectedMetric && (
                <div className="space-y-2">
                  <label className="block text-sm font-black text-slate-800">
                    期望变化量 <span className="text-slate-400">（正数 = 改善）</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={expectedDelta}
                    onChange={e => setExpectedDelta(e.target.value)}
                    disabled={phase === 'submitting'}
                    placeholder="0.1"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100 disabled:opacity-50"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {(phase === 'form' || phase === 'submitting') && (
          <footer className="border-t border-slate-200 bg-white px-5 py-4">
            <button
              onClick={handleSubmit}
              disabled={!actionType || phase === 'submitting'}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-3 text-sm font-black text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === 'submitting' ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  执行中…
                </>
              ) : '确认执行'}
            </button>
          </footer>
        )}
      </aside>
    </>
  )
}

function defaultActionTypeFor(target: ExecutionTarget): string {
  if (target.action_type) return target.action_type
  if (target.flywheel === 'geo') return GEO_ACTION_TYPE.DEPLOY_DIRECTIVE
  if (target.flywheel === 'seo') return SEO_ACTION_TYPE.PUBLISH_BLOG
  if (target.flywheel === 'ads') return ADS_ACTION_TYPE.META_SNAPSHOT
  return SOCIAL_ACTION_TYPE.GENERATE_CONTENT
}

function SocialActionHelp() {
  return (
    <div className="rounded-lg border border-cyan-100 bg-cyan-50 px-3 py-2 text-xs font-semibold leading-5 text-cyan-950">
      <p><strong>social.generate_content</strong>：生成或整理社媒内容草稿，适合当前这类 FB Post 任务。</p>
      <p><strong>social.schedule_post</strong>：内容已经做好，下一步是排期发布。</p>
      <p><strong>social.publish_post</strong>：内容已经正式发布，用来记录完成发布动作。</p>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <p className="flex gap-2 py-1">
      <span className="w-24 shrink-0 text-slate-400">{label}：</span>
      <strong className={`min-w-0 break-all text-slate-800 ${mono ? 'font-mono text-xs' : ''}`}>
        {value}
      </strong>
    </p>
  )
}
