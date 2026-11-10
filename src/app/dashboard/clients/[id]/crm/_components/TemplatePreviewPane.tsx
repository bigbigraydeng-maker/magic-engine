'use client'

import { isAutomatedTemplateKey, automatedSendDisplay } from '@/lib/crm/email-templates/automated-template-key'
import type { EmailTemplateVersion } from '@/lib/crm/email-templates/types'
import type { ReceiptSummaryRow } from '@/lib/crm/email-templates/receipt-store'
import { scanPlaceholders, variableLabel } from '@/lib/crm/email-templates/placeholders'
import { MeChip, MePill } from '@/components/ui/me-primitives'

function rowStats(stats: ReceiptSummaryRow[], key: string): ReceiptSummaryRow {
  return stats.find((s) => s.templateKey === key) ?? { templateKey: key, sent: 0, blocked: 0, failed: 0, unknown: 0 }
}

function TemplateBodyChips({ text }: { text: string }): JSX.Element {
  const refs = scanPlaceholders(text)
  if (refs.length === 0) return <span className="whitespace-pre-wrap text-sm text-me-charcoal">{text}</span>
  const out: JSX.Element[] = []
  let cur = 0
  refs.forEach((ref, i) => {
    if (ref.start > cur) out.push(<span key={`t${i}`}>{text.slice(cur, ref.start)}</span>)
    const label = variableLabel(ref.name)
    out.push(
      <MeChip key={`v${i}`} gold={label !== ref.name}>
        {label === ref.name ? ref.raw : label}
      </MeChip>,
    )
    cur = ref.end
  })
  if (cur < text.length) out.push(<span key="end">{text.slice(cur)}</span>)
  return <div className="flex flex-wrap items-baseline gap-1 text-sm text-me-charcoal">{out}</div>
}

export function TemplatePreviewPane(props: {
  row: EmailTemplateVersion
  stats: ReceiptSummaryRow[]
  canEdit: boolean
  busy: boolean
  rowError?: string
  onEdit: () => void
  onToggleStatus: () => void
}): JSX.Element {
  const { row, stats, canEdit, busy, rowError, onEdit, onToggleStatus } = props
  const auto = isAutomatedTemplateKey(row.templateKey)
  const meta = auto ? automatedSendDisplay(row.templateKey) : null
  const s = rowStats(stats, row.templateKey)

  return (
    <div data-testid="template-preview-pane" className="rounded-xl border border-me-charcoal/10 bg-me-ivory/30 p-4">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-me-charcoal">{row.name}</h2>
          <PreviewMetaBadges row={row} auto={auto} />
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <button type="button" onClick={onEdit} className="rounded-lg bg-me-charcoal px-3 py-1.5 text-xs font-bold text-white">
              编辑
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onToggleStatus}
              className="rounded-lg border border-me-stone bg-white px-2 py-1 text-xs font-bold disabled:opacity-40"
            >
              {busy ? '保存中…' : row.status === 'active' ? '停用' : '启用'}
            </button>
          </div>
        )}
      </div>
      {auto && meta && (
        <p className="mb-2 text-xs text-me-charcoal/75">
          {[meta.trigger && `触发：${meta.trigger}`, meta.schedule && `时间：${meta.schedule}`, meta.recipients && `对象：${meta.recipients}`]
            .filter(Boolean)
            .join('；')}
        </p>
      )}
      {!auto && <p className="mb-2 text-xs text-me-charcoal/75">同事在客人资料页选手动发送；系统不会自己发。</p>}
      <div className="rounded-lg border border-me-stone/60 bg-white p-3">
        <p className="text-[11px] font-bold text-me-charcoal/70">主题</p>
        <div className="mb-2 mt-1"><TemplateBodyChips text={row.subject} /></div>
        <p className="text-[11px] font-bold text-me-charcoal/70">正文</p>
        <div className="mt-1 max-h-80 overflow-y-auto">
          <TemplateBodyChips text={row.body} />
        </div>
      </div>
      <p className="mt-2 text-xs text-me-charcoal/60">
        近 30 天：发出 {s.sent} · 被拦 {s.blocked} · 出错 {s.failed}
      </p>
      {rowError && (
        <p className="mt-1 text-xs text-red-700" role="alert">
          {rowError}
        </p>
      )}
    </div>
  )
}

function PreviewMetaBadges({ row, auto }: { row: EmailTemplateVersion; auto: boolean }): JSX.Element {
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      <MePill tone={row.status === 'active' ? 'track' : 'attn'}>{row.status === 'active' ? '在用' : '停用'}</MePill>
      <MeChip>{auto ? '系统自动发' : '同事手动发'}</MeChip>
      <span className="text-xs text-me-charcoal/55">第 {row.version} 版</span>
    </div>
  )
}
