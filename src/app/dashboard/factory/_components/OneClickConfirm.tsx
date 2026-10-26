'use client'

import { useState } from 'react'

interface OneClickConfirmProps {
  itemLabels: string[]
  sourceUrl: string
  busy: boolean
  onConfirm: () => void
  onExpand: () => void
}

export function OneClickConfirm({ itemLabels, sourceUrl, busy, onConfirm, onExpand }: OneClickConfirmProps) {
  // Never pre-ticked: the reviewer must say they actually listened with sound on.
  const [listened, setListened] = useState(false)
  // Also never pre-ticked: a person must say this reel makes sense on its own for the fans.
  const [standalone, setStandalone] = useState(false)
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        机器检测已全部通过。请你亲自看完这条片子(画面、声音、价格、来源),确认无误再点下面的按钮。
      </p>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <p className="text-xs text-slate-500 mb-1">点确认 = 你亲自担保以下 {itemLabels.length} 项:</p>
        <ul className="list-disc list-inside space-y-0.5">
          {itemLabels.map((label) => (
            <li key={label} className="text-xs text-slate-500">{label}</li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-slate-600">
        来源网址(已按这条片的链接预填,请点开确认它支持片里的价格/天数/日期):
        <a href={sourceUrl} target="_blank" rel="noreferrer" className="underline break-all">{sourceUrl}</a>
      </p>

      <label className="flex items-start gap-2 text-sm text-slate-800">
        <input type="checkbox" checked={listened} onChange={e => setListened(e.target.checked)} className="mt-1" />
        <span>我已开声音听过，背景音乐里没有人声</span>
      </label>

      <label className="flex items-start gap-2 text-sm text-slate-800">
        <input type="checkbox" checked={standalone} onChange={e => setStandalone(e.target.checked)} className="mt-1" />
        <span>这条单独发给粉丝，他们能看懂在讲什么</span>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy || !listened || !standalone}
          className="h-10 rounded-lg px-5 bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
        >{busy ? '处理中…' : '我已看过这条片子,同意通过'}</button>
        <button
          type="button"
          onClick={onExpand}
          className="text-sm text-slate-500 hover:text-slate-700"
        >展开逐项核对</button>
      </div>
    </div>
  )
}
