'use client'

import { useCallback, useEffect, useState } from 'react'
import type {
  CatalogPermissions,
  CatalogSettings,
} from '@/lib/tour-catalog/catalog-contract'
import type { CatalogSnapshotResponse } from './types'
import { errorLabel } from './catalog-format'
import { brandTheme } from './catalog-brand'
import { usePublishPreview } from './usePublishPreview'
import { SeedPanel } from './SeedPanel'
import { CatalogWorkspace } from './CatalogWorkspace'
import { CatalogHeader } from './CatalogHeader'
import { CatalogSkeleton } from './CatalogSkeleton'
import {
  CatalogPageNotice,
  EMPTY_CATALOG_TEXT,
  NO_ACCESS_TEXT,
  SESSION_EXPIRED_TEXT,
} from './page-notices'

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  /** Not a fault: this account may not (or no longer) open the page. Calm card, no retry. */
  | { phase: 'notice'; text: string }
  | { phase: 'ready'; snapshot: CatalogSnapshotResponse }

/** Used when the answer carries no permissions: look only, everything else off. */
const VIEW_ONLY: CatalogPermissions = {
  view: true,
  edit: false,
  edit_site: false,
  assistant: false,
  request_publish: false,
  import: false,
  aliases: false,
  seed: false,
  publish: false,
  manage_members: false,
  manage_settings: false,
}

const NEUTRAL_SETTINGS: CatalogSettings = {
  logoUrl: null,
  brandPrimary: null,
  brandSecondary: null,
  channelsConnected: false,
  imageHosts: [],
}

/** Fill in whatever the answer left out with the most restrictive value, so nothing renders half-way. */
function normaliseSnapshot(raw: Partial<CatalogSnapshotResponse>): CatalogSnapshotResponse {
  return {
    tours: Array.isArray(raw.tours) ? raw.tours : [],
    departures: Array.isArray(raw.departures) ? raw.departures : [],
    aliases: raw.aliases,
    batches: raw.batches,
    domain: raw.domain ?? null,
    clientName: typeof raw.clientName === 'string' ? raw.clientName : '',
    viewer: raw.viewer ?? { email: '', role: 'client_editor' },
    permissions: { ...VIEW_ONLY, ...(raw.permissions ?? {}) },
    settings: { ...NEUTRAL_SETTINGS, ...(raw.settings ?? {}) },
    pendingPublishRequest: raw.pendingPublishRequest ?? null,
    imagePool: Array.isArray(raw.imagePool) ? raw.imagePool : [],
    imageHostSuggestions: raw.imageHostSuggestions,
  }
}

function LoadError(props: { message: string; onRetry: () => void }): JSX.Element {
  const { message, onRetry } = props
  return (
    <div role="alert" className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
      <p className="text-sm font-black text-[#C2453A]">团目录暂时打不开</p>
      <p className="mt-1 text-sm font-semibold text-me-charcoal/70">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-lg border border-[#C2453A]/30 bg-white px-3 py-1 text-xs font-black text-[#C2453A] hover:bg-[#C2453A]/10"
      >
        重试
      </button>
    </div>
  )
}

interface CatalogSnapshotState {
  state: State
  load: (silent?: boolean) => Promise<void>
}

/** Thrown for answers that are an explanation rather than a fault (no access, signed out). */
class CatalogNotice extends Error {}

async function fetchSnapshot(clientId: string): Promise<CatalogSnapshotResponse> {
  const res = await fetch(`/api/clients/${clientId}/tour-catalog`)
  if (res.status === 403) throw new CatalogNotice(NO_ACCESS_TEXT)
  if (res.status === 401) throw new CatalogNotice(SESSION_EXPIRED_TEXT)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(errorLabel(body.error ?? ''))
  }
  return normaliseSnapshot((await res.json()) as Partial<CatalogSnapshotResponse>)
}

function useCatalogSnapshot(clientId: string): CatalogSnapshotState {
  const [state, setState] = useState<State>({ phase: 'loading' })

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setState({ phase: 'loading' })
      try {
        setState({ phase: 'ready', snapshot: await fetchSnapshot(clientId) })
      } catch (err) {
        if (err instanceof CatalogNotice) {
          setState({ phase: 'notice', text: err.message })
          return
        }
        setState({ phase: 'error', message: err instanceof Error ? err.message : errorLabel('') })
      }
    },
    [clientId],
  )

  useEffect(() => {
    void load()
  }, [load])

  return { state, load }
}

/** Nothing in the catalog yet: people who may read the website in get the button, others an explanation. */
function EmptyCatalog(props: {
  clientId: string
  snapshot: CatalogSnapshotResponse
  onSeeded: () => void
}): JSX.Element {
  const { clientId, snapshot, onSeeded } = props
  if (snapshot.permissions.seed) {
    return <SeedPanel clientId={clientId} domain={snapshot.domain} onSeeded={onSeeded} />
  }
  return (
    <div className="rounded-xl border border-dashed border-black/10 bg-white p-10 text-center">
      <p className="text-sm font-black text-me-charcoal">{EMPTY_CATALOG_TEXT}</p>
    </div>
  )
}

export function TourCatalogClient({ clientId }: { clientId: string }): JSX.Element {
  const { state, load } = useCatalogSnapshot(clientId)
  const publish = usePublishPreview(clientId)
  const refreshPublish = publish.refresh

  const refreshQuietly = useCallback(() => {
    void load(true)
    void refreshPublish()
  }, [load, refreshPublish])

  if (state.phase === 'loading') return <CatalogSkeleton />
  if (state.phase === 'notice') return <CatalogPageNotice text={state.text} />
  if (state.phase === 'error') {
    return <LoadError message={state.message} onRetry={() => void load()} />
  }

  const { snapshot } = state
  const theme = brandTheme(snapshot.settings)
  // The brand colours live on this outermost container as CSS variables; only validated values get here.
  return (
    <div data-testid="catalog-brand-scope" style={theme.style} className="space-y-4">
      <CatalogHeader
        clientName={snapshot.clientName}
        settings={snapshot.settings}
        viewer={snapshot.viewer}
      />
      {snapshot.tours.length === 0 ? (
        <EmptyCatalog clientId={clientId} snapshot={snapshot} onSeeded={refreshQuietly} />
      ) : (
        <CatalogWorkspace
          clientId={clientId}
          snapshot={snapshot}
          publish={publish}
          onChanged={refreshQuietly}
        />
      )}
    </div>
  )
}
