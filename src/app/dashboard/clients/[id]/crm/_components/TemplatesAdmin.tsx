'use client'

/**
 * 邮件模板页：左侧列表 + 右侧预览；编辑走 TemplateEditor。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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

function statsFor(stats: ReceiptSummaryRow[], key: string): number {
  return stats.find((s) => s.templateKey === key)?.sent ?? 0
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

  useEffect(() => () => clearTimers(), [clearTimers])

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
      if (!Array.isArray(json.templates) || !Array.isArray(json.stats) || typeof json.featureState !== 'string') {
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

  const grouped = useMemo(() => {
    if (!data) return { manual: [] as EmailTemplateVersion[], auto: [] as EmailTemplateVersion[], disabled: [] as EmailTemplateVersion[] }
    const sorted = sortByName(data.templates)
    const manual: EmailTemplateVersion[] = []
    const auto: EmailTemplateVersion[] = []
    const disabled: EmailTemplateVersion[] = []
    for (const row of sorted) {
      if (row.status === 'disabled') disabled.push(row)
      else if (isAutomatedTemplateKey(row.templateKey)) auto.push(row)
      else manual.push(row)
    }
    return { manual, auto, disabled }
  }, [data])

  useEffect(() => {
    if (!data || selectedKey) return
    const first = grouped.manual[0] ?? grouped.auto[0] ?? grouped.disabled[0]
    if (first) setSelectedKey(first.templateKey)
  }, [data, grouped, selectedKey])

  const selected = useMemo(() => {
    if (!data || !selectedKey) return null
    return data.templates.find((t) => t.templateKey === selectedKey) ?? null
  }, [data, selectedKey])

  const toggleStatus = useCallback(
    async (row: EmailTemplateVersion, nextNote: '启用' | '停用') => {
      if (busyKey !== null) return
      const nextStatus = nextNote === '启用' ? 'active' : 'disabled'
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
              changeNote: nextNote,
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
          setRowError((prev) => ({ ...prev, [row.templateKey]: json.error ?? '保存失败，请稍后再试' }))
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

  const activeCount = grouped.manual.length + grouped.auto.length

  function renderListItem(row: EmailTemplateVersion): JSX.Element {
    const selectedRow = row.templateKey === selectedKey
    const sent = data ? statsFor(data.stats, row.templateKey) : 0
    return (
      <li key={row.templateKey}>
        <button
          type="button"
          onClick={() => setSelectedKey(row.templateKey)}
          className={`w-full rounded-xl border px-3 py-2 text-left transition ${
            selectedRow
              ? 'border-me-ochre bg-me-ochre/10 shadow-[inset_3px_0_0_#C4912E]'
              : 'border-me-charcoal/10 bg-white hover:bg-me-ivory/60'
          }`}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-bold text-me-charcoal">{row.name}</span>
            {isAutomatedTemplateKey(row.templateKey) && (
              <MeChip gold>系统自动发</MeChip>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-me-charcoal/55">
            近 30 天发出 {sent} 次 · 第 {row.version} 版
          </p>
        </button>
      </li>
    )
  }

  if (editor.kind !== 'closed' && data) {
    return (
      <EditorShell>
        <button
          type="button"
          onClick={closeEditor}
          className="mb-3 text-sm text-me-charcoal underline"
        >
          ← 回到模板列表
        </button>
        <TemplateEditor
          clientId={clientId}
          initial={editor.kind === 'new' ? null : editor.initial}
          prefill={editor.kind === 'prefill' ? editor.prefill : null}
          variables={data.variables}
          onSaved={onSaved}
          onCancel={closeEditor}
          onReload={onReload}
          onRequestDeactivate={
            editor.kind === 'edit' && editor.initial.status === 'active'
              ? () => void toggleStatus(editor.initial, '停用')
              : undefined
          }
        />
      </EditorShell>
    )
  }

  return (
    <div data-testid="templates-admin" className="mt-2">
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

      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <TemplatesSummary activeCount={activeCount} data={data} stats={data?.stats ?? []} />
        {canEdit && (
          <button
            type="button"
            onClick={() => setEditor({ kind: 'new' })}
            className="rounded-xl border border-dashed border-me-charcoal/30 px-4 py-2 text-xs font-bold text-me-charcoal"
          >
            + 新建模板
          </button>
        )}
      </div>

      {data && !canEdit && (
        <p className="mb-3 text-xs text-me-charcoal/55">你可以看模板，修改要找 Magic Lab 的同事。</p>
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

      {!loading && readError === null && data && data.templates.length === 0 && (
        <p className="text-xs text-me-charcoal/60">还没有模板。</p>
      )}

      {!loading && readError === null && data && data.templates.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,340px)_1fr]">
          <div className="space-y-4">
            {grouped.manual.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-bold text-me-charcoal/70">同事手动发（{grouped.manual.length}）</h3>
                <ul className="space-y-2" role="list">
                  {grouped.manual.map(renderListItem)}
                </ul>
              </section>
            )}
            {grouped.auto.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-bold text-me-charcoal/70">系统自动发（{grouped.auto.length}）</h3>
                <ul className="space-y-2" role="list">
                  {grouped.auto.map(renderListItem)}
                </ul>
              </section>
            )}
            {grouped.disabled.length > 0 && (
              <section>
                <button
                  type="button"
                  onClick={() => setShowDisabled((v) => !v)}
                  className="text-xs font-bold text-me-charcoal/60 underline"
                >
                  {showDisabled ? '收起' : '展开'}停用的（{grouped.disabled.length}）
                </button>
                {showDisabled && (
                  <ul className="mt-2 space-y-2" role="list">
                    {grouped.disabled.map(renderListItem)}
                  </ul>
                )}
              </section>
            )}
          </div>
          {selected && (
            <TemplatePreviewPane
              row={selected}
              stats={data.stats}
              canEdit={canEdit}
              busy={busyKey === selected.templateKey}
              rowError={rowError[selected.templateKey]}
              onEdit={() => setEditor({ kind: 'edit', initial: selected })}
              onDeactivate={() => void toggleStatus(selected, '停用')}
              onActivate={() => void toggleStatus(selected, '启用')}
              history={selectedKey ? history[selectedKey] ?? null : null}
              onToggleHistory={() => toggleHistory(selected.templateKey)}
              onRetryHistory={() => void loadHistory(selected.templateKey)}
              onPrefillVersion={
                canEdit
                  ? (v) => setEditor({ kind: 'prefill', initial: selected, prefill: v })
                  : undefined
              }
            />
          )}
        </div>
      )}
    </div>
  )
}

function EditorShell({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mx-auto max-w-5xl">{children}</div>
}

function TemplatesSummary(props: {
  activeCount: number
  data: ListPayload | null
  stats: ReceiptSummaryRow[]
}): JSX.Element {
  const { activeCount, data, stats } = props
  const sent30 = stats.reduce((n, s) => (s.templateKey ? n + s.sent : n), 0)
  return (
    <div>
      <p className="text-sm font-bold text-me-charcoal">
        {activeCount} 个模板在用
        {data ? ` · 近 30 天发出 ${sent30} 封` : ''}
      </p>
      <p className="text-xs text-me-charcoal/55">名字和数字是示例样式；以你账号读到的为准。</p>
    </div>
  )
}
