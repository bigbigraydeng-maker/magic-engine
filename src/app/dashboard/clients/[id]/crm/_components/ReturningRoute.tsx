'use client'

/**
 * 回头客的「路线」—— 一条竖线，每一步标明是客人做的还是我们做的，中间隔了多久也画出来。
 * 员工扫一眼就知道：他来过几次、我们联系了几次、他沉寂了多久又特意回来。
 * 数据来自 lib/crm/returning-journey（纯函数，接口算好了直接传进来）。
 */

import type { Journey } from '@/lib/crm/returning-journey'

export function ReturningRoute({ journey }: { journey: Journey }) {
  return (
    <div className="mt-2" data-testid="returning-route">
      {journey.reasons.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1" data-testid="returning-reasons">
          {journey.reasons.map((r) => (
            <span key={r} className="rounded-full bg-[#C2453A]/12 px-2 py-0.5 text-[11px] font-bold text-[#C2453A]">
              {r}
            </span>
          ))}
        </div>
      )}
      {journey.tourChange && (
        <p className="mb-2 text-[12px] text-me-charcoal/85" data-testid="returning-tour-change">
          上次选：{journey.tourChange.from} → <span className="font-bold">这次选：{journey.tourChange.to}</span>
        </p>
      )}
      <ol className="space-y-0.5 border-l-2 border-me-charcoal/15 pl-3">
        {journey.items.map((item, i) => {
          if (item.type === 'gap') {
            return (
              <li key={`g${i}`} className="py-0.5 text-[11px] italic text-me-charcoal/50" data-testid="route-gap">
                ⋯ {item.label}
              </li>
            )
          }
          if (item.type === 'omitted') {
            return (
              <li key={`o${i}`} className="py-0.5 text-[11px] text-me-charcoal/50" data-testid="route-omitted">
                {item.label}
              </li>
            )
          }
          const n = item.node
          const mine = n.actor === 'customer'
          return (
            <li
              key={`${n.at}-${n.actor}-${n.kind}`}
              className={mine ? 'text-[12px] font-bold text-me-charcoal' : 'text-[12px] text-me-charcoal/55'}
              data-testid={n.highlight ? 'route-highlight' : 'route-node'}
            >
              <span className="mr-1.5 inline-block w-[3.2em] text-me-charcoal/60">{n.dayLabel}</span>
              {n.highlight ? '🔥 ' : mine ? '● ' : '○ '}
              {n.label}
              {n.count > 1 ? ` ×${n.count}` : ''}
              {n.detail ? <span className="font-normal text-me-charcoal/70"> · {n.detail}</span> : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
