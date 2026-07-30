'use client'

/**
 * 一个人的全渠道往来记录。
 *
 * 看板上点开一个人时展示：他填过的表单、我们打过的每通电话、双方发过的每条
 * 私信（以后是邮件、外呼录音），按时间倒序合成一条线。
 *
 * 「以后会接更多沟通渠道进来」这件事在这里是**零改动**的：渲染按 `kind` 分派，
 * 触点只认 `channel` 字段取一个图标 —— 新渠道进来自动出现在同一条线上，
 * 认不出的渠道退回一个中性图标，不会漏掉也不会炸。
 *
 * 数据来自 GET /crm/contacts/[cid]/timeline（CRM 页面线建的读模型，直接复用）。
 */

import { useCallback, useEffect, useState } from 'react'

export interface TimelineEntry {
  kind: 'touch' | 'stage' | 'message'
  at: string
  // touch
  channel?: string
  direction?: 'inbound' | 'outbound'
  summary?: string | null
  tour?: string | null
  outcome?: string | null
  travelWindow?: string | null
  callbackAt?: string | null
  competitor?: string | null
  // stage
  fromLabel?: string | null
  toLabel?: string | null
  changedBy?: string | null
  note?: string | null
  // message
  senderName?: string | null
  body?: string
}

interface Payload {
  contact: { name: string; phone: string | null; email: string | null; stageLabel: string | null }
  timeline: TimelineEntry[]
  omittedMessages?: number
  error?: string
}

/** 渠道 → 一眼能认的图标。认不出的新渠道给中性圆点，绝不空白。 */
const CHANNEL_ICON: Record<string, string> = {
  phone: '📞',
  meta_lead_form: '📝',
  web_form: '📝',
  messenger: '💬',
  email: '✉️',
  whatsapp: '💬',
}

const CHANNEL_NAME: Record<string, string> = {
  phone: '电话',
  meta_lead_form: 'Facebook 表单',
  web_form: '网站表单',
  messenger: '私信',
  email: '邮件',
  whatsapp: 'WhatsApp',
}

function when(iso: string): string {
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  const date = d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  if (days <= 0) return `今天 ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`
  if (days === 1) return '昨天'
  if (days < 30) return `${date}（${days} 天前）`
  return date
}

export function ContactTimeline({ clientId, contactId }: { clientId: string; contactId: string }) {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${contactId}/timeline`)
      const json = (await res.json()) as Payload
      if (!res.ok) throw new Error(json.error ?? '加载失败')
      setData(json)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [clientId, contactId])

  useEffect(() => { void load() }, [load])

  if (loading) return <p className="py-6 text-center text-xs text-me-charcoal/40">加载往来记录…</p>
  if (err) {
    return (
      <div className="py-4 text-center">
        <p className="text-xs text-[#C2453A]">{err}</p>
        <button onClick={() => void load()} className="mt-1 text-xs font-bold underline">重试</button>
      </div>
    )
  }
  if (!data || data.timeline.length === 0) {
    return <p className="py-6 text-center text-xs text-me-charcoal/40">还没有往来记录。</p>
  }

  return (
    <div className="space-y-2.5">
      {data.timeline.map((e, i) => {
        // 客人说的话 —— 白底靠左；我们说的 —— 灰底靠右缩进。一眼分得出谁在说。
        if (e.kind === 'message') {
          const inbound = e.direction === 'inbound'
          return (
            <div key={i} className={inbound ? '' : 'pl-8'}>
              <div className={`rounded-xl px-3 py-2 ${inbound ? 'bg-white border border-me-charcoal/10' : 'bg-me-ivory'}`}>
                <p className="mb-0.5 text-[10px] font-bold text-me-charcoal/40">
                  {inbound ? (e.senderName || '客人') : '我们'} · {when(e.at)}
                </p>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-me-charcoal/85">{e.body}</p>
              </div>
            </div>
          )
        }

        if (e.kind === 'stage') {
          return (
            <div key={i} className="flex items-baseline gap-2 px-1 text-[11px] text-me-charcoal/45">
              <span>🔀</span>
              <span>
                {e.fromLabel ?? '还没标'} → <span className="font-bold text-me-charcoal/70">{e.toLabel}</span>
                {e.changedBy ? ` · ${e.changedBy.split('@')[0]}` : ''} · {when(e.at)}
              </span>
            </div>
          )
        }

        // 触点：电话 / 表单 / 以后的任何新渠道
        const icon = CHANNEL_ICON[e.channel ?? ''] ?? '•'
        const name = CHANNEL_NAME[e.channel ?? ''] ?? e.channel ?? '接触'
        const chips = [
          e.tour && `想去：${e.tour}`,
          e.travelWindow && `${e.travelWindow} 走`,
          e.competitor && `提到 ${e.competitor}`,
          e.callbackAt && '约了回电',
        ].filter(Boolean) as string[]

        return (
          <div key={i} className="rounded-xl border border-me-charcoal/10 bg-white px-3 py-2">
            <p className="text-[10px] font-bold text-me-charcoal/40">
              {icon} {name}
              {e.direction === 'inbound' ? ' · 客人来的' : ''} · {when(e.at)}
            </p>
            {e.summary && (
              <p className="mt-0.5 text-[13px] leading-relaxed text-me-charcoal/85">{e.summary}</p>
            )}
            {chips.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {chips.map((c) => (
                  <span key={c} className="rounded-full bg-me-ochre/12 px-2 py-0.5 text-[10px] font-bold text-me-ochre">
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {!!data.omittedMessages && (
        <p className="pt-1 text-center text-[10px] text-me-charcoal/30">
          另有 {data.omittedMessages} 条图片 / 表情，没有文字
        </p>
      )}
    </div>
  )
}
