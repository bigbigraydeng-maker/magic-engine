'use client'

import { type CustomColumnMeta } from './contact-table-types'

export function ContactTableHead(props: {
  grouped: boolean
  columns: CustomColumnMeta[]
  sortArrow: (key: 'firstSeenAt' | 'lastTouchAt') => string
  onToggleSort: (key: 'firstSeenAt' | 'lastTouchAt') => void
}) {
  const { grouped, columns, sortArrow, onToggleSort } = props
  // 「今天先联系」只留三样：客人 / 该做什么 / 联系渠道（PM 2026-10-29：第一眼进来太懵）。
  // 进线时间、最近联系、联系方式和自定义列都收进点开后的详情；要翻全部信息去「全部客人」。
  if (grouped) {
    return (
      <thead>
        <tr className="border-b border-me-charcoal/10 text-left text-xs text-me-charcoal/50">
          <th className="whitespace-nowrap px-2 py-2">⭐</th>
          <th className="whitespace-nowrap px-4 py-2">客人</th>
          <th className="whitespace-nowrap px-4 py-2">该做什么</th>
          <th className="whitespace-nowrap px-4 py-2">联系渠道</th>
        </tr>
      </thead>
    )
  }
  return (
    <thead>
      <tr className="border-b border-me-charcoal/10 text-left text-xs text-me-charcoal/50">
        <th className="whitespace-nowrap px-2 py-2">⭐</th>
        <th className="whitespace-nowrap px-4 py-2">客人</th>
        {/*
          分段模式下**不给**排序入口：行来自服务端各段的顺序，点了也不会重排。
          留着一个点了会变箭头、却一行都不动的按钮，等于告诉人「你排过了」。
          魏征 B2 实测：箭头会变、顺序一字不动，而平铺那句「排序只对当前页生效」
          的提示在分段下反而被藏起来了。
        */}
        <th
          className={grouped ? 'whitespace-nowrap px-4 py-2' : 'cursor-pointer select-none whitespace-nowrap px-4 py-2'}
          onClick={grouped ? undefined : () => onToggleSort('firstSeenAt')}
        >
          进线时间{grouped ? '' : sortArrow('firstSeenAt')}
        </th>
        <th
          className={grouped ? 'whitespace-nowrap px-4 py-2' : 'cursor-pointer select-none whitespace-nowrap px-4 py-2'}
          onClick={grouped ? undefined : () => onToggleSort('lastTouchAt')}
        >
          最近联系{grouped ? '' : sortArrow('lastTouchAt')}
        </th>
        <th className="whitespace-nowrap px-4 py-2">联系方式</th>
        {columns.map((c) => (
          <th key={c.key} className="whitespace-nowrap px-4 py-2">{c.label}</th>
        ))}
        <th className="whitespace-nowrap px-4 py-2">{grouped ? '该做什么' : '到哪一步了'}</th>
      </tr>
    </thead>
  )
}
