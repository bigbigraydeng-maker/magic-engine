'use client'

/**
 * MessengerEmergencyStopPanel —— 门户「紧急全渠道停」按钮（issue #1589）。
 *
 * 双向开关：停用 + 重新打开。一次点击就把这个客户的 Messenger + WhatsApp
 * AI 客服自动回复全部关掉/重新打开，写审计记录（谁点的、什么时候点的）。
 * 跟 `dashboard/admin/mcp-keys` 页的 kill switch 同一个二次确认模式
 * （`window.prompt` 输入固定短语）——这是一个后果重大的操作，普通的
 * `window.confirm` 太容易被手滑点过去。
 *
 * 🔴 两个方向都要有：一个只能往一个方向拨的"开关"不是真的开关（Codex 复审
 *    2026-09-15 抓到：最早版本只做了停用，文案却承诺"重新打开回这里手动
 *    开"，但代码库里没有任何地方能把开关写回去，误触发之后只能改数据库）。
 *
 * 底层真正的开关逻辑不重新发明：API 路由复用 `stopAiRepliesForClient()` /
 * `resumeAiRepliesForClient()`（`src/lib/knowledge/kill-switch.ts`），
 * 停用那一半跟客户自助确认页上「先别让 AI 回复顾客」按的是同一个开关、
 * 写的是同一张审计表。
 */

import { useState } from 'react'

interface Props {
  clientId: string
}

type Action = 'stop' | 'resume'

const CONFIRM_PHRASE: Record<Action, string> = {
  stop: 'STOP-ALL',
  resume: 'RESUME-ALL',
}

const PROMPT_TEXT: Record<Action, string> = {
  stop: '🚨 这会立刻停掉这个客户的 Messenger + WhatsApp AI 客服自动回复。',
  resume: '✅ 这会立刻重新打开这个客户的 Messenger + WhatsApp AI 客服自动回复。',
}

export function MessengerEmergencyStopPanel({ clientId }: Props) {
  const [busy, setBusy] = useState<Action | null>(null)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const handleClick = async (action: Action) => {
    const phrase = CONFIRM_PHRASE[action]
    const typed = window.prompt(`${PROMPT_TEXT[action]}\n确定的话输入 ${phrase}：`)
    if (typed !== phrase) return

    setBusy(action)
    setResult(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/messenger-agent/kill-switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, confirm: phrase }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        success?: boolean
        error?: string
        auditWarning?: string | null
      }
      if (!res.ok || !body.success) {
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const doneMessage =
        action === 'stop'
          ? '已经停了 —— Messenger 和 WhatsApp 的 AI 客服自动回复现在都是关的。'
          : '已经重新打开 —— Messenger 和 WhatsApp 的 AI 客服自动回复现在都是开的。'
      setResult({
        ok: true,
        message: body.auditWarning ? `${doneMessage}（但这次操作没能记进审计日志：${body.auditWarning}）` : doneMessage,
      })
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4">
      <p className="mb-3 text-sm text-slate-700">
        出事时按左边这个：立刻把这个客户的 Messenger + WhatsApp AI 客服自动回复<strong>全部关掉</strong>，
        不用分别去关两个渠道。关掉后客户的私信会等人工回复，不会再由 AI 自动回。
        误触发或者情况处理完了，按右边那个重新打开。
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => handleClick('stop')}
          disabled={busy !== null}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
        >
          {busy === 'stop' ? '正在关闭…' : '🚨 紧急全渠道停'}
        </button>
        <button
          onClick={() => handleClick('resume')}
          disabled={busy !== null}
          className="rounded-lg border border-emerald-600 bg-white px-4 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === 'resume' ? '正在打开…' : '✅ 重新打开'}
        </button>
      </div>
      {result && (
        <p className={`mt-3 text-xs ${result.ok ? 'text-emerald-700' : 'text-red-700'}`}>
          {result.ok ? '✓ ' : '⚠ '}
          {result.message}
        </p>
      )}
    </div>
  )
}
