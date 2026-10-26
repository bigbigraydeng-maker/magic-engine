'use client'

import type { ReactNode } from 'react'

export function AssistantDrawer(props: {
  open: boolean
  onClose: () => void
  children: ReactNode
}): JSX.Element {
  const { open, onClose, children } = props

  const openClass =
    'fixed inset-y-0 right-0 z-40 w-[min(92vw,400px)] overflow-y-auto bg-me-ivory p-3 shadow-xl xl:sticky xl:top-4 xl:z-auto xl:max-h-[calc(100vh-2rem)] xl:w-[380px] xl:shrink-0 xl:self-start xl:bg-transparent xl:p-0 xl:shadow-none'

  return (
    <>
      {open ? (
        <div
          data-testid="assistant-backdrop"
          aria-hidden="true"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/30 xl:hidden"
        />
      ) : null}
      <aside
        aria-label="AI 助手面板"
        data-testid="assistant-drawer"
        data-open={open ? 'true' : 'false'}
        aria-hidden={!open}
        className={open ? openClass : 'hidden'}
      >
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-black/10 bg-white px-3 py-1 text-sm font-semibold text-me-charcoal hover:bg-me-ivory"
          >
            收起助手
          </button>
        </div>
        {children}
      </aside>
    </>
  )
}
