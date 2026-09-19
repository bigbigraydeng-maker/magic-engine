'use client'

/**
 * "AI 草稿 · 待批准" tab (Issue #1588).
 *
 * One-screen review: the customer's own last message + the brief above it →
 * the AI's drafted reply, its confidence, the product names it quoted, and
 * which Verifier gates (#1579) it cleared → three buttons that all resolve
 * to the same decision endpoint (#1586, F3 `conversation.approval.emit`).
 *
 * PM decision (2026-09-15): the customer is never told a reply was AI-drafted
 * — what goes out reads as an ordinary reply from CTS. The labelling below
 * ("AI 起草") is strictly for the FDE/PM looking at THIS internal panel; it
 * must never be copied into `draftBody`/`editedBody`, which is exactly what
 * gets sent.
 */

import React, { useState } from 'react'
import type { PendingDraft, ThreadMessage } from '../types'
import { formatMoment } from './bits'

const GATE_LABELS: Record<string, string> = {
  brand_redline: '品牌红线用词',
  retired_tour_mention: '下架团提及',
  number_claim: '价格/日期核实',
  reply_forbidden_topic: '禁止话题',
  provenance: '产品名称对编码',
  length: '长度限制',
  url_allowlist: '链接白名单',
}

type Action = 'approve' | 'edit_and_approve' | 'reject'

const CONFIRM_TEXT: Record<Action, (name: string) => string> = {
  approve: (name) => `确定批准这条回复吗？\n系统会自动发给 ${name}，你不会再看到一次确认。`,
  edit_and_approve: (name) => `确定发送编辑后的这条回复吗？\n系统会自动发给 ${name}。`,
  reject: (name) => `确定拒绝这条 AI 草稿吗？\n拒绝后不会有任何内容发给 ${name}，你需要自己手动回复。`,
}

function formatConfidence(c: number | null): string {
  if (c === null || Number.isNaN(c)) return '未知'
  return `${Math.round(c * 100)}%`
}

function DraftCard({
  clientId,
  conversationId,
  customerName,
  draft,
  onDecided,
  onRejected,
}: {
  clientId: string
  conversationId: string
  customerName: string
  draft: PendingDraft
  onDecided: (draftId: string) => void
  onRejected: (draftId: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editedBody, setEditedBody] = useState(draft.draftBody)
  const [busy, setBusy] = useState<Action | null>(null)
  const [error, setError] = useState<string | null>(null)

  const decide = async (action: Action) => {
    if (!globalThis.confirm(CONFIRM_TEXT[action](customerName))) return
    setBusy(action)
    setError(null)
    try {
      const res = await fetch(
        `/api/clients/${clientId}/messenger/conversations/${conversationId}/reply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            draft_id: draft.id,
            action,
            ...(action === 'edit_and_approve' ? { edited_body: editedBody.trim() } : {}),
          }),
        },
      )
      const json = (await res.json()) as { error?: string }
      if (!res.ok) {
        setError(json.error ?? '没处理成功，系统已记录。可以再试一次。')
        return
      }
      if (action === 'reject') {
        onRejected(draft.id)
      } else {
        onDecided(draft.id)
      }
    } catch {
      setError('网络没连上，没处理成功。检查网络后再试一次。')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-xl border border-me-stone bg-white p-3.5">
      <p className="mb-2 inline-block rounded-full bg-me-ochre/12 px-2.5 py-1 text-[11px] font-black text-me-ochre">
        🤖 AI 起草 · 客户看到的不会带任何标记 · 内部核对用
      </p>

      {editing ? (
        <textarea
          value={editedBody}
          onChange={(e) => setEditedBody(e.target.value)}
          rows={5}
          maxLength={1800}
          className="w-full rounded-lg border border-me-stone bg-white px-3 py-2.5 text-base leading-relaxed text-me-charcoal outline-none focus:border-me-ochre"
        />
      ) : (
        <p className="whitespace-pre-wrap rounded-lg bg-me-ivory px-3 py-2.5 text-sm leading-relaxed text-me-charcoal">
          {draft.draftBody}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-me-charcoal/45">
        <span>
          置信度 <span className="font-semibold text-me-charcoal/80">{formatConfidence(draft.agentConfidence)}</span>
        </span>
        <span>起草于 {formatMoment(draft.createdAt)}</span>
      </div>

      {draft.quotedOfferingNames.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {draft.quotedOfferingNames.map((name) => (
            <span
              key={name}
              className="rounded-full border border-me-stone px-2 py-0.5 text-[11px] font-semibold text-me-charcoal/70"
            >
              {name}
            </span>
          ))}
        </div>
      )}

      {draft.passedGateIds.length > 0 && (
        <div className="mt-2.5 rounded-lg bg-[#5C8A4A]/8 px-3 py-2">
          <p className="text-[11px] font-black uppercase tracking-[0.1em] text-[#5C8A4A]">
            已过 {draft.passedGateIds.length} 项自动核验
          </p>
          <p className="mt-1 text-xs leading-relaxed text-me-charcoal/70">
            {draft.passedGateIds.map((id) => GATE_LABELS[id] ?? id).join(' · ')}
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2 border-t border-me-stone pt-3">
        {editing ? (
          <>
            <button
              type="button"
              onClick={() => void decide('edit_and_approve')}
              disabled={busy !== null || !editedBody.trim()}
              className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white disabled:opacity-40"
            >
              {busy === 'edit_and_approve' ? '发送中…' : '确认发送改后内容'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setEditedBody(draft.draftBody)
              }}
              disabled={busy !== null}
              className="rounded-lg border border-me-stone px-4 py-2 text-sm font-semibold text-me-charcoal/70"
            >
              取消改稿
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void decide('approve')}
              disabled={busy !== null}
              className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white disabled:opacity-40"
            >
              {busy === 'approve' ? '处理中…' : '批准发送'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={busy !== null}
              className="rounded-lg border border-me-stone px-4 py-2 text-sm font-semibold text-me-charcoal/70 disabled:opacity-40"
            >
              改后发送
            </button>
            <button
              type="button"
              onClick={() => void decide('reject')}
              disabled={busy !== null}
              className="rounded-lg border border-[#C2453A]/30 px-4 py-2 text-sm font-semibold text-[#C2453A] disabled:opacity-40"
            >
              {busy === 'reject' ? '处理中…' : '拒绝并接管'}
            </button>
          </>
        )}
      </div>

      {error && <p className="mt-2 text-sm font-semibold text-[#C2453A]">{error}</p>}
    </div>
  )
}

export function DraftApprovalPanel({
  clientId,
  conversationId,
  customerName,
  drafts,
  draftsError,
  lastCustomerMessage,
  onDecided,
  onRejected,
}: {
  clientId: string
  conversationId: string
  customerName: string
  drafts: PendingDraft[] | null
  draftsError: string | null
  lastCustomerMessage: ThreadMessage | null
  onDecided: (draftId: string) => void
  onRejected: (draftId: string) => void
}) {
  if (draftsError) {
    return <p className="text-sm text-[#C2453A]">{draftsError}</p>
  }

  if (!drafts) {
    return <p className="text-sm text-me-charcoal/45">读取中…</p>
  }

  return (
    <div className="space-y-3">
      {lastCustomerMessage && (
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.1em] text-me-charcoal/45">
            客户原消息
          </p>
          <p className="mt-1 whitespace-pre-wrap rounded-lg bg-me-ivory px-3 py-2.5 text-sm leading-relaxed text-me-charcoal">
            {lastCustomerMessage.body || '（无文字内容）'}
          </p>
        </div>
      )}

      {drafts.length === 0 && (
        <p className="rounded-lg bg-me-ivory px-3 py-2.5 text-sm text-me-charcoal/60">
          现在没有等待批准的 AI 草稿。
        </p>
      )}

      {drafts.map((draft) => (
        <DraftCard
          key={draft.id}
          clientId={clientId}
          conversationId={conversationId}
          customerName={customerName}
          draft={draft}
          onDecided={onDecided}
          onRejected={onRejected}
        />
      ))}
    </div>
  )
}
