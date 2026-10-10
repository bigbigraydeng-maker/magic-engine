'use client'

import { useCallback, useEffect, useState } from 'react'
import type { CatalogSnapshotResponse } from './types'
import { errorLabel } from './catalog-format'
import { usePublishPreview } from './usePublishPreview'
import { SeedPanel } from './SeedPanel'
import { CatalogWorkspace } from './CatalogWorkspace'

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; snapshot: CatalogSnapshotResponse }

function LoadError(props: { message: string; onRetry: () => void }): JSX.Element {
  const { message, onRetry } = props
  return (
    <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
      <p className="text-sm font-black text-[#C2453A]">读取团目录失败</p>
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

function useCatalogSnapshot(clientId: string): CatalogSnapshotState {
  const [state, setState] = useState<State>({ phase: 'loading' })

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setState({ phase: 'loading' })
      try {
        const res = await fetch(`/api/clients/${clientId}/tour-catalog`)
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(errorLabel(body.error ?? `HTTP ${res.status}`))
        }
        const snapshot = (await res.json()) as CatalogSnapshotResponse
        setState({ phase: 'ready', snapshot })
      } catch (err) {
        setState({
          phase: 'error',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    },
    [clientId],
  )

  useEffect(() => {
    void load()
  }, [load])

  return { state, load }
}

export function TourCatalogClient({ clientId }: { clientId: string }): JSX.Element {
  const { state, load } = useCatalogSnapshot(clientId)
  const publish = usePublishPreview(clientId)
  const refreshPublish = publish.refresh

  const refreshQuietly = useCallback(() => {
    void load(true)
    void refreshPublish()
  }, [load, refreshPublish])

  if (state.phase === 'loading') {
    return <p className="text-sm font-semibold text-me-charcoal/40">加载中…</p>
  }

  if (state.phase === 'error') {
    return <LoadError message={state.message} onRetry={() => void load()} />
  }

  if (state.snapshot.tours.length === 0) {
    return (
      <div className="space-y-5">
        <SeedPanel clientId={clientId} domain={state.snapshot.domain} onSeeded={refreshQuietly} />
      </div>
    )
  }

  return (
    <CatalogWorkspace
      clientId={clientId}
      snapshot={state.snapshot}
      publish={publish}
      onChanged={refreshQuietly}
    />
  )
}
