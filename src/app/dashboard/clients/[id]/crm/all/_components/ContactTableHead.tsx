'use client'

import { type CustomColumnMeta } from './contact-table-types'

export function ContactTableHead(props: {
  grouped: boolean
  columns: CustomColumnMeta[]
  sortArrow: (key: 'firstSeenAt' | 'lastTouchAt') => string
  onToggleSort: (key: 'firstSeenAt' | 'lastTouchAt') => void
}) {
  const { grouped, columns, sortArrow, onToggleSort } = props
  return (
    <thead>
      <tr className="border-b border-me-charcoal/10 text-left text-xs text-me-charcoal/50">
        <th className="px-2 py-3">⭐</th>
        <th className="px-4 py-3">客人</th>
        {/*
          分段模式下**不给**排序入口：行来自服务端各段的顺序，点了也不会重排。
          留着一个点了会变箭头、却一行都不动的按钮，等于告诉人「你排过了」。
          魏征 B2 实测：箭头会变、顺序一字不动，而平铺那句「排序只对当前页生效」
          的提示在分段下反而被藏起来了。
        */}
        <th
          className={grouped ? 'px-4 py-3' : 'cursor-pointer select-none px-4 py-3'}
          onClick={grouped ? undefined : () => onToggleSort('firstSeenAt')}
        >
          进线时间{grouped ? '' : sortArrow('firstSeenAt')}
        </th>
        <th
          className={grouped ? 'px-4 py-3' : 'cursor-pointer select-none px-4 py-3'}
          onClick={grouped ? undefined : () => onToggleSort('lastTouchAt')}
        >
          最近联系{grouped ? '' : sortArrow('lastTouchAt')}
        </th>
        <th className="px-4 py-3">联系方式</th>
        {columns.map((c) => (
          <th key={c.key} className="px-4 py-3">{c.label}</th>
        ))}
        <th className="px-4 py-3">{grouped ? '该做什么' : '到哪一步了'}</th>
      </tr>
    </thead>
  )
}
