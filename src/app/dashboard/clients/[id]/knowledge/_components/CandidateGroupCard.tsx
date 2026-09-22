'use client'

/**
 * 一个候选组（冲突 / 新增 / 佐证）+ 每条候选的五个操作。
 *
 * 🔴 页面显示的证据只有萃取管道真的存下来的那几项：出现次数、覆盖多少段不同
 * 对话、最早/最近出现日期。设计稿 §3.3 还要求「2–3 条脱敏原句」，但
 * `mining.ts` 写进 `evidence` 的**只有计数**，既没有消息编号也没有脱敏后的
 * 摘录；而 `conversation_messages` 里的原文**没有**脱敏过（只有送进模型的
 * 那份脱敏了）。所以这里不显示原句——显示就等于把没脱敏的顾客隐私摆上内部
 * 屏幕，或者干脆编一段不存在的「原句」。这个缺口在本 issue 的交接说明里明
 * 确点出，留给萃取侧补存脱敏摘录。
 */

import { useState } from 'react'
import type { CandidateGroup, KnowledgeCandidate } from '@/lib/knowledge/review'

const KIND_LABEL: Record<CandidateGroup['kind'], { text: string; tone: string }> = {
  conflict: { text: '互相矛盾', tone: 'bg-[#C2453A] text-white' },
  new: { text: '新增', tone: 'bg-me-charcoal text-white' },
  corroborating: { text: '佐证已有', tone: 'border border-me-stone text-me-charcoal/60' },
}

const SENSITIVITY_LABEL: Record<string, string> = {
  price: '价格',
  timeline: '时效',
  commitment: '承诺',
  policy: '政策',
  general: '一般',
}

function formatDay(iso: string | null): string {
  if (!iso) return '—'
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return '—'
  return new Date(parsed).toLocaleDateString('zh-CN')
}

export interface CandidateGroupCardProps {
  group: CandidateGroup
  busyFactId: string | null
  onDecide: (factId: string, body: Record<string, unknown>) => void
}

export function CandidateGroupCard({ group, busyFactId, onDecide }: CandidateGroupCardProps) {
  const label = KIND_LABEL[group.kind]
  return (
    <section className="rounded-xl border border-black/10 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-black ${label.tone}`}>{label.text}</span>
        {group.kind === 'conflict' && (
          <span className="text-xs text-[#C2453A]">
            同一件事有 {group.candidates.length} 种说法，只能留一条
          </span>
        )}
      </div>

      {group.approvedCounterpart && (
        <p className="mb-3 rounded-lg bg-me-ivory px-3 py-2 text-xs leading-relaxed text-me-charcoal/60">
          现在生效的版本：{group.approvedCounterpart.statement}
          {group.approvedCounterpart.clientConfirmedAt ? '（客户已确认）' : '（客户还没确认）'}
        </p>
      )}

      <div className="space-y-4">
        {group.candidates.map((candidate) => (
          <CandidateRow
            key={candidate.id}
            candidate={candidate}
            busy={busyFactId === candidate.id}
            onDecide={onDecide}
          />
        ))}
      </div>
    </section>
  )
}

function CandidateRow({
  candidate,
  busy,
  onDecide,
}: {
  candidate: KnowledgeCandidate
  busy: boolean
  onDecide: (factId: string, body: Record<string, unknown>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [statement, setStatement] = useState(candidate.statement)
  const [validUntil, setValidUntil] = useState(candidate.validUntil ? candidate.validUntil.slice(0, 10) : '')
  const [note, setNote] = useState('')

  const evidence = candidate.evidence

  return (
    <div className="border-t border-black/5 pt-3 first:border-t-0 first:pt-0">
      <p className="text-sm font-semibold leading-relaxed text-me-charcoal">{candidate.statement}</p>

      <p className="mt-1 text-[11px] text-me-charcoal/45">
        {SENSITIVITY_LABEL[candidate.sensitivity] ?? candidate.sensitivity} · 发出过{' '}
        {evidence.occurrenceCount ?? '—'} 次 · 覆盖 {evidence.distinctConversationCount ?? '—'} 段不同对话 · 最近{' '}
        {formatDay(evidence.lastSeenAt)}
        {evidence.firstSeenAt ? ` · 最早 ${formatDay(evidence.firstSeenAt)}` : ''}
      </p>
      <p className="mt-0.5 text-[11px] text-me-charcoal/30">
        原句不在这里显示：萃取时只存了计数，没存脱敏摘录（见本页说明）
      </p>

      {editing && (
        <div className="mt-3 space-y-2">
          <textarea
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-me-stone p-2 text-sm"
          />
          <label className="block text-xs text-me-charcoal/50">
            有效期到（留空 = 不设）
            <input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className="ml-2 rounded border border-me-stone px-2 py-1 text-sm"
            />
          </label>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {!editing && (
          <>
            <ActionButton
              busy={busy}
              primary
              label="批准"
              onClick={() => onDecide(candidate.id, { action: 'approve' })}
            />
            <ActionButton busy={busy} label="改后批准" onClick={() => setEditing(true)} />
            <ActionButton
              busy={busy}
              label="驳回"
              onClick={() => onDecide(candidate.id, { action: 'reject', note: note || undefined })}
            />
            <ActionButton
              busy={busy}
              label="禁止对客说"
              onClick={() => onDecide(candidate.id, { action: 'forbid' })}
            />
          </>
        )}
        {editing && (
          <>
            <ActionButton
              busy={busy}
              primary
              label="保存并批准"
              onClick={() =>
                onDecide(candidate.id, {
                  action: 'approve_with_edits',
                  statement,
                  valid_until: validUntil ? new Date(validUntil).toISOString() : null,
                })
              }
            />
            <ActionButton
              busy={busy}
              label="只改有效期"
              onClick={() =>
                onDecide(candidate.id, {
                  action: 'set_valid_until',
                  valid_until: validUntil ? new Date(validUntil).toISOString() : null,
                })
              }
            />
            <ActionButton busy={busy} label="取消" onClick={() => setEditing(false)} />
          </>
        )}
      </div>

      {!editing && (
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="驳回原因（选填，会留在这条记录上）"
          className="mt-2 w-full rounded-lg border border-me-stone px-2 py-1.5 text-xs"
        />
      )}
    </div>
  )
}

function ActionButton({
  label,
  onClick,
  busy,
  primary,
}: {
  label: string
  onClick: () => void
  busy: boolean
  primary?: boolean
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-black disabled:opacity-40 ${
        primary ? 'bg-me-charcoal text-white' : 'border border-me-stone text-me-charcoal/70'
      }`}
    >
      {label}
    </button>
  )
}
