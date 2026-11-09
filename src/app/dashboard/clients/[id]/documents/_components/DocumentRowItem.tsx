'use client'

import { useState } from 'react'
import {
  VISIBILITY_LABELS,
  isDocumentCategory,
  type DocumentCategory,
  type DocumentVisibility,
} from '@/lib/client-documents/constants'
import type { DocumentRow } from '@/lib/client-documents/types'
import { GENERIC_ACTION_ERROR, actionText, readFailure } from './api-messages'
import { CategorySelect, VisibilityNote, VisibilitySelect } from './form-controls'
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

interface EditFields {
  title: string
  category: DocumentCategory
  visibility: DocumentVisibility
  versionLabel: string
  description: string
}

function Badge({ children, tone }: { children: string; tone: 'quiet' | 'warm' }): JSX.Element {
  const cls = tone === 'warm'
    ? 'border-me-ochre/30 bg-me-ochre/10 text-[#7A5410]'
    : 'border-black/10 bg-me-ivory text-me-charcoal/70'
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold leading-none ${cls}`}>{children}</span>
}

/** Sends one edit for a file. Resolves true on success so the caller can close its form. */
function useDocumentPatch(clientId: string, docId: string, onChanged: () => void, onError: (text: string) => void) {
  const [busy, setBusy] = useState(false)

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/documents/${docId}`, {
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

  return { busy, patch }
}

function RowSummary({ doc, canManage }: { doc: DocumentRow; canManage: boolean }): JSX.Element {
  return (
    <div className="min-w-0 flex-1 basis-56">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-black text-me-charcoal">{doc.title}</p>
        {doc.version_label && <Badge tone="quiet">{doc.version_label}</Badge>}
        {doc.status === 'archived' && <Badge tone="quiet">旧版</Badge>}
        {canManage && <Badge tone={doc.visibility === 'client' ? 'warm' : 'quiet'}>{VISIBILITY_LABELS[doc.visibility]}</Badge>}
      </div>
      <p className="mt-0.5 text-xs font-semibold text-me-charcoal/70">
        {fileKindLabel(doc.mime_type)} · {formatBytes(doc.size_bytes)} · {formatDate(doc.created_at)} 放入
      </p>
      {doc.description && <p className="mt-1 whitespace-pre-line text-xs font-semibold text-me-charcoal/70">{doc.description}</p>}
    </div>
  )
}

interface ActionsProps {
  clientId: string
  doc: DocumentRow
  canManage: boolean
  busy: boolean
  onReplace: () => void
  onToggleEdit: () => void
  onToggleArchive: () => void
}

function RowActions({ clientId, doc, canManage, busy, onReplace, onToggleEdit, onToggleArchive }: ActionsProps): JSX.Element {
  const archived = doc.status === 'archived'
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Opens in a new tab so that a refusal (expired login, file gone) never replaces the library page. */}
      <a
        href={`/api/clients/${clientId}/documents/${doc.id}/download`}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-lg bg-me-charcoal px-3 py-1 text-xs font-black text-white hover:bg-me-charcoal/85"
      >
        下载
      </a>
      {canManage && !archived && <button type="button" className={SMALL_BUTTON} onClick={onReplace}>换新版</button>}
      {canManage && <button type="button" className={SMALL_BUTTON} onClick={onToggleEdit}>改信息</button>}
      {canManage && <button type="button" disabled={busy} className={SMALL_BUTTON} onClick={onToggleArchive}>{archived ? '恢复' : '归档'}</button>}
    </div>
  )
}

function RowEditForm(props: { doc: DocumentRow; busy: boolean; onSave: (fields: EditFields) => void; onCancel: () => void }): JSX.Element {
  const { doc, busy, onSave, onCancel } = props
  const [fields, setFields] = useState<EditFields>(() => ({
    title: doc.title,
    category: isDocumentCategory(doc.category) ? doc.category : 'other',
    visibility: doc.visibility,
    versionLabel: doc.version_label ?? '',
    description: doc.description ?? '',
  }))
  const update = <K extends keyof EditFields>(key: K, value: EditFields[K]): void => setFields(prev => ({ ...prev, [key]: value }))

  return (
    <div className="mt-3 grid gap-2 border-t border-black/10 pt-3 sm:grid-cols-2">
      <input aria-label="名称" className={FIELD} value={fields.title} maxLength={200} onChange={e => update('title', e.target.value)} />
      <input aria-label="版本号" className={FIELD} value={fields.versionLabel} maxLength={40} onChange={e => update('versionLabel', e.target.value)} />
      <CategorySelect ariaLabel="类别" className={FIELD} value={fields.category} onChange={value => update('category', value)} />
      <VisibilitySelect ariaLabel="谁能下载" className={FIELD} value={fields.visibility} onChange={value => update('visibility', value)} />
      <VisibilityNote visibility={fields.visibility} />
      <textarea aria-label="说明" className={`${FIELD} sm:col-span-2`} rows={2} maxLength={1000} value={fields.description} onChange={e => update('description', e.target.value)} />
      <div className="flex gap-2 sm:col-span-2">
        <button type="button" disabled={busy || !fields.title.trim()} className="rounded-lg bg-me-charcoal px-3 py-1 text-xs font-black text-white hover:bg-me-charcoal/85 disabled:opacity-40" onClick={() => onSave(fields)}>保存</button>
        <button type="button" className={SMALL_BUTTON} onClick={onCancel}>取消</button>
      </div>
    </div>
  )
}

export function DocumentRowItem({ clientId, doc, canManage, onChanged, onReplace, onError }: Props): JSX.Element {
  const [editing, setEditing] = useState(false)
  const { busy, patch } = useDocumentPatch(clientId, doc.id, onChanged, onError)
  const archived = doc.status === 'archived'

  async function save(fields: EditFields): Promise<void> {
    if (await patch({ ...fields })) setEditing(false)
  }

  return (
    <li className={`rounded-xl border border-black/10 bg-white p-4 ${archived ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <RowSummary doc={doc} canManage={canManage} />
        <RowActions
          clientId={clientId}
          doc={doc}
          canManage={canManage}
          busy={busy}
          onReplace={() => onReplace(doc)}
          onToggleEdit={() => setEditing(open => !open)}
          onToggleArchive={() => void patch({ status: archived ? 'current' : 'archived' })}
        />
      </div>
      {canManage && editing && <RowEditForm doc={doc} busy={busy} onSave={fields => void save(fields)} onCancel={() => setEditing(false)} />}
    </li>
  )
}
