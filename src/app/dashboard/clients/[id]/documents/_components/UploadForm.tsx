'use client'

import { useState, type FormEvent } from 'react'
import {
  ACCEPT_ATTRIBUTE,
  DOCUMENT_CATEGORIES,
  DOCUMENT_VISIBILITIES,
  FILE_TYPES_HINT,
  VISIBILITY_LABELS,
  isDocumentCategory,
  isDocumentVisibility,
  type DocumentCategory,
  type DocumentVisibility,
} from '@/lib/client-documents/constants'
import type { DocumentRow } from '@/lib/client-documents/types'
import { GENERIC_ACTION_ERROR, actionText, readFailure } from './api-messages'

const FIELD = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal'
const LABEL = 'mb-1 block text-xs font-black text-me-charcoal/70'

interface Props {
  clientId: string
  /** When set, this upload is a new version of that file; the old one is archived on success. */
  replacing: DocumentRow | null
  onDone: (warning: string | null) => void
  onCancel: () => void
}

function stemOf(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}

export function UploadForm({ clientId, replacing, onDone, onCancel }: Props): JSX.Element {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState(replacing?.title ?? '')
  const [category, setCategory] = useState<DocumentCategory>(
    replacing && isDocumentCategory(replacing.category) ? replacing.category : 'other',
  )
  const [visibility, setVisibility] = useState<DocumentVisibility>(replacing?.visibility ?? 'internal')
  const [versionLabel, setVersionLabel] = useState('')
  const [description, setDescription] = useState(replacing?.description ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function pickFile(picked: File | null): void {
    setFile(picked)
    if (picked && !title.trim()) setTitle(stemOf(picked.name))
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!file) {
      setError('请先选择要上传的文件')
      return
    }
    const body = new FormData()
    body.set('file', file)
    body.set('title', title)
    body.set('category', category)
    body.set('visibility', visibility)
    body.set('versionLabel', versionLabel)
    body.set('description', description)
    if (replacing) body.set('replaceId', replacing.id)

    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/documents`, { method: 'POST', body })
      if (!res.ok) {
        setError(actionText(await readFailure(res)))
        return
      }
      const json: unknown = await res.json().catch(() => null)
      const warning = typeof json === 'object' && json !== null && 'warning' in json && typeof json.warning === 'string' ? json.warning : null
      onDone(warning)
    } catch {
      setError(GENERIC_ACTION_ERROR)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mb-6 rounded-xl border border-black/10 bg-white p-4 shadow-sm" aria-label="上传文件">
      <p className="mb-3 text-sm font-black text-me-charcoal">
        {replacing ? `给「${replacing.title}」换新版（旧版会自动收进「旧版」）` : '上传文件'}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={LABEL} htmlFor="doc-file">文件（{FILE_TYPES_HINT}，最大 50 MB）</label>
          <input id="doc-file" type="file" accept={ACCEPT_ATTRIBUTE} onChange={e => pickFile(e.target.files?.[0] ?? null)} className="text-sm font-semibold" />
        </div>
        <div>
          <label className={LABEL} htmlFor="doc-title">名称</label>
          <input id="doc-title" className={FIELD} value={title} maxLength={200} onChange={e => setTitle(e.target.value)} />
        </div>
        <div>
          <label className={LABEL} htmlFor="doc-version">版本号（可不填，例如 v11）</label>
          <input id="doc-version" className={FIELD} value={versionLabel} maxLength={40} onChange={e => setVersionLabel(e.target.value)} />
        </div>
        <div>
          <label className={LABEL} htmlFor="doc-category">类别</label>
          <select id="doc-category" className={FIELD} value={category} onChange={e => isDocumentCategory(e.target.value) && setCategory(e.target.value)}>
            {DOCUMENT_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="doc-visibility">谁能下载</label>
          <select id="doc-visibility" className={FIELD} value={visibility} onChange={e => isDocumentVisibility(e.target.value) && setVisibility(e.target.value)}>
            {DOCUMENT_VISIBILITIES.map(v => <option key={v} value={v}>{VISIBILITY_LABELS[v]}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL} htmlFor="doc-description">说明（可不填）</label>
          <textarea id="doc-description" className={FIELD} rows={2} maxLength={1000} value={description} onChange={e => setDescription(e.target.value)} />
        </div>
      </div>
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
