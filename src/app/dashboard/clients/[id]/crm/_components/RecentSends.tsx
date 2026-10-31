'use client'

/**
 * "最近发送" table: the last 50 send receipts for a client.
 * A failed read is never shown as an empty list.
 */

import { useCallback, useEffect, useState } from 'react'
import type { StoredReceipt } from '@/lib/crm/email-templates/types'

type ReceiptRow = StoredReceipt & { contactName: string | null }

interface Payload {
  receipts: ReceiptRow[]
}

const REASON_LABELS: Record<string, string> = {
  frequency_cap: '最近收到的邮件已达上限',
  frequency_unverifiable: '数不清他收了几封',
  content_blocked: '文字踩了红线',
  placeholder_left: '留有没填的占位符',
  link_host_not_allowed: '链接域名不在白名单',
  link_not_https: '链接不是 https',
  tour_page_not_on_sale: '链接的团页已下架',
  template_outdated: '模板刚更新',
  catalog_outdated: '团目录刚更新',
  template_unavailable: '模板已停用',
  tour_unavailable: '所选团已下架',
  invalid_pick: '选团不对',
  already_followed_up: '通话后已经发过',
  duplicate_template: '同一模板刚发过',
  recipient_not_allowed: '不在试跑名单里',
  not_enquirer: '他没咨询过我们',
  do_not_contact: '别再联系',
  quota: '发送次数到上限',
  busy: '正在发另一封',
  config_invalid: '发信设置有问题',
  internal_error: '系统出错',
  graph_failed: '邮箱发送失败',
  send_unknown: '发送状态不明',
  reconcile_failed: '事后确认没发出去',
}

const OUTCOME_LABELS: Record<string, { text: string; className: string }> = {
  sent: { text: '已发出', className: 'bg-green-100 text-green-800' },
  blocked: { text: '被拦', className: 'bg-amber-100 text-amber-800' },
  failed: { text: '出错', className: 'bg-red-100 text-red-800' },
  unknown: { text: '状态不明', className: 'bg-red-100 text-red-800' },
}

const CALL_BASIS_LABELS: Record<string, string> = {
  system_call: '系统通话',
  staff_attested: '销售确认',
  none: '—',
}

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return timeFormatter.format(d)
}

function actorName(email: string): string {
  const at = email.indexOf('@')
  return at > 0 ? email.slice(0, at) : email
}

function reasonText(receipt: ReceiptRow): string {
  if (receipt.outcome === 'sent') return '—'
  if (!receipt.blockReason) return '—'
  return REASON_LABELS[receipt.blockReason] ?? receipt.blockReason
}

function templateText(receipt: ReceiptRow): string {
  if (receipt.templateKey === null) return '自己写的'
  if (receipt.templateVersion !== null) return `${receipt.templateKey} 第 ${receipt.templateVersion} 版`
  return receipt.templateKey
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const meta = OUTCOME_LABELS[outcome] ?? { text: outcome, className: 'bg-me-stone text-me-charcoal' }
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${meta.className}`}>
      {meta.text}
    </span>
  )
}

export function RecentSends(props: { clientId: string }): JSX.Element {
  const { clientId } = props
  const [rows, setRows] = useState<ReceiptRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/email-send-receipts`)
      const json = (await res.json().catch(() => ({}))) as Partial<Payload> & { error?: string }
      if (!res.ok) {
        setRows(null)
        setError(json.error ?? '服务器没有返回原因')
        return
      }
      setRows(Array.isArray(json.receipts) ? json.receipts : [])
    } catch {
      setRows(null)
      setError('网络出错')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="mt-4 rounded-xl border border-me-charcoal/10 bg-me-ivory/40 p-3" data-testid="recent-sends">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[13px] font-black text-me-charcoal/70">最近发送</p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg border border-me-stone bg-white px-3 py-1 text-xs font-bold text-me-charcoal disabled:opacity-40"
        >
          刷新
        </button>
      </div>

      {loading && <p className="text-xs text-me-charcoal/55">加载中…</p>}

      {!loading && error && (
        <div className="text-xs text-red-700" role="alert">
          <p>暂时读不到发送记录：{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 rounded-lg border border-me-stone bg-white px-3 py-1 text-xs font-bold text-me-charcoal"
          >
            重试
          </button>
        </div>
      )}

      {!loading && !error && rows !== null && rows.length === 0 && (
        <p className="text-xs text-me-charcoal/55">还没有发送记录。</p>
      )}

      {!loading && !error && rows !== null && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-me-charcoal/55">
                <th className="py-1 pr-2 font-semibold">时间</th>
                <th className="py-1 pr-2 font-semibold">谁发的</th>
                <th className="py-1 pr-2 font-semibold">客人</th>
                <th className="py-1 pr-2 font-semibold">模板</th>
                <th className="py-1 pr-2 font-semibold">结果</th>
                <th className="py-1 pr-2 font-semibold">原因</th>
                <th className="py-1 pr-2 font-semibold">通话</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-me-charcoal/10 align-top">
                  <td className="whitespace-nowrap py-1 pr-2 text-me-charcoal/70">{formatTime(r.createdAt)}</td>
                  <td className="py-1 pr-2 text-me-charcoal/70">{actorName(r.actorEmail)}</td>
                  <td className="py-1 pr-2">
                    <a
                      href={`/dashboard/clients/${clientId}/crm/all?contact=${r.contactId}`}
                      className="text-me-ochre underline"
                    >
                      {r.contactName ?? '（没有名字）'}
                    </a>
                  </td>
                  <td className="py-1 pr-2 text-me-charcoal/70">
                    {templateText(r)}
                    {r.editedAfterRender === true && (
                      <span className="ml-1 rounded bg-me-stone px-1 py-0.5 text-[10px] font-semibold text-me-charcoal/70">
                        改过
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-2">
                    <OutcomeBadge outcome={r.outcome} />
                  </td>
                  <td className="py-1 pr-2 text-me-charcoal/70">
                    <div>{reasonText(r)}</div>
                    {r.outcome !== 'sent' && r.blockDetail && (
                      <div className="text-[10px] text-me-charcoal/45">{r.blockDetail}</div>
                    )}
                  </td>
                  <td className="py-1 pr-2 text-me-charcoal/70">
                    {CALL_BASIS_LABELS[r.callBasis] ?? r.callBasis}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
