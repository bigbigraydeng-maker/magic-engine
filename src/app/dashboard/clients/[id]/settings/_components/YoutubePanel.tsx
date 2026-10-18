'use client'

/**
 * YoutubePanel — YouTube publishing channel + connection status.
 *
 * The channel id is client configuration (set here by an internal admin); the
 * OAuth start route reads it from the database, so the button never carries it.
 * Connecting only allows private uploads and read-back; going public needs a
 * separate authorisation that is not part of this panel.
 */

import { useCallback, useEffect, useState } from 'react'
import { PlatformConnectionPanel } from './PlatformConnectionPanel'

const CHANNEL_PATTERN = /^UC[A-Za-z0-9_-]{22}$/

export function YoutubePanel({ clientId }: { clientId: string }) {
  const [channelId, setChannelId] = useState<string | null | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/youtube-channel`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { channel_id: string | null }
      setChannelId(data.channel_id)
      setDraft(data.channel_id ?? '')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/youtube-channel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: draft.trim() }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; channel_id?: string | null }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setChannelId(data.channel_id ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const draftValid = CHANNEL_PATTERN.test(draft.trim())

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <label className="block text-sm font-bold text-slate-800" htmlFor="youtube-channel-id">
          YouTube 频道编号（UC 开头，共 24 位）
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="youtube-channel-id"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="UCxxxxxxxxxxxxxxxxxxxxxx"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
          />
          <button
            onClick={save}
            disabled={saving || draft.trim() === (channelId ?? '') || (draft.trim() !== '' && !draftValid)}
            className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            保存
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      {channelId ? (
        <PlatformConnectionPanel
          clientId={clientId}
          apiPath="youtube"
          icon="▶️"
          title="YouTube 频道"
          description="连接后可把已审核通过的工厂视频以「私享」上传并读回核对。不会自动公开；公开发布需要另外的授权。"
          connectHref={`/api/auth/google/youtube/start?clientId=${encodeURIComponent(clientId)}`}
          connectLabel="连接 YouTube 频道"
          disconnectConfirmMessage="确认断开 YouTube 连接？"
          errorFallbackMessage="YouTube 授权已失效，需要重新授权。"
        />
      ) : channelId === null ? (
        <p className="text-sm text-slate-500">先填写并保存频道编号，才能连接 YouTube。</p>
      ) : null}
    </div>
  )
}
