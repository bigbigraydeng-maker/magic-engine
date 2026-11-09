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

function isListResponse(value: unknown): value is DocumentListResponse {
  return typeof value === 'object' && value !== null
    && 'documents' in value && Array.isArray(value.documents)
    && 'canManage' in value && typeof value.canManage === 'boolean'
}

function groupByCategory(documents: DocumentRow[]): Array<{ key: string; label: string; docs: DocumentRow[] }> {
  const keyOf = (doc: DocumentRow): string => (CATEGORY_KEYS.includes(doc.category) ? doc.category : 'other')
  return DOCUMENT_CATEGORIES
    .map(category => ({ key: category.key, label: category.label, docs: documents.filter(doc => keyOf(doc) === category.key) }))
    .filter(group => group.docs.length > 0)
}

export function DocumentLibrary({ clientId }: { clientId: string }): JSX.Element {
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [showArchived, setShowArchived] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [replacing, setReplacing] = useState<DocumentRow | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const query = showArchived ? '?includeArchived=1' : ''
      const res = await fetch(`/api/clients/${clientId}/documents${query}`, { cache: 'no-store' })
      if (!res.ok) {
        setView({ kind: 'blocked', text: blockedText(await readFailure(res)) })
        return
      }
      const json: unknown = await res.json()
      if (!isListResponse(json)) {
        setView({ kind: 'blocked', text: blockedText({ status: 500, error: null, code: null }) })
        return
      }
      setView({ kind: 'ready', documents: json.documents, canManage: json.canManage })
    } catch {
      setView({ kind: 'blocked', text: blockedText({ status: 500, error: null, code: null }) })
    }
  }, [clientId, showArchived])

  useEffect(() => { void load() }, [load])

  const groups = useMemo(() => (view.kind === 'ready' ? groupByCategory(view.documents) : []), [view])

  function openUpload(target: DocumentRow | null): void {
    setReplacing(target)
    setUploadOpen(true)
    setProblem(null)
  }

  function finishUpload(warning: string | null): void {
    setUploadOpen(false)
    setReplacing(null)
    setNotice(warning)
    void load()
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/dashboard/clients/${clientId}`} className="text-xs font-bold text-me-charcoal/70 hover:text-me-ochre">← 返回客户</Link>
          <h1 className="mt-1 text-xl font-black text-me-charcoal">资料库</h1>
          <p className="mt-1 max-w-2xl text-xs font-semibold text-me-charcoal/70">
            公司内部的文件下载：手册、单页资料、价格表等。文件不公开，每次下载都会先核对你的账号。
          </p>
        </div>
        {view.kind === 'ready' && view.canManage && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs font-bold text-me-charcoal/70">
              <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
              显示旧版
            </label>
            <button type="button" onClick={() => openUpload(null)} className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white hover:bg-me-charcoal/85">上传文件</button>
          </div>
        )}
      </div>

      {notice && <p role="status" className="mb-4 rounded-lg border border-me-ochre/30 bg-me-ochre/10 px-3 py-2 text-sm font-bold text-me-charcoal">{notice}</p>}
      {problem && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{problem}</p>}

      {view.kind === 'loading' && <p className="text-sm font-semibold text-me-charcoal/70">加载中…</p>}
      {view.kind === 'blocked' && (
        <div data-testid="documents-notice" className="rounded-xl border border-black/10 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-black text-me-charcoal">{view.text}</p>
        </div>
      )}

      {view.kind === 'ready' && uploadOpen && view.canManage && (
        <UploadForm
          key={replacing?.id ?? 'new'}
          clientId={clientId}
          replacing={replacing}
          onDone={finishUpload}
          onCancel={() => { setUploadOpen(false); setReplacing(null) }}
        />
      )}

      {view.kind === 'ready' && groups.length === 0 && (
        <p className="rounded-xl border border-dashed border-black/15 p-6 text-center text-sm font-semibold text-me-charcoal/70">
          {view.canManage ? '资料库还是空的。点右上角「上传文件」放第一份。' : '还没有可下载的资料。Magic Lab 团队放进来后会出现在这里。'}
        </p>
      )}

      {view.kind === 'ready' && groups.map(group => (
        <section key={group.key} className="mb-6" aria-label={group.label}>
          <h2 className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-[#7A5410]">{group.label}</h2>
          <ul className="grid gap-2">
            {group.docs.map(doc => (
              <DocumentRowItem
                key={doc.id}
                clientId={clientId}
                doc={doc}
                canManage={view.canManage}
                onChanged={() => { setProblem(null); void load() }}
                onReplace={openUpload}
                onError={setProblem}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
