'use client'

/**
 * 「刚才那通电话怎么样？」
 *
 * ## 这是电话那条线上唯一缺的一环
 *
 * 拨号入口早就有（卡片上点号码就拨出去），结果也早就能用（触点 + 分批规则）。
 * 缺的是**中间那一下**：拨完号浏览器被切走，回来时页面一句话都不问，
 * 于是人转头去记 Excel。线上数字：CTS 的电话记录 **287 条是从 Excel 批量导进来的，
 * ME 自己记下的只有 3 条**。销售天天在打，系统几乎什么都没看到。
 *
 * ## 三个按钮为什么是这三个
 *
 * 电话打完只有三种真实结果，多一个选项就多一次犹豫，而犹豫的结果是不记：
 *
 *   没打通    → 写死 `no_answer`。三天内还会让人再试，三天后交给自动跟进。
 *   打错号了  → 写死 `bad_number`。这个人进「号码要修」，等人补一个对的。
 *   打通了    → **必须说一句聊了什么**，然后走 AI 解析那条路。
 *
 * 前两个的结论是确定的，绝不能交给模型 —— 一通没打通的电话被读成「聊过了」，
 * 这个人就从「还没搭上话」里消失，从此没人再碰。所以它们直接传 `outcome`
 * 跳过解析（见 touchpoints 路由文件头）。
 *
 * 第三个反过来：**不能**写死成 `spoke`。销售打字打的是「他说不要了」
 * 「11 月才走」「约了周三再打」—— 写死会把这些结论全抹掉，而解析器正好
 * 是干这个的（它还兜着 do_not_contact 那条合规底线）。
 *
 * ## 为什么不给「跳过」以外的退路
 *
 * 「不记了」是明写出来的：不给这个出口，人只会关掉标签页，下次拨号
 * 还会看到上一通的残留在问。明着放弃比静悄悄地烂在那强。
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  clearPendingCall,
  getPendingCall,
  getPendingCallServer,
  subscribePendingCall,
  type PendingCall,
} from './pending-call'

type Mode = 'ask' | 'spoke'

export function CallPrompt({
  clientId,
  onLogged,
}: {
  clientId: string
  /** 跟看板其他写入用同一个回调：出 toast + 决定要不要重拉。 */
  onLogged: (msg: string, reload?: boolean) => void
}) {
  const pending = useSyncExternalStore(subscribePendingCall, getPendingCall, getPendingCallServer)

  if (!pending) return null
  // key 用 dialledAt：换了一通电话就换一个组件实例，把输入框和模式全部清干净。
  return <Prompt key={pending.dialledAt} clientId={clientId} call={pending} onLogged={onLogged} />
}

function Prompt({
  clientId,
  call,
  onLogged,
}: {
  clientId: string
  call: PendingCall
  onLogged: (msg: string, reload?: boolean) => void
}) {
  const [mode, setMode] = useState<Mode>('ask')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (mode === 'spoke') inputRef.current?.focus()
  }, [mode])

  /**
   * 写一条触点。
   *
   * `outcome` 给了就跳过 AI 解析（结论确定的两个按钮）；不给就让解析器读
   * 销售打的那句话。两条路都用同一个幂等键，双击不会写两条。
   */
  const log = useCallback(
    async (text: string, outcome: 'no_answer' | 'bad_number' | null, ok: string) => {
      setBusy(true)
      try {
        const res = await fetch(`/api/clients/${clientId}/crm/touchpoints`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            contactId: call.contactId,
            direction: 'outbound',
            note: text,
            // 拨号那一刻才是通话时间，不是点按钮这一刻 —— 中间可能聊了二十分钟。
            occurredAt: call.dialledAt,
            ...(outcome ? { outcome } : {}),
            clientRef: crypto.randomUUID(),
          }),
        })
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string }
          // **失败绝不清掉待办** —— 清了这通电话就永远没了，正是我们在修的病。
          onLogged(`没记上：${j.error ?? '请重试'}`, false)
          return
        }
        clearPendingCall()
        onLogged(ok, true)
      } catch {
        onLogged('网络不通，没记上 —— 恢复后再点一次', false)
      } finally {
        setBusy(false)
      }
    },
    [clientId, call.contactId, call.dialledAt, onLogged],
  )

  const btn =
    'rounded-lg px-3 py-1.5 text-[13.5px] font-bold transition disabled:opacity-40'

  return (
    <div className="sticky top-2 z-40 mb-3 rounded-xl border border-me-ochre/45 bg-me-ochre/[0.07] px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-[14px] font-black text-me-charcoal">
          📞 刚给 {call.name} 打的电话，怎么样？
        </p>

        {mode === 'ask' && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void log('打过去，没人接', 'no_answer', `记下了 —— ${call.name} 没接`)}
              className={`${btn} border border-me-charcoal/20 bg-white text-me-charcoal/75 hover:border-me-charcoal/45`}
            >
              没打通
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode('spoke')}
              className={`${btn} bg-me-charcoal text-white hover:bg-me-charcoal/85`}
            >
              打通了
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void log(`这个号码是错的：${call.phone}`, 'bad_number', '记下了 —— 这个号码要换')
              }
              className={`${btn} text-me-charcoal/45 hover:bg-white hover:text-me-charcoal/80`}
            >
              打错号了
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={clearPendingCall}
              className={`${btn} text-me-charcoal/35 hover:text-me-charcoal/60`}
            >
              不记了
            </button>
          </div>
        )}

        {mode === 'spoke' && (
          <form
            className="flex min-w-[280px] flex-1 flex-wrap items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              const text = note.trim()
              if (!text || busy) return
              void log(text, null, `记下了 —— ${call.name}`)
            }}
          >
            <input
              ref={inputRef}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="聊了什么？例：想 11 月去南岛，要四人报价"
              className="min-w-0 flex-1 rounded-lg border border-me-charcoal/20 bg-white px-3 py-1.5 text-[13.5px] focus:border-me-charcoal focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || note.trim().length === 0}
              className={`${btn} bg-me-charcoal text-white hover:bg-me-charcoal/85`}
            >
              存下来
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode('ask')}
              className={`${btn} text-me-charcoal/40 hover:text-me-charcoal/70`}
            >
              返回
            </button>
          </form>
        )}
      </div>

      {mode === 'spoke' && (
        <p className="mt-1.5 text-[12.5px] leading-snug text-me-charcoal/45">
          随口说就行 —— 说了「不要了」「11 月才走」「约周三再打」，系统会自己读出来并照做。
        </p>
      )}
    </div>
  )
}
