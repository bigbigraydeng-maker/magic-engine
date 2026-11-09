'use client'

/**
 * 「自动发信」页面：看系统自动发给客人的信——每封信的内容、收件人和发送情况。
 * 只读：这里没有任何发送、放行的动作（「放行」只在抽屉里画了一个灰掉的占位）。
 *
 * 自包含：对外只收 clientId，自己取数、自己带状态；外面套独立的路由页，或者以后放进
 * 「员工点放行」那个页面的某个标签里，都不用改这个组件。
 *
 * 数据只通过「读数据适配器」(@/lib/crm/auto-send/adapter) 拿。真实的读接口来之前它报「还没接通」，
 * 页面就显示空状态，员工点「看示例」才用编出来的假数据，并且整页标明「示例数据（假的）」。
 *
 * 设计稿：Figma「自动发信 · 页面设计 v0.2」(02 列表 / 03·04·04b 抽屉 / 05 状态 / 06 手机版)。
 */

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { MeChip } from '@/components/ui/me-primitives'
import {
  createLiveAdapter,
  isNotConnectedError,
  loadErrorText,
  type AutoSendAdapter,
} from '@/lib/crm/auto-send/adapter'
import { createDemoAdapter } from '@/lib/crm/auto-send/demo-data'
import { formatSendDate } from '@/lib/crm/auto-send/format'
import { FILTER_OPTIONS, nextBatchSentence, type LetterFilter } from '@/lib/crm/auto-send/status'
import type { AutoSendOverview, NextBatch } from '@/lib/crm/auto-send/types'
import { isOverviewEmpty, visibleSections } from '@/lib/crm/auto-send/view'
import { LetterDrawer } from './LetterDrawer'
import { LetterSectionPanel } from './LetterSectionPanel'
import { StatusLegend } from './StatusLegend'
import { Panel, SmallButton } from './ui'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'not_connected' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; overview: AutoSendOverview }

const PLACEHOLDER_TITLE = '按期发送的信'

function toFailure(err: unknown): LoadState {
  return isNotConnectedError(err) ? { kind: 'not_connected' } : { kind: 'error', message: loadErrorText(err) }
}

/** 取总览：换数据来源时先回到「加载中」；点「刷新」时旧内容留着，等新的回来再换。 */
function useOverview(adapter: AutoSendAdapter): { load: LoadState; refreshing: boolean; refresh: () => void } {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const reqRef = useRef(0)

  const run = useCallback(
    (reset: boolean) => {
      const id = ++reqRef.current
      if (reset) setLoad({ kind: 'loading' })
      setRefreshing(true)
      adapter.loadOverview().then(
        (overview) => {
          if (id !== reqRef.current) return
          setLoad({ kind: 'ready', overview })
          setRefreshing(false)
        },
        (err: unknown) => {
          if (id !== reqRef.current) return
          setLoad(toFailure(err))
          setRefreshing(false)
        },
      )
    },
    [adapter],
  )

  useEffect(() => {
    run(true)
    return () => {
      reqRef.current += 1
    }
  }, [run])

  const refresh = useCallback(() => run(load.kind !== 'ready'), [run, load.kind])
  return { load, refreshing, refresh }
}

function PageHeader({ clientId }: { clientId: string }): JSX.Element {
  return (
    <>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h1 className="text-lg font-semibold text-me-charcoal">自动发信</h1>
        <Link href={`/dashboard/clients/${clientId}/crm/all`} className="text-sm underline">
          回到全部客人
        </Link>
      </div>
      <p className="mb-4 text-sm text-me-charcoal/70">
        这里看系统自动发给客人的信：每封信的内容、收件人和发送情况。这一页只用来看，每一批发出之前仍然要你点头。
      </p>
    </>
  )
}

function DemoBanner({ onExit }: { onExit: () => void }): JSX.Element {
  return (
    <div
      role="status"
      data-testid="auto-send-demo-banner"
      className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-me-ochre/30 bg-me-ochre/10 px-4 py-3"
    >
      <p className="text-sm text-me-charcoal">
        <strong>示例数据（假的）</strong>：下面的信、客人和数字都是编出来演示的，不是真实的发送记录。
      </p>
      <SmallButton onClick={onExit}>退出示例</SmallButton>
    </div>
  )
}

function NextBatchCard({
  batch,
  focused,
  onToggle,
}: {
  batch: NextBatch
  focused: boolean
  onToggle: () => void
}): JSX.Element {
  return (
    <div
      data-testid="auto-send-next-batch"
      className="mb-4 flex flex-col gap-3 rounded-xl border border-me-ochre/30 bg-me-ochre/10 p-4 sm:flex-row sm:items-center"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-me-charcoal">下一批：{formatSendDate(batch.sendDate)}</p>
        <p className="text-xs text-me-charcoal/70">
          {batch.letterCount} 封信 · 共 {batch.recipientCount} 位收件人 · {nextBatchSentence(batch.status)}
        </p>
      </div>
      <SmallButton variant="dark" className="self-start py-1.5 sm:self-auto" aria-pressed={focused} onClick={onToggle}>
        {focused ? '看全部' : '看这批'}
      </SmallButton>
    </div>
  )
}

function FilterBar({ filter, onChange }: { filter: LetterFilter; onChange: (next: LetterFilter) => void }): JSX.Element {
  return (
    <div role="group" aria-label="按状态筛选" className="mb-4 flex flex-wrap gap-2">
      {FILTER_OPTIONS.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={option.key === filter}
          onClick={() => onChange(option.key)}
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-me-charcoal/40"
        >
          <MeChip gold={option.key === filter}>{option.label}</MeChip>
        </button>
      ))}
    </div>
  )
}

interface PanelProps {
  onRefresh: () => void
  refreshing: boolean
}

function PlaceholderPanel({
  onRefresh,
  refreshing,
  testId,
  children,
}: PanelProps & { testId: string; children: ReactNode }): JSX.Element {
  return (
    <Panel
      title={PLACEHOLDER_TITLE}
      testId={testId}
      right={
        <SmallButton onClick={onRefresh} disabled={refreshing}>
          刷新
        </SmallButton>
      }
    >
      {children}
    </Panel>
  )
}

function LoadingPanel(panel: PanelProps): JSX.Element {
  return (
    <PlaceholderPanel {...panel} testId="auto-send-loading">
      <p className="text-xs text-me-charcoal/55">加载中…</p>
    </PlaceholderPanel>
  )
}

function NotConnectedPanel({ onShowDemo, ...panel }: PanelProps & { onShowDemo: () => void }): JSX.Element {
  return (
    <PlaceholderPanel {...panel} testId="auto-send-not-connected">
      <p className="text-xs text-me-charcoal/70">这一页还没有接上真实的发信数据（发信系统还在做），所以现在什么都看不到。</p>
      <p className="mt-1 text-xs text-me-charcoal/55">
        想先看看做好以后长什么样，可以点下面的按钮：看到的是编出来的假数据，页面上会写明。
      </p>
      <SmallButton variant="dark" className="mt-3 py-1.5" onClick={onShowDemo}>
        看示例（假数据）
      </SmallButton>
    </PlaceholderPanel>
  )
}

function ErrorPanel({ message, ...panel }: PanelProps & { message: string }): JSX.Element {
  return (
    <PlaceholderPanel {...panel} testId="auto-send-error">
      <div role="alert" className="space-y-2 text-xs text-status-rej">
        <p>暂时读不到发信记录：{message}</p>
        <SmallButton variant="danger" onClick={panel.onRefresh}>
          重试
        </SmallButton>
      </div>
    </PlaceholderPanel>
  )
}

function EmptyPanel({ nextBatch, ...panel }: PanelProps & { nextBatch: NextBatch | null }): JSX.Element {
  return (
    <PlaceholderPanel {...panel} testId="auto-send-empty">
      <p className="text-xs text-me-charcoal/55">
        还没有自动发信记录。{nextBatch ? `第一批会在 ${formatSendDate(nextBatch.sendDate)} 发出。` : ''}
      </p>
    </PlaceholderPanel>
  )
}

interface ListProps extends PanelProps {
  overview: AutoSendOverview
  filter: LetterFilter
  batchDate: string | null
  onFilter: (next: LetterFilter) => void
  onToggleBatch: () => void
  onOpen: (letterId: string) => void
}

function ReadyView(props: ListProps): JSX.Element {
  const { overview, filter, batchDate, refreshing, onFilter, onToggleBatch, onOpen, onRefresh } = props
  const sections = visibleSections(overview, filter, batchDate)
  const refreshKey = (sections.find((section) => section.kind === 'scheduled') ?? sections[0])?.key
  return (
    <>
      {overview.nextBatch && (
        <NextBatchCard
          batch={overview.nextBatch}
          focused={batchDate !== null && batchDate === overview.nextBatch.sendDate}
          onToggle={onToggleBatch}
        />
      )}
      <FilterBar filter={filter} onChange={onFilter} />
      {sections.length === 0 && (
        <PlaceholderPanel onRefresh={onRefresh} refreshing={refreshing} testId="auto-send-no-match">
          <p className="text-xs text-me-charcoal/55">没有符合条件的信。换一个筛选，或者点「看全部」。</p>
        </PlaceholderPanel>
      )}
      {sections.map((section) => (
        <LetterSectionPanel
          key={section.key}
          section={section}
          onOpen={onOpen}
          onRefresh={section.key === refreshKey ? onRefresh : undefined}
          refreshing={refreshing}
        />
      ))}
    </>
  )
}

function StatePanels({
  load,
  panel,
  onShowDemo,
  list,
}: {
  load: LoadState
  panel: PanelProps
  onShowDemo: () => void
  list: Omit<ListProps, 'overview' | keyof PanelProps>
}): JSX.Element {
  switch (load.kind) {
    case 'loading':
      return <LoadingPanel {...panel} />
    case 'not_connected':
      return <NotConnectedPanel {...panel} onShowDemo={onShowDemo} />
    case 'error':
      return <ErrorPanel {...panel} message={load.message} />
    case 'ready':
      return isOverviewEmpty(load.overview) ? (
        <EmptyPanel {...panel} nextBatch={load.overview.nextBatch} />
      ) : (
        <ReadyView overview={load.overview} {...panel} {...list} />
      )
  }
}

/** 页面主体。liveAdapter / demoAdapter 可注入，方便单测和预览；线上只经 AutoSendBoard 传 clientId。 */
export function AutoSendWorkspace({
  clientId,
  liveAdapter,
  demoAdapter,
}: {
  clientId: string
  liveAdapter: AutoSendAdapter
  demoAdapter?: AutoSendAdapter
}): JSX.Element {
  const [demo, setDemo] = useState(false)
  const demoFallback = useMemo(() => demoAdapter ?? createDemoAdapter(), [demoAdapter])
  const adapter = demo ? demoFallback : liveAdapter
  const { load, refreshing, refresh } = useOverview(adapter)
  const [filter, setFilter] = useState<LetterFilter>('all')
  const [batchDate, setBatchDate] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const closeDrawer = useCallback(() => setOpenId(null), [])

  const switchDemo = (on: boolean) => {
    setDemo(on)
    setOpenId(null)
    setFilter('all')
    setBatchDate(null)
  }
  const toggleBatch = () => {
    const next = load.kind === 'ready' ? load.overview.nextBatch : null
    if (next) setBatchDate((current) => (current === null ? next.sendDate : null))
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8" data-testid="auto-send-board">
      <PageHeader clientId={clientId} />
      {demo && <DemoBanner onExit={() => switchDemo(false)} />}
      <StatePanels
        load={load}
        panel={{ onRefresh: refresh, refreshing }}
        onShowDemo={() => switchDemo(true)}
        list={{ filter, batchDate, onFilter: setFilter, onToggleBatch: toggleBatch, onOpen: setOpenId }}
      />
      {load.kind !== 'loading' && load.kind !== 'error' && <StatusLegend />}
      {openId !== null && (
        <LetterDrawer clientId={clientId} letterId={openId} adapter={adapter} demo={demo} onClose={closeDrawer} />
      )}
    </div>
  )
}

/** 对外的样子：只收 clientId。 */
export function AutoSendBoard({ clientId }: { clientId: string }): JSX.Element {
  const liveAdapter = useMemo(() => createLiveAdapter(clientId), [clientId])
  return <AutoSendWorkspace clientId={clientId} liveAdapter={liveAdapter} />
}
