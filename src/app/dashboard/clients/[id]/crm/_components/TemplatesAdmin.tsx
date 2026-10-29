'use client'

/**
 * 邮件模板页的主体：列表、状态、历史、打开编辑器。
 * 读失败绝不显示成「没有模板」。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { EmailTemplateVersion } from '@/lib/crm/email-templates/types'
import type { ReceiptSummaryRow } from '@/lib/crm/email-templates/receipt-store'
import type { FeatureState } from '@/lib/crm/email-templates/feature-state'
import { EMAIL_SETTINGS_SAVED_EVENT } from '@/lib/crm/email-templates/settings-events'
import { TemplateEditor, type TemplateVariables } from './TemplateEditor'

interface ListPayload {
  featureState: FeatureState
  canEditTemplates: boolean
  canEditSettings: boolean
  templates: EmailTemplateVersion[]
  stats: ReceiptSummaryRow[]
  variables: TemplateVariables
}

interface HistoryPayload {
  template: EmailTemplateVersion
  history: EmailTemplateVersion[]
}

type EditorState =
  | { kind: 'closed' }
  | { kind: 'new' }
  | { kind: 'edit'; initial: EmailTemplateVersion }
  | { kind: 'prefill'; initial: EmailTemplateVersion; prefill: EmailTemplateVersion }

function formatNz(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d)
  } catch {
    return '—'
  }
}

function formatNzFull(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d)
  } catch {
    return '—'
  }
}

function bannerText(state: FeatureState): string | null {
  switch (state) {
    case 'ready':
      return null
    case 'disabled':
      return '邮件功能现在是关着的：模板可以先建好，打开之前发不出去。'
    case 'invalid':
      return '发信设置有问题，现在发不出去。'
    case 'unconfigured':
      return '还没配发信设置，现在发不出去。'
    case 'unreadable':
      return '暂时读不到发信设置。'
    default:
      return null
  }
}

function sortByName(list: EmailTemplateVersion[]): EmailTemplateVersion[] {
  return [...list].sort((a, b) => {
    const an = a.name.toLowerCase()
    const bn = b.name.toLowerCase()
    if (an < bn) return -1
    if (an > bn) return 1
    return a.templateKey < b.templateKey ? -1 : a.templateKey > b.templateKey ? 1 : 0
  })
}

function statsFor(stats: ReceiptSummaryRow[], key: string): ReceiptSummaryRow {
  const found = stats.find((s) => s.templateKey === key)
  return found ?? { templateKey: key, sent: 0, blocked: 0, failed: 0, unknown: 0 }
}

function StatusBadge({ status }: { status: EmailTemplateVersion['status'] }) {
  if (status === 'active') {
    return (
      <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-800">
        启用
      </span>
    )
  }
  return (
    <span className="inline-block rounded-full bg-me-stone/40 px-2 py-0.5 text-[11px] font-bold text-me-charcoal/60">
      停用
    </span>
  )
}

export function TemplatesAdmin(props: { clientId: string }): JSX.Element {
  const { clientId } = props
  const [data, setData] = useState<ListPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [readError, setReadError] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState>({ kind: 'closed' })
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [history, setHistory] = useState<Record<string, HistoryPayload | 'loading' | 'error'>>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [rowError, setRowError] = useState<Record<string, string>>({})
  const [notices, setNotices] = useState<string[]>([])
  const [savedVersion, setSavedVersion] = useState<number | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearTimers = useCallback(() => {
    for (const t of timers.current) clearTimeout(t)
    timers.current = []
  }, [])

  useEffect(() => {
    return () => {
      clearTimers()
    }
  }, [clearTimers])

  const load = useCallback(async () => {
    setLoading(true)
    setReadError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/email-templates`)
      const json = (await res.json().catch(() => ({}))) as Partial<ListPayload> & { error?: string }
      if (!res.ok) {
        setData(null)
        setReadError(json.error ?? '服务器出错了')
        return
      }
      if (
        !Array.isArray(json.templates) ||
        !Array.isArray(json.stats) ||
        typeof json.featureState !== 'string'
      ) {
        setData(null)
        setReadError('返回的数据看不懂')
        return
      }
      setData({
        featureState: json.featureState as FeatureState,
        canEditTemplates: json.canEditTemplates === true,
        canEditSettings: json.canEditSettings === true,
        templates: json.templates,
        stats: json.stats,
        variables: (json.variables ?? {}) as TemplateVariables,
      })
    } catch {
      setData(null)
      setReadError('网络出错')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const reload = (): void => {
      void load()
    }
    window.addEventListener(EMAIL_SETTINGS_SAVED_EVENT, reload)
    return () => window.removeEventListener(EMAIL_SETTINGS_SAVED_EVENT, reload)
  }, [load])

  const showNotices = useCallback(
    (list: string[], version: number | null) => {
      clearTimers()
      setNotices(list)
      setSavedVersion(version)
      const t = setTimeout(() => {
        setNotices([])
        setSavedVersion(null)
      }, 6000)
      timers.current.push(t)
    },
    [clearTimers],
  )

  const loadHistory = useCallback(
    async (key: string) => {
      setHistory((prev) => ({ ...prev, [key]: 'loading' }))
      try {
        const res = await fetch(`/api/clients/${clientId}/crm/email-templates/${encodeURIComponent(key)}`)
        const json = (await res.json().catch(() => ({}))) as Partial<HistoryPayload> & { error?: string }
        if (!res.ok || !Array.isArray(json.history) || !json.template) {
          setHistory((prev) => ({ ...prev, [key]: 'error' }))
          return
        }
        setHistory((prev) => ({
          ...prev,
          [key]: { template: json.template as EmailTemplateVersion, history: json.history as EmailTemplateVersion[] },
        }))
      } catch {
        setHistory((prev) => ({ ...prev, [key]: 'error' }))
      }
    },
    [clientId],
  )

  const toggleHistory = useCallback(
    (key: string) => {
      const current = history[key]
      if (current && current !== 'loading' && current !== 'error') {
        setHistory((prev) => {
          const next = { ...prev }
          delete next[key]
          return next
        })
        return
      }
      void loadHistory(key)
    },
    [history, loadHistory],
  )

  const toggleStatus = useCallback(
    async (row: EmailTemplateVersion) => {
      if (busyKey !== null) return
      const nextStatus = row.status === 'active' ? 'disabled' : 'active'
      const note = nextStatus === 'active' ? '启用' : '停用'
      setBusyKey(row.templateKey)
      setRowError((prev) => {
        const next = { ...prev }
        delete next[row.templateKey]
        return next
      })
      try {
        const res = await fetch(
          `/api/clients/${clientId}/crm/email-templates/${encodeURIComponent(row.templateKey)}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              baseVersion: row.version,
              name: row.name,
              subject: row.subject,
              body: row.body,
              factSource: row.factSource,
              pickMode: row.pickMode,
              pickFilter: row.pickFilter,
              status: nextStatus,
              changeNote: note,
            }),
          },
        )
        const json = (await res.json().catch(() => ({}))) as { error?: string; template?: EmailTemplateVersion }
        if (res.status === 409) {
          setRowError((prev) => ({ ...prev, [row.templateKey]: '别人刚改过，请刷新后再试。' }))
          await load()
          return
        }
        if (!res.ok) {
          setRowError((prev) => ({
            ...prev,
            [row.templateKey]: json.error ?? '保存失败，请稍后再试',
          }))
          return
        }
        await load()
        if (json.template && typeof json.template.version === 'number') {
          showNotices([], json.template.version)
        }
      } catch {
        setRowError((prev) => ({ ...prev, [row.templateKey]: '网络出错，请稍后再试' }))
      } finally {
        setBusyKey(null)
      }
    },
    [busyKey, clientId, load, showNotices],
  )

  const closeEditor = useCallback(() => setEditor({ kind: 'closed' }), [])

  const onSaved = useCallback(
    (template: EmailTemplateVersion, incoming: string[]) => {
      setEditor({ kind: 'closed' })
      void load()
      showNotices(incoming, template.version)
    },
    [load, showNotices],
  )

  const onReload = useCallback(() => {
    setEditor({ kind: 'closed' })
    void load()
  }, [load])

  const banner = data ? bannerText(data.featureState) : null
  const canEdit = data?.canEditTemplates === true
  const sorted = data ? sortByName(data.templates) : []

  return (
    <div data-testid="templates-admin" className="mt-4">
      {banner !== null && (
        <p className="mb-3 rounded-lg border border-me-stone/60 bg-me-stone/20 px-3 py-2 text-xs text-me-charcoal/70">
          {banner}
          {data?.canEditSettings ? ' 设置在本页下方。' : ''}
        </p>
      )}

      {notices.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {notices.map((n, i) => (
            <p key={i}>{n}</p>
          ))}
        </div>
      )}
      {savedVersion !== null && (
        <p className="mb-3 text-xs font-semibold text-green-700">✓ 已保存为第 {savedVersion} 版</p>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-black text-me-charcoal">邮件模板</h3>
        {canEdit && (
          <button
            type="button"
            onClick={() => setEditor({ kind: 'new' })}
            className="rounded-lg bg-me-charcoal px-3 py-1.5 text-xs font-bold text-white"
          >
            新建模板
          </button>
        )}
      </div>

      {data && !canEdit && (
        <p className="mb-3 text-xs text-me-charcoal/55">你可以看模板，修改要找 Magic Lab 的同事。</p>
      )}

      {editor.kind !== 'closed' && data && (
        <div className="mb-4">
          <TemplateEditor
            clientId={clientId}
            initial={editor.kind === 'new' ? null : editor.initial}
            prefill={editor.kind === 'prefill' ? editor.prefill : null}
            variables={data.variables}
            onSaved={onSaved}
            onCancel={closeEditor}
            onReload={onReload}
          />
        </div>
      )}

      {loading && <p className="text-xs text-me-charcoal/60">加载中…</p>}

      {!loading && readError !== null && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <p>暂时读不到邮件模板：{readError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-bold text-red-800"
          >
            重试
          </button>
        </div>
      )}

      {!loading && readError === null && data && sorted.length === 0 && (
        <p className="text-xs text-me-charcoal/60">还没有模板。</p>
      )}

      {!loading && readError === null && data && sorted.length > 0 && (
        <ul className="space-y-2">
          {sorted.map((row) => {
            const s = statsFor(data.stats, row.templateKey)
            const isOpen = expanded[row.templateKey] === true
            const hist = history[row.templateKey]
            const err = rowError[row.templateKey]
            return (
              <li
                key={row.templateKey}
                className="rounded-xl border border-me-charcoal/10 bg-me-ivory/40 p-3"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-sm font-bold text-me-charcoal">{row.name}</span>
                  <span className="text-[11px] text-me-charcoal/50">{row.templateKey}</span>
                  <StatusBadge status={row.status} />
                  <span className="text-[11px] text-me-charcoal/60">第 {row.version} 版</span>
                  <span className="text-[11px] text-me-charcoal/60">{formatNz(row.createdAt)}</span>
                </div>
                <p className="mt-1 text-[11px] text-me-charcoal/60">
                  近 30 天：发出 {s.sent} · 被拦 {s.blocked} · 出错 {s.failed} · 不明 {s.unknown}
                </p>

                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((prev) => ({ ...prev, [row.templateKey]: !isOpen }))
                    }
                    className="rounded-lg border border-me-stone bg-white px-2 py-1 text-[11px] font-bold text-me-charcoal"
                  >
                    {isOpen ? '收起内容' : '看内容'}
                  </button>
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditor({ kind: 'edit', initial: row })}
                        className="rounded-lg border border-me-stone bg-white px-2 py-1 text-[11px] font-bold text-me-charcoal"
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleStatus(row)}
                        disabled={busyKey !== null}
                        className="rounded-lg border border-me-stone bg-white px-2 py-1 text-[11px] font-bold text-me-charcoal disabled:opacity-40"
                      >
                        {busyKey === row.templateKey
                          ? '保存中…'
                          : row.status === 'active'
                            ? '停用'
                            : '启用'}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleHistory(row.templateKey)}
                    className="rounded-lg border border-me-stone bg-white px-2 py-1 text-[11px] font-bold text-me-charcoal"
                  >
                    {hist && hist !== 'loading' && hist !== 'error' ? '收起历史' : '历史'}
                  </button>
                </div>

                {err && (
                  <p className="mt-2 text-xs font-semibold text-red-700" role="alert">
                    {err}
                  </p>
                )}

                {isOpen && (
                  <div className="mt-2 rounded-lg border border-me-stone/60 bg-white p-2">
                    <p className="text-[11px] font-bold text-me-charcoal/70">主题</p>
                    <pre className="whitespace-pre-wrap text-xs text-me-charcoal">{row.subject}</pre>
                    <p className="mt-2 text-[11px] font-bold text-me-charcoal/70">正文</p>
                    <pre className="whitespace-pre-wrap text-xs text-me-charcoal">{row.body}</pre>
                  </div>
                )}

                {hist === 'loading' && (
                  <p className="mt-2 text-xs text-me-charcoal/60">加载历史中…</p>
                )}
                {hist === 'error' && (
                  <div className="mt-2 text-xs text-red-800">
                    <p>暂时读不到历史。</p>
                    <button
                      type="button"
                      onClick={() => void loadHistory(row.templateKey)}
                      className="mt-1 rounded-lg border border-red-300 bg-white px-2 py-1 text-[11px] font-bold text-red-800"
                    >
                      重试
                    </button>
                  </div>
                )}
                {hist && hist !== 'loading' && hist !== 'error' && (
                  <ul className="mt-2 space-y-1 border-t border-me-stone/60 pt-2">
                    {hist.history.map((v) => (
                      <li key={v.id} className="text-[11px] text-me-charcoal/70">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-bold">第 {v.version} 版</span>
                          <span>{formatNzFull(v.createdAt)}</span>
                          <span>{v.createdBy}</span>
                          <span>{v.changeNote ?? '—'}</span>
                          <span>{v.status === 'active' ? '启用' : '停用'}</span>
                        </div>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() =>
                              setEditor({ kind: 'prefill', initial: row, prefill: v })
                            }
                            className="mt-1 rounded-lg border border-me-stone bg-white px-2 py-0.5 text-[11px] font-bold text-me-charcoal"
                          >
                            以这一版内容写新版本
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
