'use client'

import { useState } from 'react'
import type { ExecutionItem } from '@/types/diagnostic'
import type { ExecutionTarget, FlywheelActionRow } from '@/lib/flywheel/adapters/types'
import { GEO_ACTION_TYPE, GEO_METRIC_KEY } from '@/lib/flywheel/vocabulary'

// ── display labels ────────────────────────────────────────────────────────────

const FLYWHEEL_LABELS: Record<string, string> = {
  seo:    'SEO 引擎',
  geo:    'GEO Composer',
  ads:    '广告工作台',
  social: '社媒矩阵',
}

const GEO_ACTION_OPTIONS = Object.entries(GEO_ACTION_TYPE).map(([, value]) => ({
  value,
  label: value,
}))

const GEO_METRIC_OPTIONS = [
  { value: '', label: '— 不指定 —' },
  ...Object.entries(GEO_METRIC_KEY).map(([, value]) => ({ value, label: value })),
]

// ── types ─────────────────────────────────────────────────────────────────────

interface Props {
  clientId: string
  item: ExecutionItem
  target: ExecutionTarget
  onClose: () => void
}

type Phase = 'form' | 'submitting' | 'done' | 'error'

// ── component ─────────────────────────────────────────────────────────────────

export function FlywheelDrawer({ clientId, item, target, onClose }: Props) {
  const flywheelLabel = FLYWHEEL_LABELS[target.flywheel] ?? target.flywheel

  const defaultActionType =
    target.action_type ??
    (target.flywheel === 'geo' ? GEO_ACTION_TYPE.DEPLOY_DIRECTIVE : '')

  const [actionType, setActionType]         = useState(defaultActionType)
  const [expectedMetric, setExpectedMetric] = useState('')
  const [expectedDelta, setExpectedDelta]   = useState<string>('')
  const [phase, setPhase]                   = useState<Phase>('form')
  const [result, setResult]                 = useState<FlywheelActionRow | null>(null)
  const [errorMsg, setErrorMsg]             = useState('')

  async function handleSubmit() {
    if (!actionType) return
    setPhase('submitting')

    try {
      const res = await fetch('/api/flywheel/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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

      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }

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
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed right-0 top-0 h-full w-[480px] bg-white shadow-2xl z-50 flex flex-col">

        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="font-semibold text-gray-900 text-base">
              在 {flywheelLabel} 中执行
            </h2>
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{item.title}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            aria-label="关闭抽屉"
          >
            ×
          </button>
        </div>

        {/* 正文 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* ── 成功态 ─────────────────────────────────────────── */}
          {phase === 'done' && result && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-2 py-4">
                <span className="text-4xl">✅</span>
                <p className="font-semibold text-gray-800">执行记录已写入</p>
                <p className="text-xs text-gray-400">flywheel_actions 新增一条记录</p>
              </div>
              <div className="bg-gray-50 rounded-lg border border-gray-100 px-4 py-3 text-xs space-y-1.5">
                <Row label="Action ID"    value={result.id} mono />
                <Row label="飞轮"          value={result.flywheel} />
                <Row label="Action Type"  value={result.actionType} />
                <Row label="执行模式"      value={result.executionMode} />
                {result.expectedMetric && (
                  <Row label="期望指标" value={result.expectedMetric} />
                )}
                {result.expectedDelta !== undefined && (
                  <Row label="期望变化" value={String(result.expectedDelta)} />
                )}
                <Row label="执行时间" value={new Date(result.executedAt).toLocaleString('zh-CN')} />
              </div>
              <button
                onClick={onClose}
                className="w-full py-2 rounded-lg bg-gray-100 text-gray-700 text-sm hover:bg-gray-200 transition-colors"
              >
                关闭
              </button>
            </div>
          )}

          {/* ── 错误态 ─────────────────────────────────────────── */}
          {phase === 'error' && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-2 py-4">
                <span className="text-4xl">❌</span>
                <p className="font-semibold text-gray-800">执行失败</p>
                <p className="text-xs text-red-500 text-center break-all">{errorMsg}</p>
              </div>
              <button
                onClick={() => setPhase('form')}
                className="w-full py-2 rounded-lg bg-gray-100 text-gray-700 text-sm hover:bg-gray-200 transition-colors"
              >
                重试
              </button>
            </div>
          )}

          {/* ── 表单态 ─────────────────────────────────────────── */}
          {(phase === 'form' || phase === 'submitting') && (
            <div className="space-y-5">

              {/* 元信息卡 */}
              <div className="bg-gray-50 rounded-lg border border-gray-100 px-4 py-3 text-xs space-y-1.5">
                <Row label="飞轮"    value={flywheelLabel} />
                <Row label="执行模式" value={target.mode} />
                {target.vendor && <Row label="Vendor" value={target.vendor} />}
              </div>

              {/* Action Type */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-gray-700">
                  Action Type <span className="text-red-400">*</span>
                </label>
                {target.flywheel === 'geo' ? (
                  <select
                    value={actionType}
                    onChange={e => setActionType(e.target.value)}
                    disabled={phase === 'submitting'}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  >
                    {GEO_ACTION_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.value}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={actionType}
                    onChange={e => setActionType(e.target.value)}
                    disabled={phase === 'submitting'}
                    placeholder="e.g. seo.publish_post"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  />
                )}
              </div>

              {/* Expected Metric */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-gray-700">
                  期望改善指标 <span className="text-gray-400">（可选）</span>
                </label>
                {target.flywheel === 'geo' ? (
                  <select
                    value={expectedMetric}
                    onChange={e => setExpectedMetric(e.target.value)}
                    disabled={phase === 'submitting'}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  >
                    {GEO_METRIC_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={expectedMetric}
                    onChange={e => setExpectedMetric(e.target.value)}
                    disabled={phase === 'submitting'}
                    placeholder="e.g. geo.query.mention_rate"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  />
                )}
              </div>

              {/* Expected Delta (only when metric is set) */}
              {expectedMetric && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-gray-700">
                    期望变化量 <span className="text-gray-400">（正数 = 改善，如 +0.1）</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={expectedDelta}
                    onChange={e => setExpectedDelta(e.target.value)}
                    disabled={phase === 'submitting'}
                    placeholder="0.1"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  />
                </div>
              )}

            </div>
          )}

        </div>

        {/* 底部按钮 — 仅表单态显示 */}
        {(phase === 'form' || phase === 'submitting') && (
          <div className="px-6 py-4 border-t border-gray-100">
            <button
              onClick={handleSubmit}
              disabled={!actionType || phase === 'submitting'}
              className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium
                         hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
                         transition-colors flex items-center justify-center gap-2"
            >
              {phase === 'submitting' ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  执行中…
                </>
              ) : '确认执行'}
            </button>
          </div>
        )}

      </div>
    </>
  )
}

// ── helper ────────────────────────────────────────────────────────────────────

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <p>
      <span className="text-gray-400">{label}：</span>
      <strong className={`text-gray-800 ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</strong>
    </p>
  )
}
