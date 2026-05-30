'use client'

/**
 * FdeManualEntryModal — Phase 20.D
 *
 * FDE 手动录入执行任务。从执行看板顶部「+ 录入工作」按钮触发，
 * 允许 FDE 直接记录已完成或进行中的工作，不绑定处方或 Marketing Plan。
 * 写入的任务以「📝 FDE 录入工作」分组显示在看板内，客户 Portal 也可见。
 */

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { ExecutionItem } from '@/types/diagnostic'


const DIMENSION_OPTIONS = [
  { v: 'seo',           label: '🔍 SEO' },
  { v: 'ai_visibility', label: '🤖 GEO（AI 可见度）' },
  { v: 'ads',           label: '📢 广告' },
  { v: 'social',        label: '📱 社媒' },
  { v: 'reputation',    label: '⭐ 口碑' },
  { v: 'competitor',    label: '🔭 竞品' },
]

const FIX_TYPE_OPTIONS = [
  { v: 'fde_manual',  label: '👤 FDE 手动' },
  { v: 'third_party', label: '🔗 第三方平台' },
  { v: 'me_auto',     label: '🤖 ME 自动' },
]

const STATUS_OPTIONS = [
  { v: 'completed',   label: '✅ 已完成' },
  { v: 'in_progress', label: '🔄 进行中' },
  { v: 'pending',     label: '⏳ 待处理' },
]

interface Props {
  clientId: string
  open:     boolean
  onClose:  () => void
  onCreated: (item: ExecutionItem) => void
}

export function FdeManualEntryModal({ clientId, open, onClose, onCreated }: Props) {
  const [mounted,     setMounted]     = useState(false)
  const [title,       setTitle]       = useState('')
  const [description, setDescription] = useState('')
  const [dimension,   setDimension]   = useState('seo')
  const [fixType,     setFixType]     = useState('fde_manual')
  const [status,      setStatus]      = useState('completed')
  const [dueDate,     setDueDate]     = useState('')
  const [submitting,  setSubmitting]  = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  useEffect(() => { setMounted(true) }, [])

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setTitle('')
      setDescription('')
      setDimension('seo')
      setFixType('fde_manual')
      setStatus('completed')
      setDueDate('')
      setError(null)
    }
  }, [open])

  const submit = async () => {
    if (!title.trim()) { setError('请填写任务标题'); return }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/execution/manual`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          title:       title.trim(),
          description: description.trim() || undefined,
          dimension,
          fix_type:    fixType,
          status,
          due_date:    dueDate || undefined,
        }),
      })
      const json = await res.json() as { success: boolean; item?: ExecutionItem; error?: string }
      if (!json.success || !json.item) throw new Error(json.error ?? '录入失败')
      onCreated(json.item)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '录入失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  if (!mounted || !open) return null

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-lg pointer-events-auto"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div>
              <h2 className="text-base font-semibold text-gray-900">📝 录入工作记录</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                记录已完成或进行中的工作，客户 Portal 可见
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            >×</button>
          </div>

          {/* Form */}
          <div className="px-6 py-4 space-y-3.5">
            {/* Title */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                任务标题 <span className="text-red-500">*</span>
              </label>
              <input
                autoFocus
                value={title}
                onChange={e => setTitle(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && void submit()}
                placeholder="e.g. 优化 OzTop 产品页面 Title Tags（12 页）"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">说明（可选）</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={2}
                placeholder="执行细节、工具使用、预期效果…"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>

            {/* Dimension + Fix Type */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">支柱类型</label>
                <select
                  value={dimension}
                  onChange={e => setDimension(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm focus:border-indigo-400 focus:outline-none"
                >
                  {DIMENSION_OPTIONS.map(o => (
                    <option key={o.v} value={o.v}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">执行方式</label>
                <select
                  value={fixType}
                  onChange={e => setFixType(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm focus:border-indigo-400 focus:outline-none"
                >
                  {FIX_TYPE_OPTIONS.map(o => (
                    <option key={o.v} value={o.v}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Status + Due Date */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">初始状态</label>
                <select
                  value={status}
                  onChange={e => setStatus(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm focus:border-indigo-400 focus:outline-none"
                >
                  {STATUS_OPTIONS.map(o => (
                    <option key={o.v} value={o.v}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">截止日期（可选）</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm focus:border-indigo-400 focus:outline-none"
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <p className="text-xs text-red-600 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                {error}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-white transition-colors"
            >
              取消
            </button>
            <button
              onClick={() => void submit()}
              disabled={!title.trim() || submitting}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? '录入中…' : '录入看板'}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}
