'use client'

/**
 * 在 CRM 里直接回私信。
 *
 * 为什么在这（2026-08-02 PM 反馈）：CRM 卡片会对 110 位 CTS 客人写
 *「没留电话 —— 只能在 Messenger 回他」，销售看见了却得跳去另一个页面、
 * 再从几百条会话里翻出这个人。页面承诺了一件事又不给做，比不承诺更糟。
 *
 * **不新增任何发送能力**：整块复用私信页那个 `ReplyBox`（发送前确认、
 * 24 小时窗口提示、usedAiDraft 审计全在里面），发送仍然走既有的
 * `/messenger/conversations/[id]/reply`。这里只做三件事：
 * 把这个人对应到哪条会话、还能不能回、以及把结果告诉抽屉。
 *
 * 直接 import 私信页的组件而不是抄一份：这是**唯一**对真实客户说话的输入框，
 * 抄第二份就意味着以后改确认文案 / 窗口提示时会漏改一处，而漏掉的那一处
 * 正对着客户。
 *
 * 没有私信线的人（只有电话或邮箱）什么都不渲染 —— 不给一个点了没用的按钮。
 */

import { useCallback, useEffect, useState } from 'react'
import { ReplyBox } from '../../messenger/_components/ReplyBox'
import type { ReplyWindow } from '../../messenger/types'

interface Payload {
  conversationId: string | null
  participantName?: string | null
  replyWindow?: ReplyWindow
}

export function MessengerReply({
  clientId,
  contactId,
  customerName,
  viewerEmail,
  onSent,
}: {
  clientId: string
  contactId: string
  customerName: string
  viewerEmail: string | null
  onSent: () => void
}) {
  const [data, setData] = useState<Payload | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${contactId}/messenger`)
      if (!res.ok) throw new Error('load failed')
      setData((await res.json()) as Payload)
    } catch {
      setFailed(true)
    }
  }, [clientId, contactId])

  useEffect(() => {
    void load()
  }, [load])

  // 查不到就当没有私信线：这一块是「多一个能回他的地方」，
  // 读失败不该在抽屉里立一块红色报错挡住记一笔和往来记录。
  if (failed || !data?.conversationId) return null

  return (
    <div className="mt-4 rounded-xl border border-me-charcoal/10 bg-me-ivory/40 p-3">
      <p className="mb-2 text-[13px] font-black text-me-charcoal/70">💬 在这里直接回他的私信</p>
      <ReplyBox
        clientId={clientId}
        conversationId={data.conversationId}
        customerName={data.participantName?.trim() || customerName}
        // CRM 这一侧没有 AI 草稿 —— PM 定的是「AI 只写草稿、人按发送」，
        // 这里本来就没草稿，就老实空着，不去别处凑一个塞给销售。
        draft={null}
        window={data.replyWindow ?? null}
        viewerEmail={viewerEmail}
        onSent={() => {
          // 发完重新问一次窗口 —— 我们这条不会重新开窗，但客人可能在这期间
          // 又说了话，剩余时间要跟着变。
          void load()
          onSent()
        }}
      />
    </div>
  )
}
