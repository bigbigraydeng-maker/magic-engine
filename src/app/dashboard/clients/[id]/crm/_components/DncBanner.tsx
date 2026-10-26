'use client'

/**
 * 「这个人被标成别再联系」的提示条 + 取消入口 —— **全仓只有这一份控件**。
 *
 * 🔴 **这条路以前不存在**（PM 2026-08-16）。早前的判词把「not intending to go」
 * （我不打算去）当成了「别再联系我」，被误判的人从此收不到我们任何消息 ——
 * 而判据看的是触点，取消客户档案上那个勾**没有用**，况且那个勾在界面上
 * 也没有入口。于是「这个人判错了」是一件**没人做得到**的事。
 *
 * ## 为什么单独拆成一个文件（Codex 复审 2026-08-16）
 *
 * 它最早只长在「今天要联系」那页的抽屉里，而今日待办下发的人工任务，href
 * 指向的是**「全部客人」**那一页 —— 两个页面各有各的详情区。FDE 照着任务
 * 点进去，页面上根本没有任务里说的那个按钮。
 *
 * 一个「照着做也做不成」的人工任务，比不下发更糟：FDE 白跑一趟，第二天
 * 任务又冒出来。所以控件抽出来，谁展示联系人详情谁 import —— 跟
 * `lib/crm/dnc` 只留一份判据是同一条道理。
 *
 * ## 只给「取消」这一个方向
 *
 * 反向（把人标成别再联系）已经有路了 —— 销售记一笔「客户说别再联系」，
 * 解析器会认出来。多一个直接置位的按钮，只会多一个误伤客户的入口。
 *
 * 点之前先确认一次：这是覆盖系统判断的动作，按错了会去打扰一个真的
 * 说过别再联系的人。
 */

import { useRef, useState } from 'react'

export function DncBanner({
  clientId,
  contactId,
  name,
  onSaved,
}: {
  clientId: string
  contactId: string
  name: string
  /** 第二个参数 = 要不要顺手重拉列表；失败时传 false，别让人以为改上了。 */
  onSaved: (msg: string, reload?: boolean) => void
}) {
  const [asking, setAsking] = useState(false)
  const [saving, setSaving] = useState(false)
  // 幂等键：双击 / 重试不该记成两笔纠正。整个组件生命周期内固定一个。
  const refRef = useRef(globalThis.crypto.randomUUID())

  const clear = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${contactId}/dnc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientRef: refRef.current }),
      })
      if (!res.ok) throw new Error(String(res.status))
      /**
       * 🔴 **还差一步就得当面说**（Codex 复审 2026-08-16）。
       *
       * 当初这条误判常常还带来第二个后果：有人接受了「改到停止营销」的建议。
       * 那一档照旧把人挡在名单外 —— 黄条这时已经消失，人却还是不回来，
       * 而且再没有入口。所以接口把还挡着的那一档告诉我们，这里直接说出来，
       * 改阶段的按钮就在同一屏上。
       */
      const json = (await res.json()) as { blockingStageLabel?: string | null }
      onSaved(
        json.blockingStageLabel
          ? `✓ 放回来了，但他还停在「${json.blockingStageLabel}」这一档 —— 用下面的「到哪一步了」改掉才会出现在名单上`
          : `✓ ${name} 放回名单了 —— 明天起会正常出现`,
      )
    } catch {
      onSaved('没改上，再点一下试试', false)
    } finally {
      setSaving(false)
      setAsking(false)
    }
  }

  return (
    <div className="w-full rounded-lg border border-me-ochre/40 bg-me-ochre/10 px-3 py-2">
      <p className="text-[13px] font-bold text-me-charcoal">
        🚫 他被标成「别再联系」—— 我们任何渠道都不会再联系他
      </p>
      {!asking ? (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="mt-1.5 text-[13px] font-bold text-me-ochre underline"
        >
          判错了？点这里放回名单
        </button>
      ) : (
        <div className="mt-1.5">
          <p className="text-[12.5px] text-me-charcoal/70">
            先看一眼下面的往来记录：他原话真的说过「别再联系 / 不要打电话」吗？
            只是「不打算去」的话，放回来是对的。
          </p>
          <div className="mt-1.5 flex gap-2">
            <button
              type="button"
              onClick={() => void clear()}
              disabled={saving}
              className="rounded-lg bg-me-charcoal px-3 py-1.5 text-[13px] font-bold text-white disabled:opacity-50"
            >
              {saving ? '改着…' : '确认放回名单'}
            </button>
            <button
              type="button"
              onClick={() => setAsking(false)}
              disabled={saving}
              className="text-[13px] font-semibold text-me-charcoal/45"
            >
              算了
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
