'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

/**
 * 待认领的 Facebook 对话。
 *
 * 每小时同步是通的，但只有能匹配到已存在联系人的对话才会生成触点
 * （早期版本会凭空造假客户并错并对话，所以保守）。代价是陌生人第一次
 * 发消息永远进不了「今天该联系谁」—— CTS 450 段里 142 段卡在这。
 *
 * 这一页把那批人摆出来，系统先猜「这可能是谁」，顾问只做确认。
 * 认领一次就把 Facebook 账号绑到人身上，之后自动进名单 —— 一次性清理。
 */

interface Candidate {
  id: string
  name: string
  phone: string | null
}

interface Item {
  conversationId: string
  psid: string
  fbName: string
  lastMessage: string | null
  lastMessageAt: string
  candidates: Candidate[]
}

function when(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 3_600_000) return '不到 1 小时前'
  const h = Math.floor(ms / 3_600_000)
  if (h < 48) return `${h} 小时前`
  return `${Math.floor(ms / 86_400_000)} 天前`
}

export default function UnclaimedPage({ params }: { params: { id: string } }) {
  const clientId = params.id
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/messenger/unclaimed`, {
        credentials: 'include',
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '读取失败')
      const json = await res.json()
      setItems(json.items ?? [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取失败')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const claim = async (
    item: Item,
    payload: { contactId?: string; newContactName?: string },
  ) => {
    setBusy(item.conversationId)
    try {
      const res = await fetch(`/api/clients/${clientId}/messenger/unclaimed/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: item.conversationId, ...payload }),
        credentials: 'include',
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '认领失败')

      // 认领成功后从列表里摘掉，不整页刷新 —— 顾问在连续处理一批，
      // 每点一次就跳回顶部会让人失去位置。
      setItems((prev) => prev.filter((i) => i.conversationId !== item.conversationId))
      setToast(`${item.fbName} 已接上，以后他的消息会自动进名单`)
      window.setTimeout(() => setToast(null), 2600)
    } catch (err) {
      setToast(err instanceof Error ? err.message : '认领失败')
      window.setTimeout(() => setToast(null), 2600)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href={`/dashboard/clients/${clientId}/crm`} className="text-sm text-me-charcoal/50 hover:text-me-ochre">
        ← 回到「今天该联系谁」
      </Link>

      <h1 className="mt-3 font-display text-2xl font-black text-me-charcoal">
        待认领的 Facebook 消息
      </h1>
      <p className="mt-1.5 text-sm leading-relaxed text-me-charcoal/60">
        这些人在 Facebook 上发过消息，但系统认不出他们是谁，所以还没进「今天该联系谁」。
        <strong className="text-me-charcoal/80">认一次就够</strong> —— 之后他再发消息会自动进名单。
      </p>

      {toast && (
        <div className="sticky top-2 z-10 mt-4 rounded-xl border border-[#5C8A4A]/30 bg-[#5C8A4A]/10 px-4 py-2.5 text-sm font-bold text-[#3F6733]">
          {toast}
        </div>
      )}

      {loading && <p className="mt-8 text-sm text-me-charcoal/45">读取中…</p>}

      {error && (
        <p className="mt-6 rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 px-4 py-3 text-sm text-[#C2453A]">
          {error}
        </p>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="mt-10 rounded-2xl border border-dashed border-me-charcoal/15 bg-me-ivory/50 p-10 text-center">
          <p className="font-bold text-me-charcoal">全部认领完了</p>
          <p className="mt-1 text-sm text-me-charcoal/55">
            新的陌生消息进来时会出现在这里。
          </p>
        </div>
      )}

      <div className="mt-5 space-y-3">
        {items.map((item) => {
          const working = busy === item.conversationId
          return (
            <div
              key={item.conversationId}
              className="rounded-2xl border border-me-charcoal/10 bg-white p-4 shadow-sm"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[15px] font-black text-me-charcoal">{item.fbName}</span>
                <span className="flex-none text-[11px] text-me-charcoal/40">
                  {when(item.lastMessageAt)}
                </span>
              </div>

              {item.lastMessage && (
                <p className="mt-1.5 line-clamp-3 rounded-lg bg-me-ivory/70 px-3 py-2 text-[13px] leading-relaxed text-me-charcoal/75">
                  「{item.lastMessage}」
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {item.candidates.length > 0 ? (
                  <>
                    <span className="text-[12px] text-me-charcoal/50">
                      {item.candidates.length === 1 ? '这是不是' : '是不是其中一位'}：
                    </span>
                    {item.candidates.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        disabled={working}
                        onClick={() => claim(item, { contactId: c.id })}
                        className="rounded-lg border border-me-ochre/40 bg-white px-3 py-1.5 text-[12px] font-bold text-me-ochre hover:bg-me-ochre/10 disabled:opacity-40"
                      >
                        {c.name}
                        {c.phone && <span className="ml-1.5 font-normal text-me-charcoal/40">{c.phone}</span>}
                      </button>
                    ))}
                  </>
                ) : (
                  <span className="text-[12px] text-me-charcoal/45">
                    没找到同名的老客户，多半是新客人
                  </span>
                )}

                <button
                  type="button"
                  disabled={working}
                  onClick={() => claim(item, { newContactName: item.fbName })}
                  className="rounded-lg border border-me-charcoal/15 px-3 py-1.5 text-[12px] font-bold text-me-charcoal/70 hover:bg-me-ivory disabled:opacity-40"
                >
                  {working ? '处理中…' : '新建客户'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
