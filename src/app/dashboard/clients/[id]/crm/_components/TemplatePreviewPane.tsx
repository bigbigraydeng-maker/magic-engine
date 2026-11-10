'use client'

import { useState } from 'react'
import type { EmailTemplateVersion } from '@/lib/crm/email-templates/types'

interface HistoryPayload {
  template: EmailTemplateVersion
  history: EmailTemplateVersion[]
}
import type { ReceiptSummaryRow } from '@/lib/crm/email-templates/receipt-store'
import { isAutomatedTemplateKey } from '@/lib/crm/email-templates/automated-template-key'
import { automatedSendDisplay } from '@/lib/crm/email-templates/automated-template-key'
import { MeChip, MePill } from '@/components/ui/me-primitives'
import { TemplateBodyChips } from './TemplateBodyChips'
import { TemplateMoreMenu } from './TemplateMoreMenu'

function statsFor(stats: ReceiptSummaryRow[], key: string): ReceiptSummaryRow {
  const found = stats.find((s) => s.templateKey === key)
  return found ?? { templateKey: key, sent: 0, blocked: 0, failed: 0, unknown: 0 }
}

function formatNz(iso: string): string {
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

export function TemplatePreviewPane(props: {
  row: EmailTemplateVersion
  stats: ReceiptSummaryRow[]
  canEdit: boolean
  busy: boolean
  rowError?: string
  onEdit: () => void
  onDeactivate: () => void
  onActivate: () => void
  history?: HistoryPayload | 'loading' | 'error' | null
  onToggleHistory?: () => void
  onRetryHistory?: () => void
  onPrefillVersion?: (version: EmailTemplateVersion) => void
}): JSX.Element {
  const {
    row,
    stats,
    canEdit,
    busy,
    rowError,
    onEdit,
    onDeactivate,
    onActivate,
    history,
    onToggleHistory,
    onRetryHistory,
    onPrefillVersion,
  } = props
  const [showVariables, setShowVariables] = useState(true)
  const automated = isAutomatedTemplateKey(row.templateKey)
  const autoMeta = automated ? automatedSendDisplay(row.templateKey) : null
  const s = statsFor(stats, row.templateKey)

  return (
    <div className="flex min-h-[24rem] flex-col rounded-xl border border-me-charcoal/10 bg-me-ivory/30 p-4" data-testid="template-preview-pane">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-me-charcoal">{row.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <MePill tone={row.status === 'active' ? 'track' : 'attn'}>{row.status === 'active' ? '在用' : '停用'}</MePill>
            <MeChip>{automated ? '系统自动发' : '同事手动发'}</MeChip>
            <span className="text-xs text-me-charcoal/55">
              第 {row.version} 版 · {formatNz(row.createdAt)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="rounded-lg bg-me-charcoal px-3 py-1.5 text-xs font-bold text-white"
            >
              编辑
            </button>
          )}
          <TemplateMoreMenu
            canEdit={canEdit}
            status={row.status}
            disabled={busy}
            onDeactivate={onDeactivate}
            onActivate={row.status === 'disabled' ? onActivate : undefined}
          />
        </div>
      </div>

      {automated && autoMeta && (
        <section className="mb-3 rounded-lg border border-me-stone/50 bg-white/70 p-3 text-xs text-me-charcoal/80">
          <p className="mb-1 font-bold text-me-charcoal">什么时候发、发给谁</p>
          {autoMeta.trigger && <p className="mt-1">触发：{autoMeta.trigger}</p>}
          {autoMeta.schedule && <p className="mt-1">时间：{autoMeta.schedule}</p>}
          {autoMeta.recipients && <p className="mt-1">对象：{autoMeta.recipients}</p>}
          {!autoMeta.trigger && !autoMeta.schedule && !autoMeta.recipients && (
            <p className="text-me-charcoal/55">暂无自动发信说明。</p>
          )}
        </section>
      )}

      {!automated && (
        <section className="mb-3 rounded-lg border border-me-stone/50 bg-white/70 p-3 text-xs text-me-charcoal/80">
          <p className="font-bold text-me-charcoal">什么时候发、发给谁</p>
          <p className="mt-1">同事在客人资料页选模板，点发送；系统不会自己发。</p>
        </section>
      )}

      <section className="flex-1 rounded-lg border border-me-stone/60 bg-white p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-bold text-me-charcoal/70">客人收到的样子</p>
          <label className="flex items-center gap-2 text-xs text-me-charcoal/70">
            <span>显示变量</span>
            <input
              type="checkbox"
              checked={showVariables}
              onChange={(e) => setShowVariables(e.target.checked)}
              aria-label="显示变量"
            />
          </label>
        </div>
        <p className="text-[11px] text-me-charcoal/55">主题</p>
        <div className="mb-3 mt-1">
          <TemplateBodyChips text={row.subject} showRawUnknown={showVariables} />
        </div>
        <p className="text-[11px] text-me-charcoal/55">正文</p>
        <div className="mt-1 max-h-[22rem] overflow-y-auto">
          <TemplateBodyChips text={row.body} showRawUnknown={showVariables} />
        </div>
      </section>

      <p className="mt-3 text-xs text-me-charcoal/60">
        近 30 天：发出 {s.sent} · 被拦 {s.blocked} · 出错 {s.failed} · 不明 {s.unknown}
      </p>
      {rowError && (
        <p className="mt-2 text-xs font-semibold text-red-700" role="alert">
          {rowError}
        </p>
      )}

      {onToggleHistory && (
        <TemplateHistorySection
          canEdit={canEdit}
          history={history ?? null}
          onToggle={onToggleHistory}
          onRetry={onRetryHistory}
          onPrefill={onPrefillVersion}
        />
      )}
    </div>
  )
}

function TemplateHistorySection(props: {
  canEdit: boolean
  history: HistoryPayload | 'loading' | 'error' | null
  onToggle: () => void
  onRetry?: () => void
  onPrefill?: (version: EmailTemplateVersion) => void
}): JSX.Element {
  const { canEdit, history, onToggle, onRetry, onPrefill } = props
  const open = history !== null && history !== undefined
  return (
    <section className="mt-3 border-t border-me-stone/60 pt-3">
      <button type="button" onClick={onToggle} className="text-xs font-bold text-me-charcoal underline">
        {open && history !== 'loading' && history !== 'error' ? '收起历史' : '版本历史'}
      </button>
      {history === 'loading' && <p className="mt-2 text-xs text-me-charcoal/60">加载历史中…</p>}
      {history === 'error' && (
        <div className="mt-2 text-xs text-red-800">
          <p>暂时读不到历史。</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className="mt-1 rounded-lg border border-red-300 bg-white px-2 py-1 text-[11px] font-bold">
              重试
            </button>
          )}
        </div>
      )}
      {history && history !== 'loading' && history !== 'error' && (
        <ul className="mt-2 space-y-1">
          {history.history.map((v) => (
            <li key={v.id} className="text-[11px] text-me-charcoal/70">
              <span className="font-bold">第 {v.version} 版</span> · {v.changeNote ?? '—'} · {v.status === 'active' ? '启用' : '停用'}
              {canEdit && onPrefill && (
                <button
                  type="button"
                  onClick={() => onPrefill(v)}
                  className="ml-2 rounded-lg border border-me-stone bg-white px-2 py-0.5 text-[11px] font-bold"
                >
                  以这一版内容写新版本
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
