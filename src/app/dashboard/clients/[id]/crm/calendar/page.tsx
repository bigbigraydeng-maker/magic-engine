/**
 * 到期日历 —— 占位页。真正的日历是后面单独的一件事，这一页现在没有任何数据，
 * 只是让顶上导航的「到期日历」有地方可去。
 */
export default function CrmCalendarPlaceholderPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-6 sm:px-8">
      <p className="rounded border border-dashed border-me-charcoal/30 p-6 text-sm text-me-charcoal/70">
        到期日历：下一步做
      </p>
    </div>
  )
}
