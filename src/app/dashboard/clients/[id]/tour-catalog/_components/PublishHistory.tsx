'use client'

import { useCallback, useEffect, useState } from 'react'
import type {
  PublishHistoryResponse,
  PublishedVersionView,
} from '@/lib/tour-catalog/publish-contract'
import { formatBatchTime } from './catalog-format'
import { RevertDialog } from './RevertDialog'
import { useCatalogUi } from './catalog-context'

/** Version 1 that is not a revert: there was nothing to compare with, so "0 changes" would mislead. */
function isFirstPublish(version: PublishedVersionView): boolean {
  return version.version === 1 && version.sourceVersion === null
}

function VersionMeta(props: { version: PublishedVersionView }): JSX.Element {
  const { version } = props
  return (
    <>
      <span className="text-sm font-semibold text-me-charcoal/55">
        {formatBatchTime(version.createdAt)}
      </span>
      <span className="text-sm font-semibold text-me-charcoal/55">
        {version.publishedBy} {version.sourceVersion !== null ? '换回' : '上架'}
      </span>
      {version.note ? (
        <span className="text-sm font-semibold text-me-charcoal/55">「{version.note}」</span>
      ) : null}
      <span className="text-sm font-semibold text-me-charcoal/55">
        {isFirstPublish(version) ? '首次上架' : `改动 ${version.changeCount} 处`}
      </span>
      {version.highRiskCount > 0 ? (
        <span className="text-sm font-black text-[#C2453A]">
          其中 {version.highRiskCount} 处涉及价格或班期
        </span>
      ) : null}
    </>
  )
}

function VersionRow(props: {
  version: PublishedVersionView
  onRevert: (version: number) => void
}): JSX.Element {
  const { version, onRevert } = props
  // Hidden for people who cannot publish; the server refuses them anyway.
  const { canPublish, channelsConnected } = useCatalogUi()
  const label =
    version.sourceVersion !== null
      ? `第 ${version.version} 版（文字和价格同第 ${version.sourceVersion} 版）`
      : `第 ${version.version} 版`
  return (
    <li
      data-testid={`publish-version-${version.version}`}
      className="flex flex-wrap items-center gap-3 border-b border-black/10 py-3"
    >
      <span className="font-black text-me-charcoal">{label}</span>
      {version.isCurrent ? (
        <span className="rounded-full border border-[#5C8A4A]/30 bg-[#5C8A4A]/10 px-2 py-0.5 text-xs font-black text-[#456F35]">
          {channelsConnected ? '当前对外' : '当前已上架'}
        </span>
      ) : (
        <span className="rounded-full border border-black/10 bg-me-ivory px-2 py-0.5 text-xs font-black text-me-charcoal/45">
          历史
        </span>
      )}
      <VersionMeta version={version} />
      {!version.isCurrent && canPublish ? (
        <button
          type="button"
          onClick={() => onRevert(version.version)}
          className="rounded-lg border border-black/10 bg-white px-3 py-1 text-sm font-semibold text-me-charcoal hover:bg-me-ivory"
        >
          {channelsConnected ? '把对外内容换回这一版' : '把已上架的内容换回这一版'}
        </button>
      ) : null}
    </li>
  )
}

function usePublishHistory(clientId: string, refreshKey: string | number) {
  const [versions, setVersions] = useState<PublishedVersionView[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/tour-catalog/publish/history`)
      if (res.ok) {
        const data = (await res.json()) as PublishHistoryResponse
        setVersions(data.versions)
      } else {
        setVersions(null)
        setError('读不到上架记录，请稍后再试')
      }
    } catch {
      setVersions(null)
      setError('读不到上架记录，请稍后再试')
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  return { versions, error, load }
}

function HistoryBody(props: {
  versions: PublishedVersionView[] | null
  error: string | null
  onRetry: () => void
  onRevert: (version: number) => void
}): JSX.Element {
  const { versions, error, onRetry, onRevert } = props
  if (error !== null) {
    return (
      <>
        <p role="alert" className="text-sm font-black text-[#C2453A]">
          {error}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-black/10 bg-white px-3 py-1 text-sm font-semibold text-me-charcoal hover:bg-me-ivory"
        >
          重试
        </button>
      </>
    )
  }
  if (versions === null) {
    return <p className="text-sm font-semibold text-me-charcoal/55">加载中…</p>
  }
  if (versions.length === 0) {
    return <p className="text-sm font-semibold text-me-charcoal/55">还没有上架记录</p>
  }
  return (
    <ul>
      {versions.map(v => (
        <VersionRow key={v.version} version={v} onRevert={onRevert} />
      ))}
    </ul>
  )
}

export function PublishHistory(props: {
  clientId: string
  refreshKey: string | number
  onReverted: () => void
}): JSX.Element {
  const { clientId, refreshKey, onReverted } = props
  const { versions, error, load } = usePublishHistory(clientId, refreshKey)
  const [revertVersion, setRevertVersion] = useState<number | null>(null)
  const { channelsConnected } = useCatalogUi()

  function handleReverted() {
    setRevertVersion(null)
    void load()
    onReverted()
  }

  return (
    <div className="space-y-3 rounded-xl border border-black/10 bg-white p-5 shadow-sm">
      <h2 className="font-display font-black text-me-charcoal">上架记录</h2>
      <p className="text-sm font-semibold text-me-charcoal/55">
        {channelsConnected
          ? '每上架一次记一版。客人看到的永远是标着「当前对外」的那一版。'
          : '每上架一次记一版。标着「当前已上架」的是现在已上架的那一版。'}
      </p>

      <HistoryBody
        versions={versions}
        error={error}
        onRetry={() => void load()}
        onRevert={setRevertVersion}
      />

      {revertVersion !== null ? (
        <RevertDialog
          clientId={clientId}
          version={revertVersion}
          onClose={() => setRevertVersion(null)}
          onReverted={handleReverted}
        />
      ) : null}
    </div>
  )
}
