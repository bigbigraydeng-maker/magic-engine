'use client'

import { useEffect, useRef, useState } from 'react'

export function TemplateMoreMenu(props: {
  canEdit: boolean
  status: 'active' | 'disabled'
  disabled?: boolean
  onDeactivate: () => void
  onActivate?: () => void
}): JSX.Element | null {
  const { canEdit, status, disabled, onDeactivate, onActivate } = props
  const [open, setOpen] = useState(false)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setConfirmDeactivate(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!canEdit) return null

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-label="更多操作"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setOpen((v) => !v)
          setConfirmDeactivate(false)
        }}
        className="rounded-lg border border-me-stone bg-white px-2 py-1 text-sm font-bold text-me-charcoal disabled:opacity-40"
      >
        …
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 min-w-[12rem] rounded-xl border border-me-charcoal/10 bg-white py-1 shadow-lg"
        >
          {status === 'active' && !confirmDeactivate && (
            <button
              type="button"
              role="menuitem"
              className="block w-full px-3 py-2 text-left text-sm text-red-800 hover:bg-red-50"
              onClick={() => setConfirmDeactivate(true)}
            >
              停用这个模板…
            </button>
          )}
          {status === 'active' && confirmDeactivate && (
            <div className="px-3 py-2 text-xs text-me-charcoal/80">
              <p className="mb-2">停用后同事选不到这封模板，确定吗？</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-lg bg-me-charcoal px-2 py-1 text-xs font-bold text-white"
                  onClick={() => {
                    setOpen(false)
                    setConfirmDeactivate(false)
                    onDeactivate()
                  }}
                >
                  确认停用
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-me-stone px-2 py-1 text-xs"
                  onClick={() => setConfirmDeactivate(false)}
                >
                  取消
                </button>
              </div>
            </div>
          )}
          {status === 'disabled' && onActivate && (
            <button
              type="button"
              role="menuitem"
              className="block w-full px-3 py-2 text-left text-sm text-me-charcoal hover:bg-me-ivory"
              onClick={() => {
                setOpen(false)
                onActivate()
              }}
            >
              重新启用
            </button>
          )}
        </div>
      )}
    </div>
  )
}
