'use client'

import Link from 'next/link'
import { cx } from '@/components/ui/me-theme'
import type { NavItem } from './nav-types'

export function LightNavLink({
  item,
  active,
}: {
  item: NavItem
  active: boolean
}) {
  const cls = cx(
    'group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-semibold transition',
    active
      ? 'bg-me-ochre/14 text-me-charcoal'
      : item.soon
        ? 'cursor-default text-me-charcoal/35'
        : 'text-me-charcoal/70 hover:bg-black/[.04] hover:text-me-charcoal',
  )

  const mark = (
    <span
      className={cx(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-black',
        active ? 'bg-me-ochre/20 text-me-ochre' : 'bg-me-stone/80 text-me-charcoal/45',
      )}
    >
      {item.mark ?? item.label.slice(0, 1)}
    </span>
  )

  const inner = (
    <>
      {mark}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.badge === 'admin' && (
        <span className="rounded bg-me-charcoal/8 px-1.5 py-0.5 text-[9px] font-bold text-me-charcoal/45">
          管理员
        </span>
      )}
      {item.badge === 'fde' && (
        <span className="rounded bg-me-charcoal/8 px-1.5 py-0.5 text-[9px] font-bold text-me-charcoal/45">
          FDE 可见
        </span>
      )}
    </>
  )

  if (item.soon || !item.href) return <div className={cls}>{inner}</div>
  return (
    <Link href={item.href} className={cls}>
      {inner}
    </Link>
  )
}
