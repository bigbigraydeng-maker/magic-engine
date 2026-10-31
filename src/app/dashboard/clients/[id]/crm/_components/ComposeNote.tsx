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
import { CALLBACK_PRESETS, CALLBACK_PRESET_LABELS, type CallbackPreset } from '@/lib/crm/callback-presets'

export interface StageOption {
  stageKey: string
  label: string
  /**
   * 下面三个只给 lib/crm/drawer-actions 算「下一步该改到哪」用。
   * 丢掉它们的话，抽屉里那几个阶段快捷键会退化成「随便挑两个」——
   * 顺序算不出来，「谈崩了」的出口也认不出来。
   */
  sortOrder?: number
  marketingAction?: string
  isTerminal?: boolean
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
  const [callbackPreset, setCallbackPreset] = useState<CallbackPreset | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [customAt, setCustomAt] = useState('')
  const customChosen = customOpen && customAt !== ''
  const hasCallback = callbackPreset !== null || customChosen

  const submit = async () => {
    const text =
      note.trim() ||
      (hasCallback
        ? `约好回电：${callbackPreset ? CALLBACK_PRESET_LABELS[callbackPreset] : customAt.replace('T', ' ')}`
        : '')
    if (!text || saving) return
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/touchpoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: row.contactId,
          direction: inbound ? 'inbound' : 'outbound',
          note: text,
          clientRef,
          ...(callbackPreset ? { callbackPreset } : {}),
          ...(customChosen ? { callbackAt: customAt } : {}),
        }),
      })
      const json = (await res.json()) as {
        error?: string
        created?: boolean
        parsed?: { do_not_contact?: boolean }
        callbackBooked?: string | null
      }
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
      /**
       * ⚠️ **读出「别再联系」时必须当场说出来**（Codex 复审 2026-08-15 指出的
       * 那个缺口的真正痛点）。
       *
       * 别的动作现在都是「就地变灰、留在原位」，唯独这一条**人会立刻从名单上
       * 消失** —— 而且是解析器从你打的字里读出来的，你可能根本没打算这么做
       * （「客户说这次先不考虑，别再打了」）。原先只回一句「✓ 记好了」，
       * 人就没了，销售第一反应是「我是不是把他删了」。
       *
       * 消失本身是**刻意的、不改**（理由见 day-list.ts 里那段说明）：说过
       * 「别再打」的人，最安全的状态就是立刻离开拨号名单。要修的是「不说话」。
       */
      // ⚠️ 这句话**两个页面共用**（今天该联系谁 / 全部客人），所以不能提「下面
      // 那一栏」—— 全部客人页没有那一栏，而且他照旧留在表格里（Codex 第五轮）。
      // 只说在两个页面都成立的事实：他不会再进今天要联系的名单，但档案还在。
      onDone(
        json.parsed?.do_not_contact
          ? '✓ 记好了 —— 读出他说「别再联系」，他不会再进「今天要联系」的名单。档案还在，「全部客人」里随时翻得到'
          : json.callbackBooked
            ? `✓ 记好了 —— ${json.callbackBooked}`
            : '✓ 记好了',
      )
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

      <div className="mt-2">
        <label className="text-xs text-me-charcoal/50">约了回电吗？点一个就行（可跳过）</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {CALLBACK_PRESETS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setCallbackPreset(callbackPreset === key ? null : key)
                setCustomOpen(false)
                setCustomAt('')
              }}
              className={pill(callbackPreset === key)}
            >
              {CALLBACK_PRESET_LABELS[key]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              if (customOpen) {
                setCustomOpen(false)
                setCustomAt('')
              } else {
                setCustomOpen(true)
                setCallbackPreset(null)
              }
            }}
            className={pill(customOpen)}
          >
            自选时间
          </button>
        </div>
        {customOpen && (
          <input
            type="datetime-local"
            value={customAt}
            onChange={(e) => setCustomAt(e.target.value)}
            className="mt-2 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
          />
        )}
      </div>

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
          disabled={(!note.trim() && !hasCallback) || saving}
          className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white disabled:bg-me-charcoal/30"
        >
          {saving ? '存着…' : '存这一笔'}
        </button>
        <button onClick={onCancel} className="text-sm text-me-charcoal/40">取消</button>
      </div>
    </div>
  )
}
