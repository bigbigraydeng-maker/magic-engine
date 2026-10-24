'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { CatalogSnapshotResponse } from './types'
import type { PublishPreviewResponse, PublishResponse } from '@/lib/tour-catalog/publish-contract'
import type { PublishPreviewState } from './usePublishPreview'
import { CatalogTabs, TabPanel, type CatalogTab } from './CatalogTabs'
import { PublishBar } from './PublishBar'
import { PublishDialog } from './PublishDialog'
import { PublishHistory } from './PublishHistory'
import { TourListPane } from './TourListPane'
import { TourDetailPane } from './TourDetailPane'
import { BatchHistory } from './BatchHistory'
import { AliasList } from './AliasList'
import { AssistantDrawer } from './AssistantDrawer'
import { ImportPanel } from './ImportPanel'
import { AssistantPanel } from './AssistantPanel'
import { CatalogChangeFeed } from './CatalogChangeFeed'
import { CatalogSettingsPanel } from './CatalogSettingsPanel'
import { PublishRequestNotice, RequestPublishDialog } from './RequestPublishDialog'
import { CatalogUiProvider } from './catalog-context'
import type { CatalogPermissions, PublishRequestView } from '@/lib/tour-catalog/catalog-contract'

/** Tabs this person may open. Hiding is only convenience: every route checks again on the server. */
export function buildTabs(permissions: CatalogPermissions): CatalogTab[] {
  const tabs: CatalogTab[] = [
    { id: 'tours', label: '团' },
    { id: 'changes', label: '修改记录' },
    { id: 'history', label: '上架记录' },
  ]
  if (permissions.import) tabs.push({ id: 'import', label: '出团表导入' })
  if (permissions.aliases) tabs.push({ id: 'aliases', label: '叫法对照' })
  if (permissions.manage_members || permissions.manage_settings) {
    tabs.push({ id: 'settings', label: '设置' })
  }
  return tabs
}

export const IMPORT_BY_ME_TEXT = '出团表（批量班期）请发给 Magic Engine 团队代为导入。'

export const UNSAVED_TEXT = '这个团有没保存的修改，离开会丢失。确定离开吗？'

export const UNSAVED_BLOCKS_PUBLISH_TEXT =
  '这个团还有没保存的修改。请先点「保存」或「取消」，再来上架——没保存的内容不会被上架。'

interface LeaveGuard {
  /** Same flag as isDirty(), as state: drives what is on screen. */
  dirty: boolean
  setDirty: (dirty: boolean) => void
  isDirty: () => boolean
  confirmLeave: () => boolean
}

function useLeaveGuard(): LeaveGuard {
  const dirtyRef = useRef(false)
  const [dirty, setDirtyState] = useState(false)

  const setDirty = useCallback((next: boolean) => {
    dirtyRef.current = next
    setDirtyState(next)
  }, [])

  const isDirty = useCallback(() => dirtyRef.current, [])

  const confirmLeave = useCallback(() => {
    if (!dirtyRef.current) return true
    const ok = window.confirm(UNSAVED_TEXT)
    if (ok) setDirty(false)
    return ok
  }, [setDirty])

  return useMemo(
    () => ({ dirty, setDirty, isDirty, confirmLeave }),
    [dirty, setDirty, isDirty, confirmLeave],
  )
}

/** Browser refresh / close: ask before unsaved edits are thrown away. */
function useBeforeUnloadGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])
}

interface ToursTabProps {
  clientId: string
  snapshot: CatalogSnapshotResponse
  preview: PublishPreviewResponse | null
  selectedId: string | null
  onSelect: (id: string) => void
  guard: LeaveGuard
  onChanged: () => void
  onOpenPublish: () => void
}

interface ToursTabColumnsProps {
  clientId: string
  snapshot: CatalogSnapshotResponse
  preview: PublishPreviewResponse | null
  selected: CatalogSnapshotResponse['tours'][number] | null
  narrowDetail: boolean
  nonce: number
  guard: LeaveGuard
  onChanged: () => void
  onOpenPublish: () => void
  onSelect: (id: string) => void
  onBack: () => void
  detailRef: RefObject<HTMLDivElement>
}

/** Draft equals what is published (and something has been published). */
function draftInSync(preview: PublishPreviewResponse | null): boolean {
  if (preview === null || preview.firstPublish || preview.publishedVersion === 0) return false
  return preview.changes.length === 0
}

/** Phones show list and detail one at a time. Same breakpoint as the `lg:` classes below. */
function isNarrowScreen(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < 1024
}

/** Narrow screens: after picking a tour the detail replaces the list, so bring its top into view. */
function useScrollToDetail(active: boolean, tourId: string | null): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!active || !isNarrowScreen()) return
    const col = ref.current
    const target = col?.querySelector<HTMLElement>('[data-testid="detail-back"]') ?? col
    if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'start' })
  }, [active, tourId])
  return ref
}

function ToursTabColumns(props: ToursTabColumnsProps): JSX.Element {
  const {
    clientId,
    snapshot,
    preview,
    selected,
    narrowDetail,
    nonce,
    guard,
    onChanged,
    onOpenPublish,
    onSelect,
    onBack,
  } = props
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
      {/* Stays in view while the long detail scrolls, so the short column never floats in dead space. */}
      <div
        data-testid="tour-list-col"
        className={`min-w-0 lg:sticky lg:top-4 ${narrowDetail ? 'hidden lg:block' : ''}`}
      >
        <TourListPane
          clientId={clientId}
          tours={snapshot.tours}
          departures={snapshot.departures}
          changedTourIds={preview?.changedTourIds ?? []}
          selectedId={selected?.id ?? null}
          onSelect={onSelect}
          neverPublished={preview !== null && (preview.firstPublish || preview.publishedVersion === 0)}
        />
        <a
          href={`/api/clients/${clientId}/tour-catalog/export`}
          download
          className="mt-2 inline-block px-1 text-xs font-bold text-me-charcoal underline decoration-black/30 underline-offset-2 hover:decoration-me-charcoal"
        >
          导出全部团（含未上架的修改，Excel 可直接打开）
        </a>
        {snapshot.permissions.import ? null : (
          <p className="mt-2 px-1 text-xs font-semibold text-me-charcoal/70">{IMPORT_BY_ME_TEXT}</p>
        )}
      </div>
      <div
        ref={props.detailRef}
        data-testid="tour-detail-col"
        className={narrowDetail ? 'min-w-0 scroll-mt-4' : 'hidden min-w-0 lg:block'}
      >
        <TourDetailPane
          key={`${selected?.id ?? 'none'}:${nonce}`}
          clientId={clientId}
          tour={selected}
          departures={selected ? snapshot.departures.filter(d => d.tourId === selected.id) : []}
          changes={
            selected && preview ? preview.changes.filter(c => c.tourId === selected.id) : []
          }
          onChanged={onChanged}
          onDirtyChange={guard.setDirty}
          onBack={onBack}
          onOpenPublish={onOpenPublish}
          inSync={draftInSync(preview)}
          draftVersion={preview?.draftVersion ?? null}
        />
      </div>
    </div>
  )
}

function ToursTab(props: ToursTabProps): JSX.Element {
  const { clientId, snapshot, preview, selectedId, onSelect, guard, onChanged, onOpenPublish } =
    props
  const [narrowDetail, setNarrowDetail] = useState(false)
  const [nonce, setNonce] = useState(0)

  const selected = snapshot.tours.find(t => t.id === selectedId) ?? snapshot.tours[0] ?? null
  const detailRef = useScrollToDetail(narrowDetail, selected?.id ?? null)

  const handleSelect = (id: string) => {
    if (id !== selected?.id) {
      if (!guard.confirmLeave()) return
      onSelect(id)
    }
    setNarrowDetail(true)
  }

  const handleBack = () => {
    const wasDirty = guard.isDirty()
    if (!guard.confirmLeave()) return
    if (wasDirty) setNonce(n => n + 1)
    setNarrowDetail(false)
  }

  return (
    <ToursTabColumns
      clientId={clientId}
      snapshot={snapshot}
      preview={preview}
      selected={selected}
      narrowDetail={narrowDetail}
      nonce={nonce}
      guard={guard}
      onChanged={onChanged}
      onOpenPublish={onOpenPublish}
      onSelect={handleSelect}
      onBack={handleBack}
      detailRef={detailRef}
    />
  )
}

interface WorkspacePanelsProps {
  clientId: string
  snapshot: CatalogSnapshotResponse
  publish: PublishPreviewState
  activeTab: string
  onTab: (id: string) => void
  selectedId: string | null
  onSelect: (id: string) => void
  guard: LeaveGuard
  onChanged: () => void
  onOpenPublish: () => void
}

/** Tabs only some people get: import, aliases, settings. */
function ManagePanels(props: {
  clientId: string
  snapshot: CatalogSnapshotResponse
  activeTab: string
  onChanged: () => void
}): JSX.Element {
  const { clientId, snapshot, activeTab, onChanged } = props
  const { tours, permissions } = snapshot
  return (
    <>
      {permissions.import ? (
        // kept mounted so an open import preview survives a look at another tab
        <TabPanel id="import" active={activeTab === 'import'} keepMounted>
          <div className="space-y-5">
            <ImportPanel clientId={clientId} tours={tours} onChanged={onChanged} onAliasesChanged={onChanged} />
            {/* Preview-only batches are drafts, not history: list only what was imported or undone. */}
            <BatchHistory
              clientId={clientId}
              batches={(snapshot.batches ?? []).filter(b => b.status !== 'previewed')}
              onChanged={onChanged}
            />
          </div>
        </TabPanel>
      ) : null}
      {permissions.aliases ? (
        <TabPanel id="aliases" active={activeTab === 'aliases'}>
          <AliasList clientId={clientId} aliases={snapshot.aliases ?? []} tours={tours} onChanged={onChanged} />
        </TabPanel>
      ) : null}
      {permissions.manage_members || permissions.manage_settings ? (
        <TabPanel id="settings" active={activeTab === 'settings'}>
          <CatalogSettingsPanel
            clientId={clientId}
            settings={snapshot.settings}
            permissions={permissions}
            imageHostSuggestions={snapshot.imageHostSuggestions}
            onSaved={onChanged}
          />
        </TabPanel>
      ) : null}
    </>
  )
}

function WorkspacePanels(props: WorkspacePanelsProps): JSX.Element {
  const { clientId, snapshot, publish, activeTab, onTab, selectedId, onSelect, guard, onChanged } = props

  return (
    <>
      <CatalogTabs tabs={buildTabs(snapshot.permissions)} activeId={activeTab} onSelect={onTab} />
      <TabPanel id="tours" active={activeTab === 'tours'}>
        <ToursTab
          clientId={clientId}
          snapshot={snapshot}
          preview={publish.preview}
          selectedId={selectedId}
          onSelect={onSelect}
          guard={guard}
          onChanged={onChanged}
          onOpenPublish={props.onOpenPublish}
        />
      </TabPanel>
      <TabPanel id="changes" active={activeTab === 'changes'}>
        <CatalogChangeFeed clientId={clientId} refreshKey={publish.preview?.draftVersion ?? 0} />
      </TabPanel>
      <TabPanel id="history" active={activeTab === 'history'}>
        <PublishHistory
          clientId={clientId}
          refreshKey={publish.preview?.publishedVersion ?? 0}
          onReverted={onChanged}
        />
      </TabPanel>
      <ManagePanels clientId={clientId} snapshot={snapshot} activeTab={activeTab} onChanged={onChanged} />
    </>
  )
}

function AssistantToggle(props: { open: boolean; onToggle: () => void }): JSX.Element {
  return (
    <button
      type="button"
      aria-expanded={props.open}
      onClick={props.onToggle}
      className="rounded-lg border border-black/10 bg-white px-4 py-3 text-sm font-black text-me-charcoal shadow-sm hover:bg-me-ivory"
    >
      AI 助手
    </button>
  )
}

/** Status bar + the AI assistant toggle, always on top of the tabs. */
function WorkspaceHeader(props: {
  publish: PublishPreviewState
  assistantOpen: boolean
  publishBlocked: boolean
  canPublish: boolean
  canAssist: boolean
  /** The open "please publish" request, if any. */
  request: PublishRequestView | null
  onToggleAssistant: () => void
  onOpenPublish: () => void
}): JSX.Element {
  const { publish, assistantOpen, publishBlocked, onToggleAssistant, onOpenPublish } = props
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <PublishBar
          preview={publish.preview}
          loading={publish.loading}
          error={publish.error}
          onOpenPublish={onOpenPublish}
          onRetry={() => {
            void publish.refresh()
          }}
        />
        {publishBlocked ? (
          <p
            role="alert"
            className="mt-2 rounded-lg border border-[#C2453A]/30 bg-[#C2453A]/10 px-4 py-2 text-sm font-black text-[#C2453A]"
          >
            {UNSAVED_BLOCKS_PUBLISH_TEXT}
          </p>
        ) : null}
        <PublishRequestNotice
          request={props.request}
          canPublish={props.canPublish}
          draftVersion={publish.preview?.draftVersion ?? null}
        />
      </div>
      {props.canAssist ? <AssistantToggle open={assistantOpen} onToggle={onToggleAssistant} /> : null}
    </div>
  )
}

interface WorkspaceState {
  activeTab: string
  selectedId: string | null
  assistantOpen: boolean
  publishOpen: boolean
  /** Same button for people who cannot publish: the "ask Magic Engine" dialog. */
  requestOpen: boolean
  /** The user asked to publish while edits were unsaved: show why nothing opened. */
  publishBlocked: boolean
  guard: LeaveGuard
  handleTab: (id: string) => void
  setSelectedId: (id: string | null) => void
  toggleAssistant: () => void
  closeAssistant: () => void
  openPublish: () => void
  closePublish: () => void
}

interface PublishEntry {
  publishOpen: boolean
  requestOpen: boolean
  publishBlocked: boolean
  openPublish: () => void
  closePublish: () => void
}

/**
 * Single entry for the status-bar button and the "去上架" link. Unsaved edits are not part of the
 * draft yet, so either dialog would silently leave them out: say so instead of opening.
 */
function usePublishEntry(guard: LeaveGuard, canPublish: boolean): PublishEntry {
  const [publishOpen, setPublishOpen] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)
  const [blockedAsked, setBlockedAsked] = useState(false)

  // Saved or cancelled: the reminder has done its job.
  useEffect(() => {
    if (!guard.dirty) setBlockedAsked(false)
  }, [guard.dirty])

  const isDirty = guard.isDirty
  const openPublish = useCallback(() => {
    if (isDirty()) {
      setBlockedAsked(true)
      return
    }
    if (canPublish) setPublishOpen(true)
    else setRequestOpen(true)
  }, [isDirty, canPublish])
  const closePublish = useCallback(() => {
    setPublishOpen(false)
    setRequestOpen(false)
  }, [])

  return { publishOpen, requestOpen, publishBlocked: blockedAsked && guard.dirty, openPublish, closePublish }
}

function useWorkspaceState(canPublish: boolean): WorkspaceState {
  const [activeTab, setActiveTab] = useState('tours')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const guard = useLeaveGuard()
  useBeforeUnloadGuard(guard.dirty)
  const entry = usePublishEntry(guard, canPublish)

  const handleTab = (id: string) => {
    if (id === activeTab) return
    if (activeTab === 'tours' && !guard.confirmLeave()) return
    setActiveTab(id)
  }

  const toggleAssistant = useCallback(() => setAssistantOpen(v => !v), [])
  const closeAssistant = useCallback(() => setAssistantOpen(false), [])

  return {
    ...entry,
    activeTab,
    selectedId,
    assistantOpen,
    guard,
    handleTab,
    setSelectedId,
    toggleAssistant,
    closeAssistant,
  }
}

interface WorkspaceBodyProps {
  clientId: string
  snapshot: CatalogSnapshotResponse
  publish: PublishPreviewState
  state: WorkspaceState
  onChanged: () => void
}

function WorkspaceBody(props: WorkspaceBodyProps): JSX.Element {
  const { clientId, snapshot, publish, state, onChanged } = props
  return (
    <div className="flex items-start gap-5">
      <div className="min-w-0 flex-1 space-y-4">
        <WorkspacePanels
          clientId={clientId}
          snapshot={snapshot}
          publish={publish}
          activeTab={state.activeTab}
          selectedId={state.selectedId}
          onTab={state.handleTab}
          onSelect={state.setSelectedId}
          guard={state.guard}
          onChanged={onChanged}
          onOpenPublish={state.openPublish}
        />
      </div>
      {/* The panel stays mounted while the drawer is closed, otherwise the conversation would be lost. */}
      <AssistantDrawer open={state.assistantOpen} onClose={state.closeAssistant}>
        <AssistantPanel
          clientId={clientId}
          tours={snapshot.tours}
          departures={snapshot.departures}
          onApplied={onChanged}
          focusTourId={
            // Same rule as the detail pane: nothing picked yet means the first tour is showing.
            state.activeTab === 'tours'
              ? (snapshot.tours.find(t => t.id === state.selectedId) ?? snapshot.tours[0])?.id ?? null
              : null
          }
        />
      </AssistantDrawer>
    </div>
  )
}

/** The open request: what the server reports, or the one just sent from this page. */
function usePublishRequest(snapshot: CatalogSnapshotResponse, publishedVersion: number | undefined) {
  const [submitted, setSubmitted] = useState<PublishRequestView | null>(null)

  // A publish closes every request: forget the local copy once the published version moves.
  useEffect(() => {
    setSubmitted(null)
  }, [publishedVersion])

  return { request: snapshot.pendingPublishRequest ?? submitted, setSubmitted }
}

function WorkspaceDialogs(props: {
  clientId: string
  publish: PublishPreviewState
  state: WorkspaceState
  onChanged: () => void
  onPublished: (websiteSync: PublishResponse['websiteSync']) => void
  onRequested: (request: PublishRequestView) => void
}): JSX.Element | null {
  const { clientId, publish, state, onChanged, onRequested, onPublished } = props
  if (state.requestOpen) {
    return (
      <RequestPublishDialog
        clientId={clientId}
        onClose={state.closePublish}
        onSubmitted={request => {
          onRequested(request)
          state.closePublish()
          onChanged()
        }}
      />
    )
  }
  if (state.publishOpen && publish.preview) {
    return (
      <PublishDialog
        clientId={clientId}
        preview={publish.preview}
        onRefresh={publish.refresh}
        onClose={state.closePublish}
        onPublished={(websiteSync) => {
          state.closePublish()
          onPublished(websiteSync)
          onChanged()
        }}
      />
    )
  }
  return null
}

export function CatalogWorkspace(props: {
  clientId: string
  snapshot: CatalogSnapshotResponse
  publish: PublishPreviewState
  /** Re-read the catalog and the publish status (after any change). */
  onChanged: () => void
}): JSX.Element {
  const { clientId, snapshot, publish, onChanged } = props
  const [websiteSyncNotice, setWebsiteSyncNotice] = useState<PublishResponse['websiteSync'] | null>(null)
  const canPublish = snapshot.permissions.publish
  const state = useWorkspaceState(canPublish)
  const { request, setSubmitted } = usePublishRequest(snapshot, publish.preview?.publishedVersion)
  const ui = useMemo(
    () => ({
      channelsConnected: snapshot.settings.channelsConnected === true,
      canPublish,
      canEditSite: snapshot.permissions.edit_site === true,
      siteDomain: snapshot.domain,
      imagePool: snapshot.imagePool ?? [],
    }),
    [snapshot.settings.channelsConnected, canPublish, snapshot.permissions.edit_site, snapshot.domain, snapshot.imagePool],
  )

  return (
    <CatalogUiProvider value={ui}>
      <div className="space-y-4">
        {websiteSyncNotice ? (
          <div
            role="status"
            className={`flex items-start justify-between gap-4 rounded-lg border p-4 text-sm ${websiteSyncNotice === 'revalidated' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-950'}`}
          >
            <p>
              {websiteSyncNotice === 'revalidated'
                ? '已上架；官网已确认收到刷新通知。'
                : websiteSyncNotice === 'not_configured'
                  ? '已上架；官网即时刷新通道尚未配置。若官网目录连接已启用，页面会在最多 15 秒内重新读取；否则需要先配置目录连接。'
                  : '已上架；官网刷新通知失败。若目录连接已启用，页面会在最多 15 秒内重新读取；请检查官网刷新接口配置。'}
            </p>
            <button type="button" className="shrink-0 font-semibold underline" onClick={() => setWebsiteSyncNotice(null)}>
              关闭
            </button>
          </div>
        ) : null}
        <WorkspaceHeader
          publish={publish}
          assistantOpen={state.assistantOpen}
          publishBlocked={state.publishBlocked}
          canPublish={canPublish}
          canAssist={snapshot.permissions.assistant}
          request={request}
          onToggleAssistant={state.toggleAssistant}
          onOpenPublish={state.openPublish}
        />
        <WorkspaceBody
          clientId={clientId}
          snapshot={snapshot}
          publish={publish}
          state={state}
          onChanged={onChanged}
        />
        <WorkspaceDialogs
          clientId={clientId}
          publish={publish}
          state={state}
          onChanged={onChanged}
          onPublished={setWebsiteSyncNotice}
          onRequested={setSubmitted}
        />
      </div>
    </CatalogUiProvider>
  )
}
