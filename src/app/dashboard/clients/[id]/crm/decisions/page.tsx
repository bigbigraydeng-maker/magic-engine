/**
 * 「今日决策清单（只读）」已退役（PM 2026-10-25 拍板「修」）。
 *
 * 为什么下掉：它和「全部客人 → ✨ Magic Engine 智能」给的是同一批人、同一套建议，
 * 但那边更好用（有「先打前 20」、能直接操作），而这一页是整个后台最慢的一页——
 * 2026-10-25 实测打开要 8.3 秒，慢在 `/api/clients/[id]/crm/today` 一个接口 6.9 秒；
 * 而且它按「等了多久」排序，等了 127 天的排最前面、昨天刚进线的真客人排到第 300 多位，
 * 员工从上往下打永远打不到最热的线索。
 *
 * 这里保留一个跳转而不是直接删文件：老书签、历史文档里的链接还指着这个地址。
 */
'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

export default function DecisionsRetiredPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const clientId = params?.id

  useEffect(() => {
    if (clientId) router.replace(`/dashboard/clients/${clientId}/crm/all?view=smart`)
  }, [clientId, router])

  return (
    <div className="p-8 text-sm text-me-charcoal/60">
      这一页已经并进「全部客人 → ✨ Magic Engine 智能」，正在带你过去…
    </div>
  )
}
