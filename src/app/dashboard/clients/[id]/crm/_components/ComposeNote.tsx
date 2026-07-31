'use client'

/**
 * 「记一笔」输入框 —— 两个 CRM 页面共用（今天该联系谁 / 全部客人）。
 *
 * 从 crm/page.tsx 原样抽出，行为逐字不变。抽出的唯一目的：全部客人页
 * 展开某个人时也用同一套录入交互，不重造一份（会漂移）。所以 prop 只收
 * 最小面 —— 一个 contactId 和当前 stage —— 两页各自满足，不互相 import Row。
 *
 * 幂等键在挂载时生成一次、整个提交生命周期复用 —— 双击不会记成两笔。
 * （若在点击时才生成，每次点击都是新键，重复提交就挡不住了。）
 */

import { useState } from 'react'

export interface StageOption {
  stageKey: string
  label: string
}

/** ComposeNote 需要的最小联系人形状 —— 两页各自的 Row 都能满足。 */
export interface ComposeNoteRow {
  contactId: string
  stage: string | null
}

export function ComposeNote({
  clientId,
  row,
  stages,
  onDone,
  onCancel,
}: {
  clientId: string
  row: ComposeNoteRow
  stages: StageOption[]
  onDone: (msg: string) => void
  onCancel: () => void
}) {
  const [clientRef] = useState(() => globalThis.crypto.randomUUID())
  const [note, setNote] = useState('')
  const [inbound, setInbound] = useState(false)
  const [nextStage, setNextStage] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    if (!note.trim() || saving) return
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/touchpoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: row.contactId,
          direction: inbound ? 'inbound' : 'outbound',
          note: note.trim(),
          clientRef,
        }),
      })
      const json = (await res.json()) as { error?: string; created?: boolean }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)

      // created=false 说明这一笔之前就存过（同一个记录框重试）。要说出来，
      // 否则用户以为补写的内容存上了，其实服务端保留的是第一版。
      if (json.created === false) {
        onDone('这一笔之前已经记过了，没有重复记')
        return
      }

      // 顺手把人改到下一步（可跳过）。改失败不能吞——用户以为推进了其实没有。
      if (nextStage && nextStage !== row.stage) {
        const stageRes = await fetch(
          `/api/clients/${clientId}/crm/contacts/${row.contactId}/stage`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toStage: nextStage }),
          },
        )
        if (!stageRes.ok) {
          onDone('✓ 记好了。但他的进度没改上，再点一下改一次。')
          return
        }
      }
      onDone('✓ 记好了')
    } catch (e) {
      setErr(e instanceof Error ? e.message : '没存上，再试一次')
    } finally {
      setSaving(false)
    }
  }

  const pill = (on: boolean) =>
    `rounded-full px-3 py-1 text-xs font-bold ${on ? 'bg-me-charcoal text-white' : 'bg-me-ivory text-me-charcoal/50'}`

  return (
    <div className="mt-3 rounded-lg border border-black/10 bg-me-ivory p-3">
      <div className="mb-2 flex gap-2">
        <button onClick={() => setInbound(false)} className={pill(!inbound)}>我联系的</button>
        <button onClick={() => setInbound(true)} className={pill(inbound)}>客户来找的</button>
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        autoFocus
        placeholder="这次聊了什么？例：聊得不错，想明年三月去，问了长城那个团"
        className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm focus:border-me-charcoal focus:outline-none"
      />

      {stages.length > 0 && (
        <div className="mt-2">
          <label className="text-xs text-me-charcoal/50">要更新他到哪一步吗？（可跳过）</label>
          <select
            value={nextStage}
            onChange={(e) => setNextStage(e.target.value)}
            className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
          >
            <option value="">不改，就记这一笔</option>
            {stages.map((s) => (
              <option key={s.stageKey} value={s.stageKey}>{s.label}</option>
            ))}
          </select>
        </div>
      )}

      {err && <p className="mt-2 text-xs font-semibold text-[#C2453A]">⚠ {err}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => void submit()}
          disabled={!note.trim() || saving}
          className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white disabled:bg-me-charcoal/30"
        >
          {saving ? '存着…' : '存这一笔'}
        </button>
        <button onClick={onCancel} className="text-sm text-me-charcoal/40">取消</button>
      </div>
    </div>
  )
}
