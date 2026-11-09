'use client'

import { useState } from 'react'
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_VISIBILITIES,
  VISIBILITY_LABELS,
  isDocumentCategory,
  isDocumentVisibility,
  type DocumentCategory,
  type DocumentVisibility,
} from '@/lib/client-documents/constants'
import type { DocumentRow } from '@/lib/client-documents/types'
import { GENERIC_ACTION_ERROR, actionText, readFailure } from './api-messages'
import { fileKindLabel, formatBytes, formatDate } from './format'

const SMALL_BUTTON = 'rounded-lg border border-black/15 px-3 py-1 text-xs font-black text-me-charcoal hover:bg-me-ivory disabled:opacity-40'
const FIELD = 'w-full rounded-lg border border-black/15 bg-white px-2 py-1.5 text-sm font-semibold text-me-charcoal'

interface Props {
  clientId: string
  doc: DocumentRow
  canManage: boolean
  onChanged: () => void
  onReplace: (doc: DocumentRow) => void
  onError: (text: string) => void
}

function Badge({ children, tone }: { children: string; tone: 'quiet' | 'warm' }): JSX.Element {
  const cls = tone === 'warm'
    ? 'border-me-ochre/30 bg-me-ochre/10 text-me-ochre'
    : 'border-black/10 bg-me-ivory text-me-charcoal/60'
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold leading-none ${cls}`}>{children}</span>
}

export function DocumentRowItem({ clientId, doc, canManage, onChanged, onReplace, onError }: Props): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState(doc.title)
  const [category, setCategory] = useState<DocumentCategory>(isDocumentCategory(doc.category) ? doc.category : 'other')
  const [visibility, setVisibility] = useState<DocumentVisibility>(doc.visibility)
  const [versionLabel, setVersionLabel] = useState(doc.version_label ?? '')
  const [description, setDescription] = useState(doc.description ?? '')
  const archived = doc.status === 'archived'

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/documents/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        onError(actionText(await readFailure(res)))
        return false
      }
      onChanged()
      return true
    } catch {
      onError(GENERIC_ACTION_ERROR)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function save(): Promise<void> {
    const saved = await patch({ title, category, visibility, versionLabel, description })
    if (saved) setEditing(false)
  }

  return (
    <li className={`rounded-xl border border-black/10 bg-white p-4 ${archived ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-black text-me-charcoal">{doc.title}</p>
            {doc.version_label && <Badge tone="quiet">{doc.version_label}</Badge>}
            {archived && <Badge tone="quiet">旧版</Badge>}
            {canManage && <Badge tone={doc.visibility === 'client' ? 'warm' : 'quiet'}>{VISIBILITY_LABELS[doc.visibility]}</Badge>}
          </div>
          <p className="mt-0.5 text-xs font-semibold text-me-charcoal/55">
            {fileKindLabel(doc.mime_type)} · {formatBytes(doc.size_bytes)} · {formatDate(doc.created_at)} 放入
          </p>
          {doc.description && <p className="mt-1 whitespace-pre-line text-xs font-semibold text-me-charcoal/70">{doc.description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/clients/${clientId}/documents/${doc.id}/download`}
            className="rounded-lg bg-me-charcoal px-3 py-1 text-xs font-black text-white hover:bg-me-charcoal/85"
          >
            下载
          </a>
          {canManage && !archived && <button type="button" className={SMALL_BUTTON} onClick={() => onReplace(doc)}>换新版</button>}
          {canManage && <button type="button" className={SMALL_BUTTON} onClick={() => setEditing(e => !e)}>改信息</button>}
          {canManage && (
            <button type="button" disabled={busy} className={SMALL_BUTTON} onClick={() => void patch({ status: archived ? 'current' : 'archived' })}>
              {archived ? '恢复' : '归档'}
            </button>
          )}
        </div>
      </div>

      {canManage && editing && (
        <div className="mt-3 grid gap-2 border-t border-black/10 pt-3 sm:grid-cols-2">
          <input aria-label="名称" className={FIELD} value={title} maxLength={200} onChange={e => setTitle(e.target.value)} />
          <input aria-label="版本号" className={FIELD} value={versionLabel} maxLength={40} placeholder="版本号" onChange={e => setVersionLabel(e.target.value)} />
          <select aria-label="类别" className={FIELD} value={category} onChange={e => isDocumentCategory(e.target.value) && setCategory(e.target.value)}>
            {DOCUMENT_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <select aria-label="谁能下载" className={FIELD} value={visibility} onChange={e => isDocumentVisibility(e.target.value) && setVisibility(e.target.value)}>
            {DOCUMENT_VISIBILITIES.map(v => <option key={v} value={v}>{VISIBILITY_LABELS[v]}</option>)}
          </select>
          <textarea aria-label="说明" className={`${FIELD} sm:col-span-2`} rows={2} maxLength={1000} value={description} onChange={e => setDescription(e.target.value)} />
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" disabled={busy || !title.trim()} className="rounded-lg bg-me-charcoal px-3 py-1 text-xs font-black text-white hover:bg-me-charcoal/85 disabled:opacity-40" onClick={() => void save()}>保存</button>
            <button type="button" className={SMALL_BUTTON} onClick={() => setEditing(false)}>取消</button>
          </div>
        </div>
      )}
    </li>
  )
}
