'use client'

/**
 * MemoryAnnotationPanel — Phase 23.B
 *
 * FDE 在执行看板抽屉中用于向 L3 记忆层写入标注的紧凑面板。
 * 支持三种标注类型：好模式 / 失败记录 / 内容偏好。
 *
 * 位置：TaskDetailDrawer 内，outcome chip 下方，仅 completed/in_progress 项可见。
 */

import { useState } from 'react'

type AnnotationType = 'pattern' | 'failure' | 'preference'

const PATTERN_TYPES = [
  { v: 'hook',      label: 'Hook（开头钩子）' },
  { v: 'cta',       label: 'CTA（行动号召）' },
  { v: 'angle',     label: 'Angle（内容角度）' },
  { v: 'format',    label: 'Format（内容格式）' },
  { v: 'headline',  label: 'Headline（标题风格）' },
  { v: 'structure', label: 'Structure（内容结构）' },
]

const PREFERENCE_TYPES = [
  { v: 'style',    label: '写作风格' },
  { v: 'topic',    label: '话题偏好' },
  { v: 'format',   label: '内容格式' },
  { v: 'tone',     label: '语调语气' },
  { v: 'audience', label: '目标受众' },
  { v: 'other',    label: '其他' },
]

interface Props {
  clientId: string
  itemId: string
  dimension?: string | null
  flywheel?: string | null
}

type FormState =
  | { type: 'pattern';    patternType: string; content: string; metric: string }
  | { type: 'failure';    description: string; reason: string }
  | { type: 'preference'; prefType: string;    content: string }

function initForm(type: AnnotationType): FormState {
  if (type === 'pattern')    return { type, patternType: 'hook', content: '', metric: '' }
  if (type === 'failure')    return { type, description: '', reason: '' }
  return { type: 'preference', prefType: 'style', content: '' }
}

export function MemoryAnnotationPanel({ clientId, itemId, dimension, flywheel }: Props) {
  const [open, setOpen]           = useState(false)
  const [activeType, setActiveType] = useState<AnnotationType | null>(null)
  const [form, setForm]           = useState<FormState | null>(null)
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState<string | null>(null)   // 成功提示文案
  const [err, setErr]             = useState<string | null>(null)

  const selectType = (t: AnnotationType) => {
    setActiveType(t)
    setForm(initForm(t))
    setSaved(null)
    setErr(null)
  }

  const handleSubmit = async () => {
    if (!form) return
    setSaving(true)
    setErr(null)

    const base = {
      annotation_type: form.type,
      execution_item_id: itemId,
      dimension: dimension ?? undefined,
      flywheel: flywheel ?? undefined,
    }

    let payload: Record<string, unknown>
    if (form.type === 'pattern') {
      if (!form.content.trim()) { setErr('请填写模式描述'); setSaving(false); return }
      payload = { ...base, pattern_type: form.patternType, pattern_content: form.content.trim(), performance_metric: form.metric.trim() || undefined }
    } else if (form.type === 'failure') {
      if (!form.description.trim()) { setErr('请填写实验描述'); setSaving(false); return }
      if (!form.reason.trim())      { setErr('请填写失败原因'); setSaving(false); return }
      payload = { ...base, experiment_description: form.description.trim(), failure_reason: form.reason.trim() }
    } else {
      if (!form.content.trim()) { setErr('请填写偏好内容'); setSaving(false); return }
      payload = { ...base, preference_type: form.prefType, content: form.content.trim() }
    }

    try {
      const res = await fetch(`/api/clients/${clientId}/memory/annotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json() as { success?: boolean; error?: string }
      if (!res.ok || !json.success) {
        setErr(json.error ?? `保存失败（HTTP ${res.status}）`)
      } else {
        const labels: Record<AnnotationType, string> = {
          pattern:    '好模式已记录 ✅',
          failure:    '失败记录已保存 ✅',
          preference: '偏好已记录 ✅',
        }
        setSaved(labels[form.type])
        setForm(null)
        setActiveType(null)
      }
    } catch {
      setErr('网络错误，请重试')
    } finally {
      setSaving(false)
    }
  }

  // 折叠态：只显示一个小标题 + 展开按钮
  if (!open) {
    return (
      <div className="pt-1">
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-indigo-600 transition-colors group"
        >
          <span className="text-[13px] group-hover:scale-110 transition-transform">🧠</span>
          <span className="font-medium">记忆标注</span>
          <span className="opacity-60">▾</span>
        </button>
        {saved && (
          <p className="mt-1 text-[11px] text-green-600 font-medium">{saved}</p>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3 space-y-2.5">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider">
          🧠 记忆标注
        </span>
        <button
          onClick={() => { setOpen(false); setActiveType(null); setForm(null); setErr(null) }}
          className="text-gray-400 hover:text-gray-600 text-xs"
        >
          收起 ▴
        </button>
      </div>

      {/* 三个类型选择器 */}
      <div className="flex gap-1.5 flex-wrap">
        {([
          { t: 'pattern'    as AnnotationType, label: '✅ 好模式',   activeClass: 'bg-green-100 border-green-300 text-green-700' },
          { t: 'failure'    as AnnotationType, label: '❌ 失败记录', activeClass: 'bg-red-100 border-red-300 text-red-700' },
          { t: 'preference' as AnnotationType, label: '💡 偏好',     activeClass: 'bg-blue-100 border-blue-300 text-blue-700' },
        ] as { t: AnnotationType; label: string; activeClass: string }[]).map(({ t, label, activeClass }) => (
          <button
            key={t}
            onClick={() => activeType === t ? (setActiveType(null), setForm(null)) : selectType(t)}
            className={`text-[11px] px-2.5 py-1 rounded-md border font-medium transition-colors ${
              activeType === t
                ? activeClass
                : 'bg-white border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 内联表单 */}
      {form && (
        <div className="space-y-2 pt-1">
          {form.type === 'pattern' && (
            <>
              <select
                value={form.patternType}
                onChange={e => setForm({ ...form, patternType: e.target.value })}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs focus:border-indigo-400 focus:outline-none"
              >
                {PATTERN_TYPES.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
              <textarea
                value={form.content}
                onChange={e => setForm({ ...form, content: e.target.value })}
                rows={2}
                placeholder="描述这个获胜模式，例如：以提问开头的 hook 比陈述句点击率高 32%"
                className="w-full rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
              <input
                value={form.metric}
                onChange={e => setForm({ ...form, metric: e.target.value })}
                placeholder="量化指标（可选）：CTR +32%, 互动率翻倍…"
                className="w-full rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs focus:border-indigo-400 focus:outline-none"
              />
            </>
          )}

          {form.type === 'failure' && (
            <>
              <textarea
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                rows={2}
                placeholder="描述这次失败实验，例如：尝试纯文字帖子（无图片）推广服务"
                className="w-full rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
              <textarea
                value={form.reason}
                onChange={e => setForm({ ...form, reason: e.target.value })}
                rows={2}
                placeholder="为什么失败？例如：无视觉内容互动率为 0，受众需要图片触发点击"
                className="w-full rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </>
          )}

          {form.type === 'preference' && (
            <>
              <select
                value={form.prefType}
                onChange={e => setForm({ ...form, prefType: e.target.value })}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs focus:border-indigo-400 focus:outline-none"
              >
                {PREFERENCE_TYPES.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
              <textarea
                value={form.content}
                onChange={e => setForm({ ...form, content: e.target.value })}
                rows={2}
                placeholder="描述客户偏好，例如：客户喜欢简短段落，每段不超过 3 句话"
                className="w-full rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </>
          )}

          {err && <p className="text-[11px] text-red-600">{err}</p>}

          <div className="flex gap-2 pt-0.5">
            <button
              onClick={() => { setActiveType(null); setForm(null); setErr(null) }}
              className="flex-1 rounded border border-gray-300 py-1.5 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
            >
              取消
            </button>
            <button
              onClick={() => void handleSubmit()}
              disabled={saving}
              className="flex-1 rounded bg-indigo-600 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {saving ? '保存中…' : '保存到记忆'}
            </button>
          </div>
        </div>
      )}

      {saved && !form && (
        <p className="text-[11px] text-green-600 font-medium">{saved}</p>
      )}
    </div>
  )
}
