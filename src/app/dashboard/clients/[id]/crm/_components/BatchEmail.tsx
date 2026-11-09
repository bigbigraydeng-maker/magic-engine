'use client'

/**
 * 给一批人发邮件——不是真的在 ME 里点发送，是「复制地址 → 去自己邮箱粘到密送 →
 * 发完回来点一下记一笔」。地址、「记一笔」的名单、「另有几人没邮箱」全从
 * `batchRecipients()` 这一个函数出，不许各推各的（见 lib/crm/kind-filter 头注：
 * 上一版地址和记录的名单各算各的，复制出 17 个地址却给 20 个人各记了一笔）。
 *
 * 2026-09-28（CRM 重整 B3）：从 `crm/page.tsx`（今天要联系）原样搬出来，函数体
 * 一个字没改，只把 `Bucket` 这个大类型收窄成它真正用到的几个字段——「全部客人」
 * 页（`crm/all/page.tsx`）按「同行/终端客户」筛出来的人不长在 Bucket 里，
 * 没有 `label`/`howTo`/`segment`/`layer` 这些「今天要联系」特有的批次概念。
 */

import { useState } from 'react'
import { batchRecipients, type KindedBucket, type KindedPerson } from '@/lib/crm/kind-filter'

export interface BatchEmailPerson extends KindedPerson {
  contactId: string
}

export interface BatchEmailBucket extends KindedBucket<BatchEmailPerson> {
  batch: 'call_one_by_one' | 'send_email' | 'none'
}

export function BatchEmail({
  clientId,
  bucket,
  onLogged,
}: {
  clientId: string
  bucket: BatchEmailBucket
  onLogged: (msg: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const [logging, setLogging] = useState(false)
  const [clientRef] = useState(() => globalThis.crypto.randomUUID())

  /**
   * 收信人只算一次 —— 地址、「记一笔」的名单、「另有几人没邮箱」全从这里出。
   *
   * 上一版地址和 contactIds 各推各的：复制出 17 个地址，却给 20 个人各记了
   * 一笔「群发了一封邮件」，其中 3 位今天刚说过「不买了」。实际收件人和
   * CRM 记录对不上 —— 那是这套东西最不能犯的错（见 kind-filter 开头）。
   */
  const recipients = batchRecipients(bucket)
  const emails = recipients.map((p) => p.email)
  if (emails.length === 0) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(emails.join('; '))
      setCopied(true)
      setFailed(false)
      window.setTimeout(() => setCopied(false), 4000)
    } catch {
      setFailed(true)
    }
  }

  const logSent = async () => {
    if (logging) return
    setLogging(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/touchpoints/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // 跟 emails 同一批人 —— 分开推必然分叉（上一版就是这么错的）
          contactIds: recipients.map((p) => p.contactId),
          note: '群发了一封邮件',
          clientRef,
        }),
      })
      const json = (await res.json()) as { recorded?: number; error?: string }
      if (!res.ok) throw new Error(json.error ?? '记不上')
      onLogged(`✓ 已经给 ${json.recorded ?? 0} 人各记了一笔`)
    } catch {
      onLogged('没记上，再点一下试试')
    } finally {
      setLogging(false)
    }
  }

  // 「另有 N 人没留邮箱」：只数**本该收信但没邮箱**的。
  // 用 total - emails 会把今天已处理的人也算成「没留邮箱」—— 那是另一件事。
  const missing = bucket.people.filter((p) => !p.doneToday && !p.email).length

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mb-2 w-full rounded-lg border border-me-charcoal/15 bg-white py-2 text-[13px] font-bold text-me-charcoal/70"
      >
        ✉️ 给这批发邮件（{emails.length}）
      </button>
    )
  }

  return (
    <div className="mb-2 rounded-xl border border-me-charcoal/10 bg-white p-2.5">
      <button
        onClick={() => void copy()}
        className="w-full rounded-lg bg-me-charcoal py-2 text-[13px] font-black text-white"
      >
        {copied ? '✓ 已复制 —— 记得粘到「密送」' : `复制这 ${emails.length} 个邮箱`}
      </button>

      <div className="mt-2 rounded-lg border border-[#C2453A]/30 bg-[#C2453A]/8 px-2 py-1.5">
        <p className="text-[12px] font-black leading-snug text-[#C2453A]">
          ⚠️ 一定要粘进「密送 / BCC」那一栏
        </p>
        <p className="mt-0.5 text-[12px] leading-snug text-me-charcoal/65">
          粘到「收件人」栏的话，这 {emails.length} 位客人会互相看到对方的邮箱。
        </p>
      </div>

      <ol className="mt-1.5 space-y-0.5 text-[12px] leading-snug text-me-charcoal/50">
        <li>① 点上面按钮复制</li>
        <li>② 新建邮件，收件人填你自己</li>
        <li>③ 地址粘到「密送 / BCC」</li>
      </ol>

      {failed && (
        <textarea
          readOnly
          value={emails.join('; ')}
          rows={3}
          className="mt-1.5 w-full rounded-lg border border-me-charcoal/10 bg-me-ivory px-2 py-1 text-[12px]"
        />
      )}

      {missing > 0 && (
        <p className="mt-1.5 text-[12px] text-me-charcoal/45">另有 {missing} 人没留邮箱。</p>
      )}

      <button
        onClick={() => void logSent()}
        disabled={logging}
        className="mt-2 w-full rounded-lg border border-me-stone py-1.5 text-[13px] font-bold text-me-charcoal disabled:opacity-40"
      >
        {logging ? '记着…' : '都发出去了，帮我记一笔'}
      </button>
      <button
        onClick={() => setOpen(false)}
        className="mt-1 w-full text-[12px] text-me-charcoal/35"
      >
        收起
      </button>
    </div>
  )
}
