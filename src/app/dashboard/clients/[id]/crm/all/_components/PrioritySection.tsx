'use client'

/**
 * 分段视图里的一行「段头」—— 段名、这一段多少人、一句话说明、点一下收起/展开。
 *
 * 它是 <tbody> 里的一个 <tr>，不是独立表格：整页仍然只有一张表，段头插在每段
 * 的行前面。这样既拿到了分组，又完全不碰既有的行渲染、展开详情、排序和各种
 * 回调 —— 那些逻辑一行都没动。
 */

const HINT_SEPARATORS = ['；', ';', '，', ',', '。'] as const

/**
 * 段头里那行说明只留最前面那一小截 —— 完整的话太长，会把段名和人数挤到换行。
 * 完整文本仍然挂在 title 上，鼠标停上去能看到。
 */
export function shortHint(hint: string): string {
  const trimmed = hint.trim()
  if (trimmed.length <= 12) return trimmed

  let cut = trimmed.length
  for (const separator of HINT_SEPARATORS) {
    const index = trimmed.indexOf(separator)
    if (index !== -1 && index < cut) cut = index
  }

  let short = trimmed.slice(0, cut).trim()
  if (short.endsWith('个')) {
    const before = short.charAt(short.length - 2)
    if (/\d/.test(before) || before === ' ') short = short.slice(0, -1).trimEnd()
  }

  return short.length > 0 ? short : trimmed
}

export interface PrioritySectionHeaderProps {
  title: string
  hint: string
  total: number
  /** 今天这一段处理了多少人——不传就不显示这一块（不是所有调用方都算得出"今天"这个概念）。 */
  progress?: { total: number; done: number; left: number }
  open: boolean
  /** 跨满整行 —— 段头是插在同一张表 <tbody> 里的一个 <tr>，不是独立表格。 */
  colSpan: number
  onToggle: () => void
}

export function PrioritySectionHeader({ title, hint, total, progress, open, colSpan, onToggle }: PrioritySectionHeaderProps) {
  return (
    <tr className="border-y border-me-charcoal/10 bg-me-ivory/60">
      <td colSpan={colSpan} className="px-4 py-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-center gap-2 text-left"
        >
          <span className="text-xs text-me-charcoal/45">{open ? '▾' : '▸'}</span>
          <span className="text-sm font-black text-me-charcoal">{title}</span>
          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-me-charcoal/70">
            {total} 人
          </span>
          {progress && progress.total > 0 && (
            progress.left === 0 ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
                今天都过了一遍 ✓
              </span>
            ) : (
              <span className="rounded-full bg-me-ivory px-2 py-0.5 text-xs font-bold text-me-charcoal/60">
                今天动过 {progress.done} · 还剩 {progress.left}
              </span>
            )
          )}
          <span className="truncate text-xs text-me-charcoal/45" title={hint}>
            {shortHint(hint)}
          </span>
        </button>
      </td>
    </tr>
  )
}
