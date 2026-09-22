'use client'

/**
 * 客户知识库 · 审核页（issue #1646，design doc §3.3）。
 *
 * FDE 在这里做两件事：
 *   1. 逐条裁决萃取出来的候选（批准 / 改后批准 / 驳回 / 禁止对客说 / 设有效期）；
 *   2. 把「ME 已批、还等客户签字」的敏感条目打包，发一条一次性确认链接给客户
 *      登记过的确认人。
 *
 * 🔴 页面顺序不是排版偏好：先冲突组、再新增、再佐证（§3.3）。冲突组意味着客
 * 户的员工正在对不同顾客报不同的价——那是今天就在亏钱的事，必须排在最上面。
 * 排序在服务端 `listKnowledgeCandidates` 里定死，前端不重排。
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { CandidateGroupCard } from './_components/CandidateGroupCard'
import { ConfirmationSender } from './_components/ConfirmationSender'
import type { CandidateGroup, CandidatesResponse, ConfirmationsResponse } from './types'

export default function KnowledgePage() {
  const params = useParams()
  const clientId = params.id as string

  const [groups, setGroups] = useState<CandidateGroup[]>([])
  const [confirmations, setConfirmations] = useState<ConfirmationsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyFactId, setBusyFactId] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [candidatesRes, confirmRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/knowledge/candidates`),
        fetch(`/api/clients/${clientId}/knowledge/confirmation-requests`),
      ])
      const candidates = (await candidatesRes.json()) as CandidatesResponse
      const confirms = (await confirmRes.json()) as ConfirmationsResponse
      if (!candidatesRes.ok || !candidates.success) {
        // 🔴 读失败必须长得跟「没东西要审」完全不一样。空列表 + 无错误提示
        // 会让 FDE 直接合上页面走人，而库里其实堆着一组互相矛盾的报价。
        setError(candidates.error ?? '加载待审条目失败')
        return
      }
      setGroups(candidates.groups ?? [])
      setConfirmations(confirmRes.ok && confirms.success ? confirms : { success: false, error: confirms.error })
    } catch {
      setError('加载失败，检查网络后再试。')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  const decide = useCallback(
    (factId: string, body: Record<string, unknown>) => {
      setBusyFactId(factId)
      setNotice(null)
      void (async () => {
        try {
          const res = await fetch(`/api/clients/${clientId}/knowledge/candidates`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fact_id: factId, ...body }),
          })
          const json = (await res.json()) as { success: boolean; error?: string }
          if (!res.ok || !json.success) {
            setNotice(json.error ?? '这次操作没有成功')
            return
          }
          await load()
        } catch {
          setNotice('这次操作没有成功，检查网络后再试。')
        } finally {
          setBusyFactId(null)
        }
      })()
    },
    [clientId, load],
  )

  const send = useCallback(
    async (factIds: string[], confirmerEmail: string) => {
      setSending(true)
      setNotice(null)
      try {
        const res = await fetch(`/api/clients/${clientId}/knowledge/confirmation-requests`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ fact_ids: factIds, confirmer_email: confirmerEmail }),
        })
        const json = (await res.json()) as {
          success: boolean
          error?: string
          emailed?: boolean
          email_error?: string
          fact_count?: number
        }
        if (!res.ok || !json.success) {
          setNotice(json.error ?? '确认链接没发出去')
          return
        }
        setNotice(
          json.emailed
            ? `确认链接已经发给 ${confirmerEmail}（${json.fact_count} 条）。`
            : `链接建好了，但邮件没发出去（${json.email_error ?? '原因不明'}）。请再发一次，或先修好发信配置。`,
        )
        await load()
      } catch {
        setNotice('确认链接没发出去，检查网络后再试。')
      } finally {
        setSending(false)
      }
    },
    [clientId, load],
  )

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <header className="mb-5">
        <Link href={`/dashboard/clients/${clientId}`} className="text-sm text-me-charcoal/40 hover:text-me-charcoal">
          ← 返回客户
        </Link>
        <h1 className="mt-2 text-2xl font-black text-me-charcoal">客户知识库 · 审核</h1>
        <p className="mt-1 text-sm leading-relaxed text-me-charcoal/45">
          这里每一条都是 AI 以后回复顾客时会用的事实。
          <span className="font-semibold text-me-charcoal/60">没人批过的，AI 一个字都不会说。</span>
          价格 / 时效 / 承诺 / 政策这四类，还要客户本人点头才算数。
        </p>
      </header>

      {notice && (
        <div className="mb-4 rounded-xl border border-me-stone bg-me-ivory p-3 text-sm text-me-charcoal">{notice}</div>
      )}

      {loading && <p className="py-16 text-center text-sm text-me-charcoal/40">加载中…</p>}

      {error && (
        <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
          <p className="text-sm font-semibold text-[#C2453A]">{error}</p>
          <p className="mt-1 text-xs text-me-charcoal/50">
            这不是「没有待审条目」——是这次没读到。别按空的来处理。
          </p>
          <button type="button" onClick={() => void load()} className="mt-2 text-sm font-black text-me-charcoal underline">
            重试
          </button>
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-4">
          {confirmations?.success ? (
            <ConfirmationSender
              facts={confirmations.facts ?? []}
              confirmers={confirmations.confirmers ?? []}
              requests={confirmations.requests ?? []}
              onSend={send}
              sending={sending}
            />
          ) : (
            <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-3 text-sm text-[#C2453A]">
              等客户签字的那一栏没读出来：{confirmations?.error ?? '原因不明'}
            </div>
          )}

          <div>
            <h2 className="mb-2 text-base font-black text-me-charcoal">待审条目（{groups.length} 组）</h2>
            {groups.length === 0 ? (
              <p className="rounded-xl border border-black/10 bg-white p-8 text-center text-sm text-me-charcoal/50">
                现在没有待审条目。萃取跑过之后新的候选会出现在这里。
              </p>
            ) : (
              <div className="space-y-3">
                {groups.map((group) => (
                  <CandidateGroupCard key={group.key} group={group} busyFactId={busyFactId} onDecide={decide} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <p className="mt-8 text-center text-[11px] leading-relaxed text-me-charcoal/25">
        证据只显示计数（出现次数 / 覆盖多少段对话 / 首末日期）。萃取时没有存脱敏后的原句，
        原始消息也没有脱敏过，所以这里不显示原句——拿不准就去「客户消息」页看完整对话。
      </p>
    </div>
  )
}
