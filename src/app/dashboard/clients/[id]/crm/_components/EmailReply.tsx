'use client'

/**
 * 在 CRM 里直接回邮件——照 `MessengerReply.tsx` 的样板写（2026-09-15 加邮件时补的
 * 第二条线），那份文件头写的道理原样成立，只换了渠道。
 *
 * **不新增任何发送能力**：整块复用私信页那个 `ReplyBox`（现在已经能认渠道），
 * 发送走 `/email/conversations/[conversationId]/reply`。这里只做三件事：
 * 把这个人对应到哪条邮件线程、还能不能回、以及把结果告诉抽屉。
 *
 * 邮件没有 Messenger 那种 24 小时窗口——不用等接口告诉「还能不能回」，
 * 有会话就能试；真正拦不住的（这个人从没来过信）在发送那一刻由服务端拒绝，
 * 翻成人话显示。
 *
 * 没有邮件线的人（比如只留了电话或还没连过邮箱）什么都不渲染——
 * 不给一个点了没用的按钮。
 */

import { useCallback, useEffect, useState } from 'react'
import { ReplyBox } from '../../messenger/_components/ReplyBox'

interface Payload {
  conversationId: string | null
  participantName?: string | null
}

export function EmailReply({
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
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${contactId}/email`)
      if (!res.ok) throw new Error('load failed')
      setData((await res.json()) as Payload)
    } catch {
      setFailed(true)
    }
  }, [clientId, contactId])

  useEffect(() => {
    void load()
  }, [load])

  // 查不到就当没有邮件线：这一块是「多一个能回他的地方」，读失败不该在
  // 抽屉里立一块红色报错挡住记一笔和往来记录。
  if (failed || !data?.conversationId) return null

  return (
    <div className="mt-4 rounded-xl border border-me-charcoal/10 bg-me-ivory/40 p-3">
      <p className="mb-2 text-[13px] font-black text-me-charcoal/70">📧 在这里直接回他的邮件</p>
      <ReplyBox
        clientId={clientId}
        conversationId={data.conversationId}
        customerName={data.participantName?.trim() || customerName}
        channel="email"
        // CRM 这一侧没有 AI 草稿 —— PM 定的是「AI 只写草稿、人按发送」，
        // 这里本来就没草稿，就老实空着，不去别处凑一个塞给销售。
        draft={null}
        // 邮件没有时限窗口——见文件头。
        window={null}
        viewerEmail={viewerEmail}
        onSent={() => {
          void load()
          onSent()
        }}
      />
    </div>
  )
}
