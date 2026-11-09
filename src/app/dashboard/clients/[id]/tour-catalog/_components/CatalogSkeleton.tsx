export function CatalogSkeleton(): JSX.Element {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="正在加载团目录"
      data-testid="catalog-skeleton"
      className="space-y-4"
    >
      <span className="sr-only">正在加载团目录…</span>
      <div className="h-28 animate-pulse rounded-xl bg-black/5" />
      <div className="h-14 animate-pulse rounded-xl bg-black/5" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="h-10 animate-pulse rounded-xl bg-black/5" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl bg-black/5" />
      </div>
    </div>
  )
}
