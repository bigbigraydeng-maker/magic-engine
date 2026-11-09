'use client'

/**
 * 「自动发信」右边滑出的抽屉：一封信的内容、收件人和发送情况。只读。
 * 做法照 DESIGN_SYSTEM 的 Form Drawer（max-w-2xl、遮罩、顶部固定标题），
 * 加上：Esc 关闭、点遮罩关闭、焦点留在抽屉里、关掉后焦点回到原来那一行。
 * 「放行」只画一个灰掉的占位按钮（稍后开放）——这里没有任何会真发信的按钮。
 */

import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { MeChip } from '@/components/ui/me-primitives'
import { loadErrorText, type AutoSendAdapter } from '@/lib/crm/auto-send/adapter'
import type { LetterDetail, LetterSummary } from '@/lib/crm/auto-send/types'
import { detailTiles, recipientsTabLabel } from '@/lib/crm/auto-send/view'
import { useBodyScrollLock } from '../useBodyScrollLock'
import { LetterContentTab } from './LetterContentTab'
import { RecipientsTab } from './RecipientsTab'
import { LetterStatusPill, SmallButton, letterWhenText } from './ui'

type DetailState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; detail: LetterDetail }

type TabKey = 'content' | 'recipients'

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

/** Tab 键只在抽屉里转圈，不跑到后面的页面上。 */
function trapTab(event: KeyboardEvent, panel: HTMLElement | null): void {
  if (!panel) return
  const nodes = panel.querySelectorAll<HTMLElement>(FOCUSABLE)
  if (nodes.length === 0) return
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  const active = document.activeElement
  const outside = !(active instanceof Node) || !panel.contains(active)
  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault()
    first.focus()
  }
}

function useDrawerFocus(panelRef: RefObject<HTMLDivElement>, onClose: () => void): void {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current()
      else if (event.key === 'Tab') trapTab(event, panelRef.current)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      opener?.focus()
    }
  }, [panelRef])
}

/** 取一封信的详情；换信或点「重试」就重新取，旧的回应不会盖掉新的。 */
function useLetterDetail(
  adapter: AutoSendAdapter,
  letterId: string,
): { state: DetailState; retry: () => void } {
  const [state, setState] = useState<DetailState>({ kind: 'loading' })
  const [tick, setTick] = useState(0)
  const reqRef = useRef(0)

  useEffect(() => {
    const id = ++reqRef.current
    setState({ kind: 'loading' })
    adapter.loadLetterDetail(letterId).then(
      (detail) => {
        if (id === reqRef.current) setState({ kind: 'ready', detail })
      },
      (err: unknown) => {
        if (id === reqRef.current) setState({ kind: 'error', message: loadErrorText(err) })
      },
    )
    return () => {
      reqRef.current += 1
    }
  }, [adapter, letterId, tick])

  return { state, retry: () => setTick((value) => value + 1) }
}

function DrawerHeader({
  titleId,
  summary,
  pendingTitle,
  demo,
  onClose,
}: {
  titleId: string
  summary: LetterSummary | null
  /** 信还没取到时标题位置显示的话（加载中 / 读不到）。 */
  pendingTitle: string
  demo: boolean
  onClose: () => void
}): JSX.Element {
  return (
    <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-black/10 bg-white px-6 py-4">
      <div className="min-w-0 flex-1 space-y-1.5">
        <h2 id={titleId} className="font-display text-lg font-bold leading-6 text-me-charcoal">
          {summary === null ? pendingTitle : summary.title ?? '（这封信还没写）'}
        </h2>
        {summary !== null && (
          <div className="flex flex-wrap items-center gap-2">
            <LetterStatusPill status={summary.status} />
            <span className="text-xs text-me-charcoal/55">
              {letterWhenText(summary)} · {summary.audienceLabel}
            </span>
            {demo && <MeChip gold>示例数据</MeChip>}
          </div>
        )}
      </div>
      <SmallButton data-autofocus="" onClick={onClose}>
        关闭
      </SmallButton>
    </div>
  )
}

function Tiles({ summary }: { summary: LetterSummary }): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(110px,1fr))]">
      {detailTiles(summary).map((tile) => (
        <div key={tile.key} className="rounded-xl border border-black/10 bg-white px-4 py-3">
          <p className="font-display text-xl font-bold leading-7 text-me-charcoal">{tile.value}</p>
          <p className="text-xs text-me-charcoal/55">{tile.label}</p>
        </div>
      ))}
    </div>
  )
}

function Tabs({
  tab,
  onChange,
  recipientsLabel,
}: {
  tab: TabKey
  onChange: (next: TabKey) => void
  recipientsLabel: string
}): JSX.Element {
  const items: Array<{ key: TabKey; label: string }> = [
    { key: 'content', label: '信的内容' },
    { key: 'recipients', label: recipientsLabel },
  ]
  return (
    <div role="tablist" aria-label="信的内容和发送情况" className="inline-flex rounded-lg border border-me-charcoal/15 p-0.5">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={tab === item.key}
          onClick={() => onChange(item.key)}
          className={`rounded-md px-4 py-1.5 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-me-charcoal/40 ${
            tab === item.key ? 'bg-me-charcoal text-me-ivory' : 'text-me-charcoal/55'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

/** 「放行」占位：灰掉、写明「稍后开放」。真正的放行是单独的件，现在这一页不能发信。 */
function ReleasePlaceholder(): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-black/10 pt-4">
      <button
        type="button"
        disabled
        className="cursor-not-allowed rounded-lg border border-me-stone bg-me-stone/50 px-3 py-1.5 text-xs font-bold text-me-charcoal/40"
      >
        放行这封信
      </button>
      <span className="text-[11px] text-me-charcoal/55">稍后开放：现在这一页只用来看，不能发信。</span>
    </div>
  )
}

function ReadyBody({
  clientId,
  detail,
  demo,
}: {
  clientId: string
  detail: LetterDetail
  demo: boolean
}): JSX.Element {
  const [tab, setTab] = useState<TabKey>('content')
  return (
    <>
      <Tiles summary={detail.summary} />
      <Tabs tab={tab} onChange={setTab} recipientsLabel={recipientsTabLabel(detail.summary)} />
      <div role="tabpanel">
        {tab === 'content' ? (
          <LetterContentTab content={detail.content} fallbackTitle={detail.summary.title} />
        ) : (
          <RecipientsTab clientId={clientId} detail={detail} linkNames={!demo} />
        )}
      </div>
      {detail.summary.status === 'awaiting_release' && <ReleasePlaceholder />}
      <p className="text-[11px] text-me-charcoal/55">
        这一页只用来看。要改信的内容，请找 Magic Lab 的同事；每一批发出之前仍然由你点头。
      </p>
    </>
  )
}

export function LetterDrawer({
  clientId,
  letterId,
  adapter,
  demo,
  onClose,
}: {
  clientId: string
  letterId: string
  adapter: AutoSendAdapter
  demo: boolean
  onClose: () => void
}): JSX.Element {
  const { state, retry } = useLetterDetail(adapter, letterId)
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useBodyScrollLock()
  useDrawerFocus(panelRef, onClose)

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      data-testid="auto-send-drawer-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="auto-send-drawer"
        className="h-full w-full max-w-2xl overflow-y-auto border-l border-black/10 bg-white"
      >
        <DrawerHeader
          titleId={titleId}
          summary={state.kind === 'ready' ? state.detail.summary : null}
          pendingTitle={state.kind === 'error' ? '读不到这封信' : '加载中…'}
          demo={demo}
          onClose={onClose}
        />
        <div className="space-y-5 p-6">
          {state.kind === 'loading' && <p className="text-xs text-me-charcoal/55">加载中…</p>}
          {state.kind === 'error' && (
            <div className="text-xs text-status-rej" role="alert">
              <p>暂时读不到这封信：{state.message}</p>
              <SmallButton variant="danger" className="mt-2" onClick={retry}>
                重试
              </SmallButton>
            </div>
          )}
          {state.kind === 'ready' && <ReadyBody clientId={clientId} detail={state.detail} demo={demo} />}
        </div>
      </div>
    </div>
  )
}
