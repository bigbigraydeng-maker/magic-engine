'use client'

import type { KeyboardEvent, ReactNode } from 'react'
import { BRAND_SELECTED_BORDER_CLASS } from './catalog-brand'

export interface CatalogTab {
  id: string
  label: string
}

export function tabDomId(id: string): string {
  return `tour-catalog-tab-${id}`
}

export function panelDomId(id: string): string {
  return `tour-catalog-panel-${id}`
}

const ACTIVE_TAB_CLASS = `border-b-2 ${BRAND_SELECTED_BORDER_CLASS} px-4 py-2 text-sm font-black text-me-charcoal`
const INACTIVE_TAB_CLASS =
  'border-b-2 border-transparent px-4 py-2 text-sm font-semibold text-me-charcoal/55 hover:text-me-charcoal'

export function CatalogTabs(props: {
  tabs: CatalogTab[]
  activeId: string
  onSelect: (id: string) => void
}): JSX.Element {
  const { tabs, activeId, onSelect } = props

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    if (tabs.length === 0) return
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const nextIndex = (index + delta + tabs.length) % tabs.length
    onSelect(tabs[nextIndex].id)
  }

  return (
    <div role="tablist" aria-label="团目录分区" className="flex flex-wrap gap-1 border-b border-black/10">
      {tabs.map((tab, index) => {
        const active = tab.id === activeId
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={tabDomId(tab.id)}
            aria-selected={active}
            aria-controls={panelDomId(tab.id)}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={event => handleKeyDown(event, index)}
            className={active ? ACTIVE_TAB_CLASS : INACTIVE_TAB_CLASS}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

export function TabPanel(props: {
  id: string
  active: boolean
  keepMounted?: boolean
  children: ReactNode
}): JSX.Element | null {
  const { id, active, keepMounted, children } = props
  if (!active && !keepMounted) return null
  return (
    <div role="tabpanel" id={panelDomId(id)} aria-labelledby={tabDomId(id)} hidden={!active}>
      {children}
    </div>
  )
}
