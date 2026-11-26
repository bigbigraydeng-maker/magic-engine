'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CATEGORY_KEYS, DOCUMENT_CATEGORIES } from '@/lib/client-documents/constants'
import type { DocumentListResponse, DocumentRow } from '@/lib/client-documents/types'
import { blockedText, readFailure } from './api-messages'
import { DocumentRowItem } from './DocumentRowItem'
import { UploadForm } from './UploadForm'

type View =
  | { kind: 'loading' }
  | { kind: 'blocked'; text: string }
  | { kind: 'ready'; documents: DocumentRow[]; canManage: boolean }

interface Group { key: string; label: string; docs: DocumentRow[] }

function isListResponse(value: unknown): value is DocumentListResponse {
  return typeof value === 'object' && value !== null
    && 'documents' in value && Array.isArray(value.documents)
    && 'canManage' in value && typeof value.canManage === 'boolean'
}

function groupByCategory(documents: DocumentRow[]): Group[] {
  const keyOf = (doc: DocumentRow): string => (CATEGORY_KEYS.includes(doc.category) ? doc.category : 'other')
  return DOCUMENT_CATEGORIES
    .map(category => ({ key: category.key, label: category.label, docs: documents.filter(doc => keyOf(doc) === category.key) }))
    .filter(group => group.docs.length > 0)
}

const UNREADABLE = blockedText({ status: 500, error: null, code: null })

/** Loads the list for this client; `reload` fetches it again after an upload or an edit. */
function useDocumentList(clientId: string, showArchived: boolean): { view: View; reload: () => void } {
  const [view, setView] = useState<View>({ kind: 'loading' })

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`/api/clients/${clientId}/documents${showArchived ? '?includeArchived=1' : ''}`, { cache: 'no-store' })
      if (!res.ok) return setView({ kind: 'blocked', text: blockedText(await readFailure(res)) })
      const json: unknown = await res.json()
      if (!isListResponse(json)) return setView({ kind: 'blocked', text: UNREADABLE })
      setView({ kind: 'ready', documents: json.documents, canManage: json.canManage })
    } catch {
      setView({ kind: 'blocked', text: UNREADABLE })
    }
  }, [clientId, showArchived])

  useEffect(() => { void load() }, [load])
  return { view, reload: () => void load() }
}

interface HeaderProps {
  clientId: string
  canManage: boolean
  showArchived: boolean
  onShowArchived: (value: boolean) => void
  onUpload: () => void
}

function LibraryHeader({ clientId, canManage, showArchived, onShowArchived, onUpload }: HeaderProps): JSX.Element {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <Link href={`/dashboard/clients/${clientId}`} className="text-xs font-bold text-me-charcoal/70 hover:text-me-ochre">← 返回客户</Link>
        <h1 className="mt-1 text-xl font-black text-me-charcoal">资料库</h1>
        <p className="mt-1 max-w-2xl text-xs font-semibold text-me-charcoal/70">
          公司内部的文件下载：手册、单页资料、价格表等。文件不公开，每次下载都会先核对你的账号。
        </p>
      </div>
      {canManage && (
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs font-bold text-me-charcoal/70">
            <input type="checkbox" checked={showArchived} onChange={e => onShowArchived(e.target.checked)} />
            显示旧版
          </label>
          <button type="button" onClick={onUpload} className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white hover:bg-me-charcoal/85">上传文件</button>
        </div>
      )}
    </div>
  )
}

function Notices({ notice, problem }: { notice: string | null; problem: string | null }): JSX.Element {
  return (
    <>
      {notice && <p role="status" className="mb-4 rounded-lg border border-me-ochre/30 bg-me-ochre/10 px-3 py-2 text-sm font-bold text-me-charcoal">{notice}</p>}
      {problem && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{problem}</p>}
    </>
  )
}

function EmptyNote({ canManage }: { canManage: boolean }): JSX.Element {
  return (
    <p className="rounded-xl border border-dashed border-black/15 p-6 text-center text-sm font-semibold text-me-charcoal/70">
      {canManage ? '资料库还是空的。点右上角「上传文件」放第一份。' : '还没有可下载的资料。Magic Lab 团队放进来后会出现在这里。'}
    </p>
  )
}

interface GroupProps {
  group: Group
  clientId: string
  canManage: boolean
  onChanged: () => void
  onReplace: (doc: DocumentRow) => void
  onError: (text: string) => void
}

function CategoryGroup({ group, clientId, canManage, onChanged, onReplace, onError }: GroupProps): JSX.Element {
  return (
    <section className="mb-6" aria-label={group.label}>
      <h2 className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-[#7A5410]">{group.label}</h2>
      <ul className="grid gap-2">
        {group.docs.map(doc => (
          <DocumentRowItem key={doc.id} clientId={clientId} doc={doc} canManage={canManage} onChanged={onChanged} onReplace={onReplace} onError={onError} />
        ))}
      </ul>
    </section>
  )
}

export function DocumentLibrary({ clientId }: { clientId: string }): JSX.Element {
  const [showArchived, setShowArchived] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [replacing, setReplacing] = useState<DocumentRow | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const { view, reload } = useDocumentList(clientId, showArchived)
  const groups = useMemo(() => (view.kind === 'ready' ? groupByCategory(view.documents) : []), [view])
  const canManage = view.kind === 'ready' && view.canManage

  function openUpload(target: DocumentRow | null): void {
    setReplacing(target)
    setUploadOpen(true)
    setProblem(null)
  }

  function finishUpload(warning: string | null): void {
    setUploadOpen(false)
    setReplacing(null)
    setNotice(warning)
    reload()
  }

  return (
    <div>
      <LibraryHeader clientId={clientId} canManage={canManage} showArchived={showArchived} onShowArchived={setShowArchived} onUpload={() => openUpload(null)} />
      <Notices notice={notice} problem={problem} />
      {view.kind === 'loading' && <p className="text-sm font-semibold text-me-charcoal/70">加载中…</p>}
      {view.kind === 'blocked' && (
        <div data-testid="documents-notice" className="rounded-xl border border-black/10 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-black text-me-charcoal">{view.text}</p>
        </div>
      )}
      {canManage && uploadOpen && (
        <UploadForm key={replacing?.id ?? 'new'} clientId={clientId} replacing={replacing} onDone={finishUpload} onCancel={() => { setUploadOpen(false); setReplacing(null) }} />
      )}
      {view.kind === 'ready' && groups.length === 0 && <EmptyNote canManage={canManage} />}
      {groups.map(group => (
        <CategoryGroup key={group.key} group={group} clientId={clientId} canManage={canManage} onChanged={() => { setProblem(null); reload() }} onReplace={openUpload} onError={setProblem} />
      ))}
    </div>
  )
}
