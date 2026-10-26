'use client'

export function FlatPagination(props: {
  total: number
  page: number
  perPage: number
  onPrev: () => void
  onNext: () => void
}) {
  const { total, page, perPage, onPrev, onNext } = props
  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      <span className="text-me-charcoal/50">
        共 {total} 人 · 第 {page} / {Math.max(1, Math.ceil(total / perPage))} 页
      </span>
      <div className="flex gap-2">
        <button
          disabled={page <= 1}
          onClick={onPrev}
          className="rounded-lg border border-black/10 px-3 py-1.5 disabled:opacity-40"
        >
          上一页
        </button>
        <button
          disabled={page >= Math.ceil(total / perPage)}
          onClick={onNext}
          className="rounded-lg border border-black/10 px-3 py-1.5 disabled:opacity-40"
        >
          下一页
        </button>
      </div>
    </div>
  )
}

/*
 * 🔴 段里还有人没显示出来，必须说出来 + 给得出下一步。
 *
 * 服务端一段只下发 100 行。少了这一块的那一版：段头写「217 人」、
 * 表里 100 行、**剩下 117 个人没有任何入口**。两个复审都判 BLOCKER，
 * 形状就是 2026-08-02「33 个人凭空消失」——人数对、人不在。
 */
export function SectionPagerRow(props: {
  total: number
  range: { from: number; to: number; pages: number }
  currentPage: number
  colSpan: number
  onGoPage: (n: number) => void
}) {
  const { total, range, currentPage, colSpan, onGoPage } = props
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-3 text-center text-xs">
        <span className="text-me-charcoal/45">
          这一段共 {total} 人，正在看第 {range.from}–{range.to} 个
          （第 {currentPage} / {range.pages} 页）
        </span>
        <button
          type="button"
          disabled={currentPage <= 1}
          onClick={() => onGoPage(currentPage - 1)}
          className="ml-3 rounded-lg border border-me-charcoal/15 px-2.5 py-1 font-bold text-me-charcoal hover:bg-me-ivory disabled:opacity-40"
        >
          上一页
        </button>
        <button
          type="button"
          disabled={currentPage >= range.pages}
          onClick={() => onGoPage(currentPage + 1)}
          className="ml-2 rounded-lg border border-me-charcoal/15 px-2.5 py-1 font-bold text-me-charcoal hover:bg-me-ivory disabled:opacity-40"
        >
          下一页
        </button>
      </td>
    </tr>
  )
}
