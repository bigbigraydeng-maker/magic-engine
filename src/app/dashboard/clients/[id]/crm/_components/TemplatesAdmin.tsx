'use client'

/**
 * 邮件模板页的主体：列表、状态、历史、打开编辑器。
 * 读失败绝不显示成「没有模板」。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EmailTemplateVersion } from '@/lib/crm/email-templates/types'
import type { ReceiptSummaryRow } from '@/lib/crm/email-templates/receipt-store'
import type { FeatureState } from '@/lib/crm/email-templates/feature-state'
import { isAutomatedTemplateKey } from '@/lib/crm/email-templates/automated-template-key'
import { EMAIL_SETTINGS_SAVED_EVENT } from '@/lib/crm/email-templates/settings-events'
import { MeChip } from '@/components/ui/me-primitives'
import { TemplateEditor, type TemplateVariables } from './TemplateEditor'
import { TemplatePreviewPane } from './TemplatePreviewPane'

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

export function TemplatesAdmin(props: { clientId: string }): JSX.Element {
  const { clientId } = props
  const [data, setData] = useState<ListPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [readError, setReadError] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState>({ kind: 'closed' })
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [showDisabled, setShowDisabled] = useState(false)
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

  // A background read (after the settings were saved) never blanks the page: if it fails, what is on the screen stays,
  // so an open template editor does not lose what is being typed into it.
  const load = useCallback(async (opts: { background?: boolean } = {}) => {
    const background = opts.background === true
    if (!background) {
      setLoading(true)
      setReadError(null)
    }
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/email-templates`)
      const json = (await res.json().catch(() => ({}))) as Partial<ListPayload> & { error?: string }
      if (!res.ok) {
        if (!background) {
          setData(null)
          setReadError(json.error ?? '服务器出错了')
        }
        return
      }
      if (
        !Array.isArray(json.templates) ||
        !Array.isArray(json.stats) ||
        typeof json.featureState !== 'string'
      ) {
        if (!background) {
          setData(null)
          setReadError('返回的数据看不懂')
        }
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
      setReadError(null)
    } catch {
      if (!background) {
        setData(null)
        setReadError('网络出错')
      }
    } finally {
      if (!background) setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const reload = (): void => {
      void load({ background: true })
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
              whenToUse: row.whenToUse ?? null,
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
      setSelectedKey(template.templateKey)
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

  const grouped = useMemo(() => {
    const manual: EmailTemplateVersion[] = []
    const auto: EmailTemplateVersion[] = []
    const disabled: EmailTemplateVersion[] = []
    for (const row of sorted) {
      if (row.status === 'disabled') disabled.push(row)
      else if (isAutomatedTemplateKey(row.templateKey)) auto.push(row)
      else manual.push(row)
    }
    return { manual, auto, disabled }
  }, [sorted])

  const selected = useMemo(
    () => (data && selectedKey ? data.templates.find((t) => t.templateKey === selectedKey) ?? null : null),
    [data, selectedKey],
  )

  useEffect(() => {
    if (!data || selectedKey) return
    const first = grouped.manual[0] ?? grouped.auto[0] ?? grouped.disabled[0]
    if (first) setSelectedKey(first.templateKey)
  }, [data, grouped, selectedKey])

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

      {!loading && readError === null && data && sorted.length > 0 && selected && (
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,300px)_1fr]">
          <TemplateListColumn
            grouped={grouped}
            showDisabled={showDisabled}
            setShowDisabled={setShowDisabled}
            selectedKey={selectedKey}
            setSelectedKey={setSelectedKey}
            stats={data.stats}
          />
          {editor.kind === 'closed' && (
            <TemplatePreviewPane
              row={selected}
              stats={data.stats}
              canEdit={canEdit}
              busy={busyKey === selected.templateKey}
              rowError={rowError[selected.templateKey]}
              onEdit={() => setEditor({ kind: 'edit', initial: selected })}
              onToggleStatus={() => void toggleStatus(selected)}
            />
          )}
        </div>
      )}

      {!loading && readError === null && data && selected && editor.kind === 'closed' && (
        <TemplateHistoryFooter
          canEdit={canEdit}
          selected={selected}
          history={history[selected.templateKey]}
          onToggle={() => toggleHistory(selected.templateKey)}
          onRetry={() => void loadHistory(selected.templateKey)}
          onPrefill={(v) => setEditor({ kind: 'prefill', initial: selected, prefill: v })}
        />
      )}
    </div>
  )
}

function TemplateListColumn(props: {
  grouped: { manual: EmailTemplateVersion[]; auto: EmailTemplateVersion[]; disabled: EmailTemplateVersion[] }
  showDisabled: boolean
  setShowDisabled: (v: boolean | ((p: boolean) => boolean)) => void
  selectedKey: string | null
  setSelectedKey: (k: string) => void
  stats: ReceiptSummaryRow[]
}): JSX.Element {
  const { grouped, showDisabled, setShowDisabled, selectedKey, setSelectedKey, stats } = props
  const render = (row: EmailTemplateVersion) => {
    const sent = statsFor(stats, row.templateKey).sent
    const active = row.templateKey === selectedKey
    return (
      <li key={row.templateKey}>
        <button
          type="button"
          onClick={() => setSelectedKey(row.templateKey)}
          className={`w-full rounded-lg border px-2 py-2 text-left ${active ? 'border-me-ochre bg-me-ochre/10' : 'border-me-charcoal/10 bg-white'}`}
        >
          <span className="text-sm font-bold">{row.name}</span>
          {isAutomatedTemplateKey(row.templateKey) && (
            <span className="ml-1 inline-block">
              <MeChip gold>自动</MeChip>
            </span>
          )}
          <p className="text-[11px] text-me-charcoal/55">近 30 天发出 {sent}</p>
        </button>
      </li>
    )
  }
  return (
    <div className="space-y-3">
      {grouped.manual.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-bold text-me-charcoal/70">同事手动发</h3>
          <ul className="space-y-1">{grouped.manual.map(render)}</ul>
        </section>
      )}
      {grouped.auto.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-bold text-me-charcoal/70">系统自动发</h3>
          <ul className="space-y-1">{grouped.auto.map(render)}</ul>
        </section>
      )}
      {grouped.disabled.length > 0 && (
        <section>
          <button type="button" className="text-xs underline" onClick={() => setShowDisabled((v) => !v)}>
            {showDisabled ? '收起' : '展开'}停用（{grouped.disabled.length}）
          </button>
          {showDisabled && <ul className="mt-1 space-y-1">{grouped.disabled.map(render)}</ul>}
        </section>
      )}
    </div>
  )
}

function TemplateHistoryFooter(props: {
  canEdit: boolean
  selected: EmailTemplateVersion
  history: HistoryPayload | 'loading' | 'error' | undefined
  onToggle: () => void
  onRetry: () => void
  onPrefill: (v: EmailTemplateVersion) => void
}): JSX.Element {
  const { canEdit, history, onToggle, onRetry, onPrefill } = props
  const open = history && history !== 'loading' && history !== 'error'
  return (
    <div className="mt-4 border-t border-me-stone/60 pt-3">
      <button type="button" onClick={onToggle} className="text-xs font-bold underline">
        {open ? '收起历史' : '历史'}
      </button>
      {history === 'loading' && <p className="text-xs">加载历史中…</p>}
      {history === 'error' && (
        <p className="text-xs text-red-800">
          暂时读不到历史。
          <button type="button" onClick={onRetry} className="ml-2 underline">
            重试
          </button>
        </p>
      )}
      {open && (
        <ul className="mt-2 space-y-1 text-[11px]">
          {history.history.map((v) => (
            <li key={v.id}>
              第 {v.version} 版 · {v.changeNote ?? '—'}
              {canEdit && (
                <button type="button" onClick={() => onPrefill(v)} className="ml-2 underline">
                  以这一版写新版本
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
