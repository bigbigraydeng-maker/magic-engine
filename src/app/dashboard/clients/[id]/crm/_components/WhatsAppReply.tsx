'use client'

/**
 * 在 CRM 抽屉里直接回客人的 WhatsApp。
 *
 * ── 为什么必须有这一块 ────────────────────────────────────────────────────
 * 整条 WhatsApp 链路的前提就是「客人在 WhatsApp 说话，顾问在 ME 里回」。在这之前
 * ME 里没有任何地方能回 —— 回复接口只有 `messenger/` 和 `email/`，抽屉里也只挂了
 * 那两块。魏征和板桥两个复审各自独立撞到同一条：号一接进来、客人一发消息，
 * 顾问看得到却回不了，只能用自己手机回；那条线 ME 完全看不见，于是系统天天误报
 * 「这个客人没人跟进」，假警报一出现这一页就没人信了。
 *
 * ── 跟隔壁 MessengerReply / EmailReply 同形，理由也一样 ──────────────────
 * **不新增任何发送能力**：整块复用私信页那个 `ReplyBox`（发送前确认、窗口提示、
 * usedAiDraft 审计都在里面），发送走 `/whatsapp/conversations/[id]/reply`。
 * 这里只做三件事：把这个人对应到哪条会话、还能不能回、把结果告诉抽屉。
 *
 * 直接 import 那个 `ReplyBox` 而不是抄一份：它是**唯一**对真实客户说话的输入框，
 * 抄第二份就意味着以后改确认文案 / 窗口提示时会漏改一处，而漏掉的那一处正对着客户。
 *
 * 没有 WhatsApp 线的人什么都不渲染 —— 不给一个点了没用的输入框。
 */

import { useCallback, useEffect, useState } from 'react'
import { ReplyBox } from '../../messenger/_components/ReplyBox'
import type { ReplyWindow } from '../../messenger/types'

interface Payload {
  conversationId: string | null
  participantName?: string | null
  replyWindow?: ReplyWindow
}

/** 窗口关了之后那一行话 —— 说清为什么发不了，别让人对着一个灰按钮猜。 */
const CLOSED_TEXT = '他超过 24 小时没说话，WhatsApp 这条路现在发不了。'

export function WhatsAppReply({
  clientId,
  contactId,
  customerName,
  viewerEmail,
  phone,
  email,
  onSent,
}: {
  clientId: string
  contactId: string
  customerName: string
  viewerEmail: string | null
  /** 窗口关了时还能走的两条路 —— 没电话 / 没邮箱就不给那一条。 */
  phone?: string | null
  email?: string | null
  onSent: () => void
}) {
  const [data, setData] = useState<Payload | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${contactId}/whatsapp`)
      if (!res.ok) throw new Error('load failed')
      setData((await res.json()) as Payload)
    } catch {
      setFailed(true)
    }
  }, [clientId, contactId])

  useEffect(() => {
    void load()
  }, [load])

  // 查不到就当没有 WhatsApp 线：这一块是「多一个能回他的地方」，读失败不该在抽屉里
  // 立一块红色报错，挡住记一笔和往来记录（同 MessengerReply 的取舍）。
  if (failed || !data?.conversationId) return null

  // 窗口已关：不再摆一整块发不出去的输入框（PM：按钮太多）。只留一句话 + 还能用的两条路。
  if (data.replyWindow?.kind === 'closed') {
    return (
      <div className="mt-3 rounded-lg bg-[#C2453A]/10 px-3 py-2 text-xs font-semibold text-[#C2453A]" data-testid="reply-closed">
        <span>{CLOSED_TEXT}</span>
        {phone && (
          <a href={`tel:${phone}`} className="ml-2 underline">打电话</a>
        )}
        {email && (
          <a href={`mailto:${email}`} className="ml-2 underline">发邮件</a>
        )}
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-xl border border-me-charcoal/10 bg-me-ivory/40 p-3">
      <p className="mb-2 text-[13px] font-black text-me-charcoal/70">📱 在这里直接回他的 WhatsApp</p>
      <ReplyBox
        clientId={clientId}
        conversationId={data.conversationId}
        customerName={data.participantName?.trim() || customerName}
        channel="whatsapp"
        // CRM 这一侧没有 AI 草稿 —— PM 定的是「AI 只写草稿、人按发送」，这里本来
        // 就没草稿，就老实空着，不去别处凑一个塞给顾问。
        draft={null}
        window={data.replyWindow ?? null}
        viewerEmail={viewerEmail}
        onSent={() => {
          // 发完重新问一次窗口 —— 我们这条不会重新开窗（WhatsApp 的 24 小时从客人
          // 说话算起），但客人可能在这期间又说了话，剩余时间要跟着变。
          void load()
          onSent()
        }}
      />
    </div>
  )
}
