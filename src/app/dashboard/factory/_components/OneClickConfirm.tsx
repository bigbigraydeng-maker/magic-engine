'use client'

interface OneClickConfirmProps {
  itemLabels: string[]
  busy: boolean
  onConfirm: () => void
  onExpand: () => void
}

export function OneClickConfirm({ itemLabels, busy, onConfirm, onExpand }: OneClickConfirmProps) {
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

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
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
