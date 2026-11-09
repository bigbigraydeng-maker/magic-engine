'use client'

import { useState, type FormEvent } from 'react'
import {
  ACCEPT_ATTRIBUTE,
  FILE_TYPES_HINT,
  isDocumentCategory,
  type DocumentCategory,
  type DocumentVisibility,
} from '@/lib/client-documents/constants'
import type { DocumentRow } from '@/lib/client-documents/types'
import { GENERIC_ACTION_ERROR, actionText, readFailure } from './api-messages'
import { CategorySelect, VisibilityNote, VisibilitySelect } from './form-controls'

const FIELD = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal'
const LABEL = 'mb-1 block text-xs font-black text-me-charcoal/70'

interface Props {
  clientId: string
  /** When set, this upload is a new version of that file; the old one is archived on success. */
  replacing: DocumentRow | null
  onDone: (warning: string | null) => void
  onCancel: () => void
}

interface Fields {
  title: string
  category: DocumentCategory
  visibility: DocumentVisibility
  versionLabel: string
  description: string
}

type SendResult = { ok: true; warning: string | null } | { ok: false; text: string }

function initialFields(replacing: DocumentRow | null): Fields {
  return {
    title: replacing?.title ?? '',
    category: replacing && isDocumentCategory(replacing.category) ? replacing.category : 'other',
    visibility: replacing?.visibility ?? 'internal',
    versionLabel: '',
    description: replacing?.description ?? '',
  }
}

function buildBody(file: File, fields: Fields, replacing: DocumentRow | null): FormData {
  const body = new FormData()
  body.set('file', file)
  for (const [key, value] of Object.entries(fields)) body.set(key, value)
  if (replacing) body.set('replaceId', replacing.id)
  return body
}

async function sendUpload(clientId: string, body: FormData): Promise<SendResult> {
  try {
    const res = await fetch(`/api/clients/${clientId}/documents`, { method: 'POST', body })
    if (!res.ok) return { ok: false, text: actionText(await readFailure(res)) }
    const json: unknown = await res.json().catch(() => null)
    const warning = typeof json === 'object' && json !== null && 'warning' in json && typeof json.warning === 'string' ? json.warning : null
    return { ok: true, warning }
  } catch {
    return { ok: false, text: GENERIC_ACTION_ERROR }
  }
}

function FieldGrid(props: { fields: Fields; update: <K extends keyof Fields>(key: K, value: Fields[K]) => void; onPickFile: (file: File | null) => void }): JSX.Element {
  const { fields, update, onPickFile } = props
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className={LABEL} htmlFor="doc-file">文件（{FILE_TYPES_HINT}，最大 50 MB）</label>
        <input id="doc-file" type="file" accept={ACCEPT_ATTRIBUTE} onChange={e => onPickFile(e.target.files?.[0] ?? null)} className="text-sm font-semibold" />
      </div>
      <div>
        <label className={LABEL} htmlFor="doc-title">名称</label>
        <input id="doc-title" className={FIELD} value={fields.title} maxLength={200} onChange={e => update('title', e.target.value)} />
      </div>
      <div>
        <label className={LABEL} htmlFor="doc-version">版本号（可不填，例如 v11）</label>
        <input id="doc-version" className={FIELD} value={fields.versionLabel} maxLength={40} onChange={e => update('versionLabel', e.target.value)} />
      </div>
      <div>
        <label className={LABEL} htmlFor="doc-category">类别</label>
        <CategorySelect id="doc-category" className={FIELD} value={fields.category} onChange={value => update('category', value)} />
      </div>
      <div>
        <label className={LABEL} htmlFor="doc-visibility">谁能下载</label>
        <VisibilitySelect id="doc-visibility" className={FIELD} value={fields.visibility} onChange={value => update('visibility', value)} />
      </div>
      <VisibilityNote visibility={fields.visibility} />
      <div className="sm:col-span-2">
        <label className={LABEL} htmlFor="doc-description">说明（可不填）</label>
        <textarea id="doc-description" className={FIELD} rows={2} maxLength={1000} value={fields.description} onChange={e => update('description', e.target.value)} />
      </div>
    </div>
  )
}

export function UploadForm({ clientId, replacing, onDone, onCancel }: Props): JSX.Element {
  const [file, setFile] = useState<File | null>(null)
  const [fields, setFields] = useState<Fields>(() => initialFields(replacing))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = <K extends keyof Fields>(key: K, value: Fields[K]): void => setFields(prev => ({ ...prev, [key]: value }))

  function pickFile(picked: File | null): void {
    setFile(picked)
    if (picked && !fields.title.trim()) update('title', picked.name.replace(/\.[^.]+$/, ''))
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!file) return setError('请先选择要上传的文件')
    setBusy(true)
    setError(null)
    const result = await sendUpload(clientId, buildBody(file, fields, replacing))
    setBusy(false)
    if (result.ok) onDone(result.warning)
    else setError(result.text)
  }

  return (
    <form onSubmit={submit} className="mb-6 rounded-xl border border-black/10 bg-white p-4 shadow-sm" aria-label="上传文件">
      <p className="mb-3 text-sm font-black text-me-charcoal">
        {replacing ? `给「${replacing.title}」换新版（旧版会自动收进「旧版」）` : '上传文件'}
      </p>
      <FieldGrid fields={fields} update={update} onPickFile={pickFile} />
      {error && <p role="alert" className="mt-3 text-sm font-bold text-red-700">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white hover:bg-me-charcoal/85 disabled:opacity-40">
          {busy ? '上传中…' : '上传'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-black/15 px-4 py-2 text-sm font-black text-me-charcoal hover:bg-me-ivory">取消</button>
      </div>
    </form>
  )
}
