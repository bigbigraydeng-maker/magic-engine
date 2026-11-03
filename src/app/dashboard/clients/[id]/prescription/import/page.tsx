'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { parseManualPaste } from '@/lib/diagnostic/manual-prescription'
import type { PrescriptionAction, PrescriptionContent, PrescriptionPhase } from '@/types/diagnostic'
import { actionFixBadge } from '../new/action-badge'

type Preview = {
  goalId: string
  content: PrescriptionContent
  generationMeta: Record<string, unknown>
}

function PageHeader({ clientId, urlGoalId }: { clientId: string; urlGoalId: string | null }) {
  const back = `/dashboard/clients/${clientId}/prescription/new${urlGoalId ? `?goal_id=${urlGoalId}` : ''}`
  return (
    <div className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="max-w-3xl mx-auto flex items-center gap-3">
        <Link href={back} className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
          返回处方
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-gray-900">贴入处方草稿</h1>
          <p className="text-xs text-gray-500 mt-0.5">只保存草稿。不会批准，不会生成待办，不会调用模型重写。</p>
        </div>
      </div>
    </div>
  )
}

function PasteBox({ raw, onChange, onPreview }: {
  raw: string
  onChange: (value: string) => void
  onPreview: () => void
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
      <label htmlFor="prescription-json" className="block text-sm font-medium text-gray-800">处方 JSON</label>
      <textarea
        id="prescription-json"
        value={raw}
        onChange={(event) => onChange(event.target.value)}
        rows={14}
        spellCheck={false}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono text-gray-900 focus:border-indigo-400 focus:outline-none"
      />
      <div className="flex justify-end">
        <button type="button" onClick={onPreview} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50">
          预览
        </button>
      </div>
    </div>
  )
}

function ActionPreview({ action }: { action: PrescriptionAction }) {
  const badge = actionFixBadge(action)
  return (
    <div className="rounded-lg border border-gray-100 p-3">
      <div className="flex items-start gap-2">
        <span className={`text-xs px-2 py-0.5 rounded font-medium shrink-0 ${badge.cls}`}>{badge.label}</span>
        <div>
          <p className="text-sm font-medium text-gray-900">{action.title}</p>
          <p className="text-xs text-gray-500 mt-1">{action.description}</p>
        </div>
      </div>
    </div>
  )
}

function PhasePreview({ phase }: { phase: PrescriptionPhase }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-900">
        {phase.phase_number}. {phase.name}
        <span className="ml-2 font-normal text-gray-400">{phase.duration_weeks} 周</span>
      </h3>
      {phase.actions.map((action) => <ActionPreview key={action.id} action={action} />)}
    </div>
  )
}

function PreviewPanel({ preview, saving, onSave }: {
  preview: Preview
  saving: boolean
  onSave: () => void
}) {
  const actionCount = preview.content.phases.reduce((sum, phase) => sum + phase.actions.length, 0)
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <h2 className="font-semibold text-gray-900">保存前预览</h2>
      <p className="text-xs text-gray-500">目标 {preview.goalId} · {actionCount} 条动作 · 开方人：广告 Agent</p>
      <p className="text-sm text-gray-700">{preview.content.summary}</p>
      {preview.content.phases.map((phase) => <PhasePreview key={phase.phase_number} phase={phase} />)}
      <button type="button" onClick={onSave} disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
        {saving ? '保存中…' : '保存为草稿'}
      </button>
    </section>
  )
}

function previewFromPaste(
  raw: string,
  urlGoalId: string | null,
  clientId: string,
): { preview: Preview } | { error: string } {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch {
    return { error: '这不是合法的 JSON' }
  }
  const parsed = parseManualPaste(parsedJson, urlGoalId, clientId)
  if (!parsed.ok) return { error: parsed.error }
  return {
    preview: {
      goalId: parsed.goalId,
      content: parsed.content,
      generationMeta: parsed.generationMeta,
    },
  }
}

async function postDraft(clientId: string, preview: Preview): Promise<{ ok: true; viewPath: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/clients/${clientId}/prescriptions/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal_id: preview.goalId,
        content: preview.content,
        generation_meta: preview.generationMeta,
      }),
    })
    const body = await res.json() as { success?: boolean; error?: string; view_path?: string }
    if (!res.ok || !body.success || !body.view_path) {
      return { ok: false, error: body.error ?? `保存失败（HTTP ${res.status}）` }
    }
    return { ok: true, viewPath: body.view_path }
  } catch {
    return { ok: false, error: '保存失败，请再试一次' }
  }
}

export default function ManualPrescriptionImportPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const clientId = params.id as string
  const urlGoalId = searchParams.get('goal_id')
  const [raw, setRaw] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewRaw, setPreviewRaw] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const current = previewRaw === raw ? preview : null

  const onPreview = () => {
    setSavedPath(null)
    const result = previewFromPaste(raw, urlGoalId, clientId)
    if ('error' in result) {
      setPreview(null)
      setPreviewRaw(null)
      setError(result.error)
      return
    }
    setError(null)
    setPreview(result.preview)
    setPreviewRaw(raw)
  }

  const onSave = async () => {
    if (!current) return
    setSaving(true)
    setError(null)
    const result = await postDraft(clientId, current)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSavedPath(result.viewPath)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader clientId={clientId} urlGoalId={urlGoalId} />
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
        {urlGoalId && <p className="text-xs text-gray-500">地址上的目标：{urlGoalId}</p>}
        <PasteBox raw={raw} onChange={setRaw} onPreview={onPreview} />
        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {current && <PreviewPanel preview={current} saving={saving} onSave={() => void onSave()} />}
        {savedPath && (
          <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            已存成草稿。
            <Link href={savedPath} className="ml-2 underline font-medium">打开处方页</Link>
          </div>
        )}
      </div>
    </div>
  )
}
