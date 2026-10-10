'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CatalogSnapshotResponse } from './types'
import type { PublishPreviewResponse } from '@/lib/tour-catalog/publish-contract'
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

const TABS: CatalogTab[] = [
  { id: 'tours', label: '团' },
  { id: 'import', label: '出团表导入' },
  { id: 'history', label: '上架记录' },
  { id: 'aliases', label: '叫法对照' },
]

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
      <div data-testid="tour-list-col" className={narrowDetail ? 'hidden min-w-0 lg:block' : 'min-w-0'}>
        <TourListPane
          tours={snapshot.tours}
          departures={snapshot.departures}
          changedTourIds={preview?.changedTourIds ?? []}
          selectedId={selected?.id ?? null}
          onSelect={onSelect}
        />
      </div>
      <div data-testid="tour-detail-col" className={narrowDetail ? 'min-w-0' : 'hidden min-w-0 lg:block'}>
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

function WorkspacePanels(props: WorkspacePanelsProps): JSX.Element {
  const { clientId, snapshot, publish, activeTab, onTab, selectedId, onSelect, guard, onChanged } = props
  const { tours, aliases, batches } = snapshot

  return (
    <>
      <CatalogTabs tabs={TABS} activeId={activeTab} onSelect={onTab} />
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
      {/* kept mounted so an open import preview survives a look at another tab */}
      <TabPanel id="import" active={activeTab === 'import'} keepMounted>
        <div className="space-y-5">
          <ImportPanel
            clientId={clientId}
            tours={tours}
            onChanged={onChanged}
            onAliasesChanged={onChanged}
          />
          {/* Preview-only batches are drafts, not history: list only what was imported or undone. */}
          <BatchHistory
            clientId={clientId}
            batches={batches.filter(b => b.status !== 'previewed')}
            onChanged={onChanged}
          />
        </div>
      </TabPanel>
      <TabPanel id="history" active={activeTab === 'history'}>
        <PublishHistory
          clientId={clientId}
          refreshKey={publish.preview?.publishedVersion ?? 0}
          onReverted={onChanged}
        />
      </TabPanel>
      <TabPanel id="aliases" active={activeTab === 'aliases'}>
        <AliasList clientId={clientId} aliases={aliases} tours={tours} onChanged={onChanged} />
      </TabPanel>
    </>
  )
}

/** Status bar + the AI assistant toggle, always on top of the tabs. */
function WorkspaceHeader(props: {
  publish: PublishPreviewState
  assistantOpen: boolean
  publishBlocked: boolean
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
      </div>
      <button
        type="button"
        aria-expanded={assistantOpen}
        onClick={onToggleAssistant}
        className="rounded-lg border border-black/10 bg-white px-4 py-3 text-sm font-black text-me-charcoal shadow-sm hover:bg-me-ivory"
      >
        AI 助手
      </button>
    </div>
  )
}

interface WorkspaceState {
  activeTab: string
  selectedId: string | null
  assistantOpen: boolean
  publishOpen: boolean
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

function useWorkspaceState(): WorkspaceState {
  const [activeTab, setActiveTab] = useState('tours')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [blockedAsked, setBlockedAsked] = useState(false)
  const guard = useLeaveGuard()
  useBeforeUnloadGuard(guard.dirty)

  // Saved or cancelled: the reminder has done its job.
  useEffect(() => {
    if (!guard.dirty) setBlockedAsked(false)
  }, [guard.dirty])

  const handleTab = (id: string) => {
    if (id === activeTab) return
    if (activeTab === 'tours' && !guard.confirmLeave()) return
    setActiveTab(id)
  }

  // Single entry for the status-bar button and the "去上架" link. Unsaved edits are not part of
  // the draft yet, so the dialog would silently leave them out.
  const isDirty = guard.isDirty
  const openPublish = useCallback(() => {
    if (isDirty()) {
      setBlockedAsked(true)
      return
    }
    setPublishOpen(true)
  }, [isDirty])
  const closePublish = useCallback(() => setPublishOpen(false), [])
  const toggleAssistant = useCallback(() => setAssistantOpen(v => !v), [])
  const closeAssistant = useCallback(() => setAssistantOpen(false), [])

  return {
    activeTab,
    selectedId,
    assistantOpen,
    publishOpen,
    publishBlocked: blockedAsked && guard.dirty,
    guard,
    handleTab,
    setSelectedId,
    toggleAssistant,
    closeAssistant,
    openPublish,
    closePublish,
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

export function CatalogWorkspace(props: {
  clientId: string
  snapshot: CatalogSnapshotResponse
  publish: PublishPreviewState
  /** Re-read the catalog and the publish status (after any change). */
  onChanged: () => void
}): JSX.Element {
  const { clientId, snapshot, publish, onChanged } = props
  const state = useWorkspaceState()

  return (
    <div className="space-y-4">
      <WorkspaceHeader
        publish={publish}
        assistantOpen={state.assistantOpen}
        publishBlocked={state.publishBlocked}
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
      {state.publishOpen && publish.preview ? (
        <PublishDialog
          clientId={clientId}
          preview={publish.preview}
          onRefresh={publish.refresh}
          onClose={state.closePublish}
          onPublished={() => {
            state.closePublish()
            onChanged()
          }}
        />
      ) : null}
    </div>
  )
}
