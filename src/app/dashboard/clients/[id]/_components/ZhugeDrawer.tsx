'use client'

/**
 * 诸葛亮 AI 抽屉 (P12.G.5)
 *
 * 打开时自动调用 /api/clients/[id]/zhuge/conduct 进行实时分析，
 * 展示优先行动清单，每条 in_house 行动附「触发鲁班」一键跳转按钮。
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { getLubanRoute } from '@/lib/zhuge/luban-router'
import {
  FLYWHEEL_BADGE,
  IMPACT_CLS,
  EFFORT_CLS,
  IMPACT_ZH,
  EFFORT_ZH,
} from '@/lib/zhuge/display-constants'
import type { ZhugeOutput, PriorityAction } from '@/lib/zhuge/types'

const API_KEY = process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? ''

// ── Action detail card ────────────────────────────────────────────────────────

function ActionDetailCard({
  action,
  clientId,
  onNavigate,
}: {
  action: PriorityAction
  clientId: string
  onNavigate: () => void
}) {
  const fw = FLYWHEEL_BADGE[action.dimension] ?? {
    label: action.dimension,
    cls: 'bg-gray-100 text-gray-600 border-gray-200',
  }
  const route = getLubanRoute(action.executable_by, clientId)

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      {/* Rank + badges row */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
          {action.rank}
        </div>
        <span className={`text-xs font-semibold border rounded-full px-2 py-0.5 ${fw.cls}`}>
          {fw.label}
        </span>
        <span className="text-sm font-semibold text-gray-800 font-mono flex-1 min-w-0 truncate">
          {action.action_type}
        </span>
        <span className={`text-xs font-medium rounded px-1.5 py-0.5 ${IMPACT_CLS[action.expected_impact] ?? ''}`}>
          {IMPACT_ZH[action.expected_impact] ?? action.expected_impact}
        </span>
        <span className={`text-xs font-medium rounded px-1.5 py-0.5 ${EFFORT_CLS[action.effort] ?? ''}`}>
          {EFFORT_ZH[action.effort] ?? action.effort}
        </span>
      </div>

      {/* Why now */}
      <p className="text-sm text-gray-700 leading-relaxed">{action.why_now}</p>

      {/* Evidence refs */}
      {action.evidence_refs.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {action.evidence_refs.map((ref, i) => (
            <span
              key={i}
              className="text-[11px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded font-mono"
            >
              {ref}
            </span>
          ))}
        </div>
      )}

      {/* Luban trigger CTA */}
      {route.kind === 'navigate' ? (
        <a
          href={route.href}
          onClick={onNavigate}
          className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors"
        >
          🖥️ 前往工作台 · {route.label}
        </a>
      ) : (
        <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
          <span>{action.execution_mode === 'external_manual' ? '📞' : '🔗'}</span>
          <span>
            {action.execution_mode === 'external_manual'
              ? '外部执行 · FDE 在系统外完成，请记录后返回更新进度'
              : '第三方平台 · 需在对应平台操作'}
          </span>
        </div>
      )}
    </div>
  )
}

// ── Main drawer ───────────────────────────────────────────────────────────────

type DrawerPhase = 'idle' | 'loading' | 'done' | 'error'
type DrawerSource = 'cached' | 'fresh' | null

export interface ZhugeDrawerProps {
  clientId: string
  isOpen: boolean
  onClose: () => void
  /** Called after a successful conduct run; parent should refresh cached widget. */
  onComplete: () => void
}

export function ZhugeDrawer({ clientId, isOpen, onClose, onComplete }: ZhugeDrawerProps) {
  const [phase, setPhase] = useState<DrawerPhase>('idle')
  const [output, setOutput] = useState<ZhugeOutput | null>(null)
  const [source, setSource] = useState<DrawerSource>(null)
  const [error, setError] = useState<string | null>(null)
  // Prevents double-firing in StrictMode / re-renders
  const hasRunRef = useRef(false)
  // Capture latest onComplete without adding it to the conduct effect's deps.
  // onComplete is an inline arrow in page.tsx and would recreate every render,
  // incorrectly re-triggering the conduct API call.
  const onCompleteRef = useRef(onComplete)
  useEffect(() => { onCompleteRef.current = onComplete })

  // Lock body scroll while open
  useEffect(() => {
    if (!isOpen) return
    const orig = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = orig }
  }, [isOpen])

  const runConduct = useCallback(async () => {
    setPhase('loading')
    setOutput(null)
    setSource(null)
    setError(null)

    try {
      const res = await fetch(`/api/clients/${clientId}/zhuge/conduct`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({}),
      })
      const data = await res.json() as {
        success: boolean
        output?: ZhugeOutput
        error?: string
      }
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? `Error ${res.status}`)
      }
      setOutput(data.output ?? null)
      setSource('fresh')
      setPhase('done')
      onCompleteRef.current()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }, [clientId])

  // On open: read persisted session first; only run LLM if no history exists.
  useEffect(() => {
    if (!isOpen) {
      // Reset so the next open triggers a fresh load
      hasRunRef.current = false
      return
    }
    if (hasRunRef.current) return
    hasRunRef.current = true

    setPhase('loading')
    setOutput(null)
    setSource(null)
    setError(null)

    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/zhuge/latest-actions`, {
          headers: { Authorization: `Bearer ${API_KEY}` },
        })
        if (res.ok) {
          const data = await res.json() as {
            success: boolean
            output?: ZhugeOutput | null
          }
          if (data.success && data.output) {
            setOutput(data.output)
            setSource('cached')
            setPhase('done')
            return
          }
        }
        // No persisted session — fall back to a fresh conduct call.
        await runConduct()
      } catch {
        // Network/parse failure on the cache read — still try a fresh run.
        await runConduct()
      }
    })()
  }, [isOpen, clientId, runConduct])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <button
        onClick={onClose}
        aria-label="关闭"
        className="absolute inset-0 bg-black/40"
      />

      {/* Drawer panel */}
      <div className="relative bg-white w-full sm:w-[520px] h-full flex flex-col shadow-2xl">
        {/* Header */}
        <div className="shrink-0 border-b border-gray-200 px-5 py-4 flex items-center gap-3">
          <span className="text-xl">🧠</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900">诸葛亮 · 本周战略建议</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {phase === 'loading' && (source === null
                ? '读取上一次战略建议…'
                : '正在分析张骞证据 + 华佗诊断，约 20–40 秒…')}
              {phase === 'done' && output && (source === 'cached'
                ? `上一次结果 · ${output.top_actions.length} 条建议 · 如需更新点「重新分析」`
                : `已生成 ${output.top_actions.length} 条建议 · 点击「前往工作台」直接执行`)}
              {phase === 'error' && '分析失败，请检查张骞扫描是否已完成'}
              {phase === 'idle' && ''}
            </p>
          </div>
          {phase === 'done' && (
            <button
              onClick={() => { void runConduct() }}
              className="flex-shrink-0 text-xs font-medium text-gray-500 hover:text-indigo-700 border border-gray-200 hover:border-indigo-300 rounded-lg px-2.5 py-1 transition-colors"
              title="重新调用 Strategy Engine，覆盖上一次结果"
            >
              🔄 重新分析
            </button>
          )}
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-lg px-2 flex-shrink-0"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">

          {/* ── Loading ── */}
          {phase === 'loading' && (
            <div className="flex flex-col items-center justify-center py-20 gap-5">
              <div className="animate-spin w-10 h-10 border-[3px] border-indigo-200 border-t-indigo-600 rounded-full" />
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-800">诸葛亮运筹中…</p>
                <p className="text-xs text-gray-400 mt-1">
                  调用 Strategy Engine，分析张骞证据 + 华佗诊断
                </p>
              </div>
            </div>
          )}

          {/* ── Error ── */}
          {phase === 'error' && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-center space-y-2">
              <p className="text-2xl">⚠️</p>
              <p className="text-sm font-semibold text-red-800">分析失败</p>
              <p className="text-xs text-red-600 break-all">{error}</p>
              <p className="text-xs text-gray-500 mt-2">
                请确认张骞品牌扫描已完成后关闭抽屉重试。
              </p>
            </div>
          )}

          {/* ── Done — action cards ── */}
          {phase === 'done' && output && (
            <>
              <p className="text-xs text-gray-500 pb-1">
                本周战略建议 · 按紧迫程度排序 · 点击「前往工作台」执行对应任务
              </p>

              {output.top_actions.map((action) => (
                <ActionDetailCard
                  key={`${action.rank}-${action.action_type}`}
                  action={action}
                  clientId={clientId}
                  onNavigate={onClose}
                />
              ))}

              <div className="pt-2 text-center text-[11px] text-gray-400">
                Strategy Engine · {output.input_tokens + output.output_tokens} tokens ·
                生成于 {new Date(output.generated_at).toLocaleString('zh-CN', { timeZone: 'Pacific/Auckland' })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
