/**
 * 站内跳转到「全部客人」时立刻显示的骨架屏。
 *
 * 为什么要有：这一页的数据要 1 秒多才回来。没有这个文件时，员工从「今天要联系」
 * 或付款总览点过来，浏览器会**停在原来那一页不动**，等整页算完才一次性切过去 ——
 * 看起来像没点中。有了它，点下去立刻换屏、先看到表头和占位行，心里有底。
 *
 * 纯静态，不取数、不读客户数据，所以不涉及任何权限问题。
 */
export default function Loading(): JSX.Element {
  return (
    <div className="p-6">
      <div className="h-6 w-28 animate-pulse rounded bg-me-charcoal/10" />
      <div className="mt-2 h-4 w-80 animate-pulse rounded bg-me-charcoal/5" />
      <div className="mt-6 space-y-2">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-10 animate-pulse rounded bg-me-charcoal/5" />
        ))}
      </div>
      <p className="mt-4 text-xs text-me-charcoal/45">正在把客人名单取回来…</p>
    </div>
  )
}
