'use client'

/**
 * Phase 23.E — Client Memory 浏览 / 编辑 / 导出页
 *
 * 四 tab 显示 L3 记忆四张表内容；行级别可编辑（textarea + select）/ 删除；
 * 顶部按钮：手动触发抽取器 + 导出 JSON 备份。
 *
 * 仅 FDE 可见（路由用 requireDashboardClientAccess 鉴权 — 客户 portal 不可达）。
 */

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

// ── Row shapes (subset — server returns full rows) ───────────────────────────

interface Preference {
  id: string
  preference_type: string
  content: string
  source: string
  confidence_score: number
  flywheel: string | null
  is_active: boolean
  created_at: string
}

interface ProvenPattern {
  id: string
  pattern_type: string
  pattern_content: string
  performance_metric: string | null
  flywheel: string | null
  source_table: string | null
  is_active: boolean
  created_at: string
}

interface FailedExperiment {
  id: string
  experiment_description: string
  failure_reason: string
  dimension: string | null
  tried_at: string | null
  source_table: string | null
  created_at: string
}

interface DecisionHistory {
  id: string
  decision_context: string
  chosen_action: string
  alternatives_rejected: string[]
  reasoning: string
  outcome_verdict: string | null
  outcome_notes: string | null
  created_at: string
}

type TabKey = 'patterns' | 'experiments' | 'preferences' | 'decisions'

interface ListResponse {
  preferences: Preference[]
  proven_patterns: ProvenPattern[]
  failed_experiments: FailedExperiment[]
  decision_history: DecisionHistory[]
  counts: Record<string, number>
}

const PATTERN_TYPES = ['hook', 'cta', 'angle', 'format', 'headline', 'structure']
const PREFERENCE_TYPES = ['style', 'topic', 'format', 'tone', 'audience', 'other']
const FLYWHEELS = ['', 'seo', 'geo', 'ads', 'social']
const DIMENSIONS = ['', 'seo', 'ai_visibility', 'ads', 'social', 'reputation', 'competitor']
const VERDICTS = ['', 'success', 'failure', 'inconclusive']

export default function ClientMemoryPage() {
  const params = useParams()
  const clientId = params.id as string

  const [data, setData]               = useState<ListResponse | null>(null)
  const [loading, setLoading]         = useState(true)
  const [err, setErr]                 = useState<string | null>(null)
  const [tab, setTab]                 = useState<TabKey>('patterns')
  const [extracting, setExtracting]   = useState(false)
  const [actionMsg, setActionMsg]     = useState<string | null>(null)
  const [actionOk, setActionOk]       = useState<boolean | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/memory/list`)
      const json = await res.json() as { success?: boolean; error?: string } & Partial<ListResponse>
      if (!res.ok) {
        setErr(json.error ?? `HTTP ${res.status}`)
        setData(null)
      } else {
        setData({
          preferences:        json.preferences ?? [],
          proven_patterns:    json.proven_patterns ?? [],
          failed_experiments: json.failed_experiments ?? [],
          decision_history:   json.decision_history ?? [],
          counts:             json.counts ?? {},
        })
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { void reload() }, [reload])

  const flashAction = (msg: string, ok: boolean) => {
    setActionMsg(msg)
    setActionOk(ok)
    setTimeout(() => { setActionMsg(null); setActionOk(null) }, 4000)
  }

  const handleExtract = async () => {
    setExtracting(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/memory/extract`, { method: 'POST' })
      const json = await res.json() as {
        success?: boolean
        error?: string
        result?: {
          outcomes_processed: number
          patterns_added: number
          experiments_added: number
          preferences_added: number
          decisions_updated: number
          errors: string[]
        }
      }
      if (!res.ok || !json.success) {
        flashAction(json.error ?? `抽取失败（HTTP ${res.status}）`, false)
      } else {
        const r = json.result
        flashAction(
          `抽取完成 — 处理 ${r?.outcomes_processed ?? 0} outcomes；` +
          `新增 patterns:${r?.patterns_added ?? 0} / experiments:${r?.experiments_added ?? 0} / ` +
          `preferences:${r?.preferences_added ?? 0}；回填 decisions:${r?.decisions_updated ?? 0}` +
          (r?.errors?.length ? `（${r.errors.length} 条错误）` : ''),
          true,
        )
        void reload()
      }
    } catch (e) {
      flashAction(e instanceof Error ? e.message : '抽取失败', false)
    } finally {
      setExtracting(false)
    }
  }

  const handleExport = () => {
    window.location.href = `/api/clients/${clientId}/memory/export?download=1`
  }

  const handleDelete = async (type: TabKey, memId: string) => {
    if (!confirm('确认删除这条记忆？此操作不可撤销。')) return
    try {
      const res = await fetch(`/api/clients/${clientId}/memory/${type}/${memId}`, { method: 'DELETE' })
      const json = await res.json() as { success?: boolean; error?: string }
      if (!res.ok || !json.success) {
        flashAction(json.error ?? `删除失败（HTTP ${res.status}）`, false)
      } else {
        flashAction('删除成功', true)
        void reload()
      }
    } catch (e) {
      flashAction(e instanceof Error ? e.message : '删除失败', false)
    }
  }

  const handlePatch = async (type: TabKey, memId: string, body: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/clients/${clientId}/memory/${type}/${memId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json() as { success?: boolean; error?: string }
      if (!res.ok || !json.success) {
        flashAction(json.error ?? `保存失败（HTTP ${res.status}）`, false)
        return false
      }
      flashAction('保存成功', true)
      void reload()
      return true
    } catch (e) {
      flashAction(e instanceof Error ? e.message : '保存失败', false)
      return false
    }
  }

  if (loading) return <div className="p-6 text-gray-500">加载中…</div>
  if (err) return <div className="p-6 text-red-600">{err}</div>
  if (!data) return null

  const tabs: Array<{ k: TabKey; label: string; count: number; emoji: string }> = [
    { k: 'patterns',    label: '好模式',     count: data.counts.proven_patterns    ?? 0, emoji: '✅' },
    { k: 'experiments', label: '失败记录',   count: data.counts.failed_experiments ?? 0, emoji: '❌' },
    { k: 'preferences', label: '内容偏好',   count: data.counts.preferences        ?? 0, emoji: '💡' },
    { k: 'decisions',   label: '决策历史',   count: data.counts.decision_history   ?? 0, emoji: '🧭' },
  ]

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/dashboard/clients/${clientId}`} className="text-xs text-indigo-600 hover:underline">
            ← 返回客户主页
          </Link>
          <h1 className="text-2xl font-bold mt-1">🧠 客户记忆库</h1>
          <p className="text-sm text-gray-500 mt-1">
            L3 长期学习层（仅 FDE 可见，客户 portal 不可见）。
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void handleExtract()}
            disabled={extracting}
            className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {extracting ? '抽取中…' : '🔄 触发自动抽取'}
          </button>
          <button
            onClick={handleExport}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            ⬇ 导出 JSON
          </button>
        </div>
      </div>

      {actionMsg && (
        <div className={`rounded border px-3 py-2 text-xs ${
          actionOk
            ? 'border-green-300 bg-green-50 text-green-700'
            : 'border-red-300 bg-red-50 text-red-700'
        }`}>
          {actionMsg}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {tabs.map(t => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.k
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.emoji} {t.label} <span className="text-xs text-gray-400">({t.count})</span>
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="space-y-2">
        {tab === 'patterns' && (
          <PatternsTable
            rows={data.proven_patterns}
            onDelete={(id) => void handleDelete('patterns', id)}
            onPatch={(id, body) => handlePatch('patterns', id, body)}
          />
        )}
        {tab === 'experiments' && (
          <ExperimentsTable
            rows={data.failed_experiments}
            onDelete={(id) => void handleDelete('experiments', id)}
            onPatch={(id, body) => handlePatch('experiments', id, body)}
          />
        )}
        {tab === 'preferences' && (
          <PreferencesTable
            rows={data.preferences}
            onDelete={(id) => void handleDelete('preferences', id)}
            onPatch={(id, body) => handlePatch('preferences', id, body)}
          />
        )}
        {tab === 'decisions' && (
          <DecisionsTable
            rows={data.decision_history}
            onDelete={(id) => void handleDelete('decisions', id)}
            onPatch={(id, body) => handlePatch('decisions', id, body)}
          />
        )}
      </div>
    </div>
  )
}

// ─── Row components ──────────────────────────────────────────────────────────

function EmptyState({ msg }: { msg: string }) {
  return <p className="text-sm text-gray-400 italic py-8 text-center">{msg}</p>
}

function RowShell({
  children,
  onDelete,
  editing,
  onToggleEdit,
  onSave,
  saving,
}: {
  children: React.ReactNode
  onDelete: () => void
  editing: boolean
  onToggleEdit: () => void
  onSave?: () => void
  saving?: boolean
}) {
  return (
    <div className="rounded border border-gray-200 bg-white p-3 space-y-2">
      {children}
      <div className="flex gap-2 justify-end pt-1 border-t border-gray-100">
        {editing && onSave && (
          <button
            onClick={onSave}
            disabled={saving}
            className="text-xs rounded bg-indigo-600 px-2.5 py-1 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        )}
        <button
          onClick={onToggleEdit}
          className="text-xs text-indigo-600 hover:underline"
        >
          {editing ? '取消' : '编辑'}
        </button>
        <button
          onClick={onDelete}
          className="text-xs text-red-600 hover:underline"
        >
          删除
        </button>
      </div>
    </div>
  )
}

// ─── Patterns ────────────────────────────────────────────────────────────────

function PatternsTable({
  rows, onDelete, onPatch,
}: {
  rows: ProvenPattern[]
  onDelete: (id: string) => void
  onPatch: (id: string, body: Record<string, unknown>) => Promise<boolean>
}) {
  if (rows.length === 0) return <EmptyState msg="还没有「好模式」。让飞轮跑出 confirmed outcomes 后触发自动抽取。" />

  return (
    <div className="space-y-2">
      {rows.map(r => <PatternRow key={r.id} row={r} onDelete={() => onDelete(r.id)} onPatch={(b) => onPatch(r.id, b)} />)}
    </div>
  )
}

function PatternRow({
  row, onDelete, onPatch,
}: {
  row: ProvenPattern
  onDelete: () => void
  onPatch: (body: Record<string, unknown>) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [form, setForm] = useState({
    pattern_type: row.pattern_type,
    pattern_content: row.pattern_content,
    performance_metric: row.performance_metric ?? '',
    flywheel: row.flywheel ?? '',
    is_active: row.is_active,
  })

  const save = async () => {
    setSaving(true)
    const ok = await onPatch({
      pattern_type: form.pattern_type,
      pattern_content: form.pattern_content,
      performance_metric: form.performance_metric || null,
      flywheel: form.flywheel || null,
      is_active: form.is_active,
    })
    setSaving(false)
    if (ok) setEditing(false)
  }

  return (
    <RowShell
      editing={editing}
      onToggleEdit={() => setEditing(v => !v)}
      onDelete={onDelete}
      onSave={save}
      saving={saving}
    >
      {!editing ? (
        <>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-700 font-semibold">{row.pattern_type}</span>
            {row.flywheel && <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-indigo-700">{row.flywheel}</span>}
            {!row.is_active && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-500">已停用</span>}
            <span className="text-gray-400">· {new Date(row.created_at).toLocaleDateString()}</span>
            {row.source_table && <span className="text-gray-400">· 来源 {row.source_table}</span>}
          </div>
          <p className="text-sm text-gray-800">{row.pattern_content}</p>
          {row.performance_metric && (
            <p className="text-xs text-gray-500">指标：{row.performance_metric}</p>
          )}
        </>
      ) : (
        <>
          <div className="flex gap-2">
            <select value={form.pattern_type} onChange={e => setForm({ ...form, pattern_type: e.target.value })}
              className="rounded border-gray-300 text-xs px-2 py-1">
              {PATTERN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={form.flywheel} onChange={e => setForm({ ...form, flywheel: e.target.value })}
              className="rounded border-gray-300 text-xs px-2 py-1">
              {FLYWHEELS.map(f => <option key={f || 'none'} value={f}>{f || '— 飞轮 —'}</option>)}
            </select>
            <label className="text-xs text-gray-600 flex items-center gap-1">
              <input type="checkbox" checked={form.is_active}
                onChange={e => setForm({ ...form, is_active: e.target.checked })} />
              启用
            </label>
          </div>
          <textarea value={form.pattern_content}
            onChange={e => setForm({ ...form, pattern_content: e.target.value })}
            rows={2}
            className="w-full rounded border-gray-300 text-sm px-2 py-1.5" />
          <input value={form.performance_metric}
            onChange={e => setForm({ ...form, performance_metric: e.target.value })}
            placeholder="量化指标（可选）"
            className="w-full rounded border-gray-300 text-xs px-2 py-1.5" />
        </>
      )}
    </RowShell>
  )
}

// ─── Experiments ─────────────────────────────────────────────────────────────

function ExperimentsTable({
  rows, onDelete, onPatch,
}: {
  rows: FailedExperiment[]
  onDelete: (id: string) => void
  onPatch: (id: string, body: Record<string, unknown>) => Promise<boolean>
}) {
  if (rows.length === 0) return <EmptyState msg="还没有「失败记录」。reversed outcomes 或 FDE 标注后会出现在这里。" />
  return (
    <div className="space-y-2">
      {rows.map(r => <ExperimentRow key={r.id} row={r} onDelete={() => onDelete(r.id)} onPatch={(b) => onPatch(r.id, b)} />)}
    </div>
  )
}

function ExperimentRow({
  row, onDelete, onPatch,
}: {
  row: FailedExperiment
  onDelete: () => void
  onPatch: (body: Record<string, unknown>) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [form, setForm] = useState({
    experiment_description: row.experiment_description,
    failure_reason: row.failure_reason,
    dimension: row.dimension ?? '',
  })

  const save = async () => {
    setSaving(true)
    const ok = await onPatch({
      experiment_description: form.experiment_description,
      failure_reason: form.failure_reason,
      dimension: form.dimension || null,
    })
    setSaving(false)
    if (ok) setEditing(false)
  }

  return (
    <RowShell
      editing={editing}
      onToggleEdit={() => setEditing(v => !v)}
      onDelete={onDelete}
      onSave={save}
      saving={saving}
    >
      {!editing ? (
        <>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            {row.dimension && <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700 font-semibold">{row.dimension}</span>}
            <span className="text-gray-400">{new Date(row.created_at).toLocaleDateString()}</span>
            {row.source_table && <span className="text-gray-400">· 来源 {row.source_table}</span>}
          </div>
          <p className="text-sm text-gray-800"><span className="font-semibold">实验：</span>{row.experiment_description}</p>
          <p className="text-sm text-gray-700"><span className="font-semibold">失败原因：</span>{row.failure_reason}</p>
        </>
      ) : (
        <>
          <select value={form.dimension} onChange={e => setForm({ ...form, dimension: e.target.value })}
            className="rounded border-gray-300 text-xs px-2 py-1">
            {DIMENSIONS.map(d => <option key={d || 'none'} value={d}>{d || '— 维度 —'}</option>)}
          </select>
          <textarea value={form.experiment_description}
            onChange={e => setForm({ ...form, experiment_description: e.target.value })}
            placeholder="实验描述" rows={2}
            className="w-full rounded border-gray-300 text-sm px-2 py-1.5" />
          <textarea value={form.failure_reason}
            onChange={e => setForm({ ...form, failure_reason: e.target.value })}
            placeholder="失败原因" rows={2}
            className="w-full rounded border-gray-300 text-sm px-2 py-1.5" />
        </>
      )}
    </RowShell>
  )
}

// ─── Preferences ─────────────────────────────────────────────────────────────

function PreferencesTable({
  rows, onDelete, onPatch,
}: {
  rows: Preference[]
  onDelete: (id: string) => void
  onPatch: (id: string, body: Record<string, unknown>) => Promise<boolean>
}) {
  if (rows.length === 0) return <EmptyState msg="还没有「内容偏好」。FDE 在执行看板标注，或抽取器达到阈值后自动生成。" />
  return (
    <div className="space-y-2">
      {rows.map(r => <PreferenceRow key={r.id} row={r} onDelete={() => onDelete(r.id)} onPatch={(b) => onPatch(r.id, b)} />)}
    </div>
  )
}

function PreferenceRow({
  row, onDelete, onPatch,
}: {
  row: Preference
  onDelete: () => void
  onPatch: (body: Record<string, unknown>) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [form, setForm] = useState({
    preference_type: row.preference_type,
    content: row.content,
    confidence_score: row.confidence_score,
    flywheel: row.flywheel ?? '',
    is_active: row.is_active,
  })

  const save = async () => {
    setSaving(true)
    const ok = await onPatch({
      preference_type: form.preference_type,
      content: form.content,
      confidence_score: form.confidence_score,
      flywheel: form.flywheel || null,
      is_active: form.is_active,
    })
    setSaving(false)
    if (ok) setEditing(false)
  }

  return (
    <RowShell
      editing={editing}
      onToggleEdit={() => setEditing(v => !v)}
      onDelete={onDelete}
      onSave={save}
      saving={saving}
    >
      {!editing ? (
        <>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-700 font-semibold">{row.preference_type}</span>
            {row.flywheel && <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-indigo-700">{row.flywheel}</span>}
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">{row.source}</span>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">conf {row.confidence_score.toFixed(2)}</span>
            {!row.is_active && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-500">已停用</span>}
            <span className="text-gray-400">· {new Date(row.created_at).toLocaleDateString()}</span>
          </div>
          <p className="text-sm text-gray-800">{row.content}</p>
        </>
      ) : (
        <>
          <div className="flex gap-2 flex-wrap">
            <select value={form.preference_type} onChange={e => setForm({ ...form, preference_type: e.target.value })}
              className="rounded border-gray-300 text-xs px-2 py-1">
              {PREFERENCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={form.flywheel} onChange={e => setForm({ ...form, flywheel: e.target.value })}
              className="rounded border-gray-300 text-xs px-2 py-1">
              {FLYWHEELS.map(f => <option key={f || 'none'} value={f}>{f || '— 飞轮 —'}</option>)}
            </select>
            <label className="text-xs text-gray-600 flex items-center gap-1">
              confidence
              <input type="number" min={0} max={1} step={0.05}
                value={form.confidence_score}
                onChange={e => setForm({ ...form, confidence_score: parseFloat(e.target.value) })}
                className="w-16 rounded border-gray-300 text-xs px-1.5 py-0.5" />
            </label>
            <label className="text-xs text-gray-600 flex items-center gap-1">
              <input type="checkbox" checked={form.is_active}
                onChange={e => setForm({ ...form, is_active: e.target.checked })} />
              启用
            </label>
          </div>
          <textarea value={form.content}
            onChange={e => setForm({ ...form, content: e.target.value })}
            rows={2}
            className="w-full rounded border-gray-300 text-sm px-2 py-1.5" />
        </>
      )}
    </RowShell>
  )
}

// ─── Decisions ───────────────────────────────────────────────────────────────

function DecisionsTable({
  rows, onDelete, onPatch,
}: {
  rows: DecisionHistory[]
  onDelete: (id: string) => void
  onPatch: (id: string, body: Record<string, unknown>) => Promise<boolean>
}) {
  if (rows.length === 0) return <EmptyState msg="还没有「决策历史」。诸葛亮跑过 conduct 后会自动写入。" />
  return (
    <div className="space-y-2">
      {rows.map(r => <DecisionRow key={r.id} row={r} onDelete={() => onDelete(r.id)} onPatch={(b) => onPatch(r.id, b)} />)}
    </div>
  )
}

function DecisionRow({
  row, onDelete, onPatch,
}: {
  row: DecisionHistory
  onDelete: () => void
  onPatch: (body: Record<string, unknown>) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [form, setForm] = useState({
    outcome_verdict: row.outcome_verdict ?? '',
    outcome_notes: row.outcome_notes ?? '',
  })

  const save = async () => {
    setSaving(true)
    const ok = await onPatch({
      outcome_verdict: form.outcome_verdict || null,
      outcome_notes: form.outcome_notes || null,
    })
    setSaving(false)
    if (ok) setEditing(false)
  }

  return (
    <RowShell
      editing={editing}
      onToggleEdit={() => setEditing(v => !v)}
      onDelete={onDelete}
      onSave={save}
      saving={saving}
    >
      <>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="text-gray-400">{new Date(row.created_at).toLocaleString()}</span>
          {row.outcome_verdict && (
            <span className={`rounded px-1.5 py-0.5 font-semibold ${
              row.outcome_verdict === 'success'    ? 'bg-green-100 text-green-700' :
              row.outcome_verdict === 'failure'    ? 'bg-red-100 text-red-700' :
                                                    'bg-gray-100 text-gray-600'
            }`}>
              {row.outcome_verdict}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500"><span className="font-semibold">背景：</span>{row.decision_context}</p>
        <p className="text-sm text-gray-800"><span className="font-semibold">选择：</span>{row.chosen_action}</p>
        {row.alternatives_rejected.length > 0 && (
          <p className="text-xs text-gray-500"><span className="font-semibold">排除：</span>{row.alternatives_rejected.join(', ')}</p>
        )}
        <p className="text-xs text-gray-600"><span className="font-semibold">理由：</span>{row.reasoning}</p>
        {!editing && row.outcome_notes && (
          <p className="text-xs text-gray-500"><span className="font-semibold">结果备注：</span>{row.outcome_notes}</p>
        )}
        {editing && (
          <div className="flex gap-2 flex-wrap pt-1">
            <select value={form.outcome_verdict}
              onChange={e => setForm({ ...form, outcome_verdict: e.target.value })}
              className="rounded border-gray-300 text-xs px-2 py-1">
              {VERDICTS.map(v => <option key={v || 'none'} value={v}>{v || '— verdict —'}</option>)}
            </select>
            <input value={form.outcome_notes}
              onChange={e => setForm({ ...form, outcome_notes: e.target.value })}
              placeholder="结果备注"
              className="flex-1 min-w-[200px] rounded border-gray-300 text-xs px-2 py-1.5" />
          </div>
        )}
      </>
    </RowShell>
  )
}
