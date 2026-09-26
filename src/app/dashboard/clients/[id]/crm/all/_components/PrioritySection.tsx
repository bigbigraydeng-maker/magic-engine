'use client'

/**
 * 分段视图里的一行「段头」—— 段名、这一段多少人、一句话说明、点一下收起/展开。
 *
 * 它是 <tbody> 里的一个 <tr>，不是独立表格：整页仍然只有一张表，段头插在每段
 * 的行前面。这样既拿到了分组，又完全不碰既有的行渲染、展开详情、排序和各种
 * 回调 —— 那些逻辑一行都没动。
 */

export interface PrioritySectionHeaderProps {
  title: string
  hint: string
  total: number
  open: boolean
  /** 跨满整行 —— 段头是插在同一张表 <tbody> 里的一个 <tr>，不是独立表格。 */
  colSpan: number
  onToggle: () => void
}

export function PrioritySectionHeader({ title, hint, total, open, colSpan, onToggle }: PrioritySectionHeaderProps) {
  return (
    <tr className="border-y border-me-charcoal/10 bg-me-ivory/60">
      <td colSpan={colSpan} className="px-4 py-2">
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
          <span className="truncate text-xs text-me-charcoal/45">{hint}</span>
        </button>
      </td>
    </tr>
  )
}
