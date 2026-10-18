'use client'

/**
 * 在任何 CRM 页面里原地弹出某位客人的抽屉（不跳页、不丢当前页的筛选和位置）。
 *
 * 「全部客人」页自己持有整页名单，直接用 PersonDrawer；别的页（付款总览）手里只有客人编号，
 * 这里按编号把这一位客人取回来（同一个接口、同一套组装），再交给同一个 PersonDrawer。
 * 关掉就回到原页面，原页面什么都没动。
 */

import { useCallback, useEffect, useState } from 'react'
import { PersonDrawer } from './PersonDrawer'
import type { StageOption } from './ComposeNote'
import { toDrawerRow } from '../all/_components/list-helpers'
import type { ContactRow } from '../all/_components/contact-table-types'

interface ContactDrawerHostProps {
  clientId: string
  contactId: string
  /** 取数据期间显示「正在打开 xxx」用。 */
  name: string | null
  scrollToBookings?: boolean
  onClose: () => void
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; row: ContactRow; stages: StageOption[]; viewerEmail: string | null }

const PILL = 'fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-me-charcoal px-4 py-2 text-sm text-white shadow-lg'

export function ContactDrawerHost(props: ContactDrawerHostProps): JSX.Element {
  const { clientId, contactId, name, scrollToBookings = false, onClose } = props
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [tick, setTick] = useState(0)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const base = `/api/clients/${clientId}/crm`
    void Promise.all([
      fetch(`${base}/contacts?ids=${encodeURIComponent(contactId)}`, { signal: controller.signal }),
      fetch(`/api/clients/${clientId}/pipeline-stages`, { signal: controller.signal }),
    ])
      .then(async ([res, stageRes]) => {
        const json = (await res.json()) as { items?: ContactRow[]; viewerEmail?: string | null; error?: string }
        const row = res.ok ? json.items?.[0] : undefined
        if (!row) {
          setState({ status: 'error', message: '这位客人打不开了，稍后再试' })
          return
        }
        let stages: StageOption[] = []
        if (stageRes.ok) {
          const s = (await stageRes.json()) as { stages?: StageOption[] }
          stages = (s.stages ?? []).map((x) => ({
            stageKey: x.stageKey,
            label: x.label,
            marketingAction: x.marketingAction,
          }))
        }
        setState({ status: 'ready', row, stages, viewerEmail: json.viewerEmail ?? null })
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setState({ status: 'error', message: '加载失败，检查网络后再试' })
      })
    return () => controller.abort()
  }, [clientId, contactId, tick])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const onSaved = useCallback((msg: string, reload = true) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2400)
    if (reload) setTick((n) => n + 1)
  }, [])

  if (state.status === 'loading') {
    return (
      <div role="status" className={PILL}>
        {name ? `正在打开 ${name}…` : '正在打开…'}
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div role="alert" className={`${PILL} flex items-center gap-3`}>
        <span>{state.message}</span>
        <button type="button" className="font-bold underline" onClick={onClose}>
          关闭
        </button>
      </div>
    )
  }

  return (
    <>
      <PersonDrawer
        key={state.row.contactId}
        clientId={clientId}
        row={toDrawerRow(state.row)}
        stages={state.stages}
        viewerEmail={state.viewerEmail}
        onClose={onClose}
        onSaved={onSaved}
        scrollToBookings={scrollToBookings}
      />
      {toast !== null && (
        <div role="status" className={`${PILL} z-[60]`}>
          {toast}
        </div>
      )}
    </>
  )
}
