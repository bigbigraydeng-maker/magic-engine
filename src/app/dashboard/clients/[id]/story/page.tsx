'use client'

/**
 * /dashboard/clients/[id]/story — the Story weekly pack page (global administrators only).
 * Reads the pack list and one preview; the buttons call the authorise / stop routes.
 */
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { describeMode, describePackState } from '@/lib/social/story-lite/page-text'
import type { LitePackList } from '@/lib/social/story-lite/list'
import type { LitePreview } from '@/lib/social/story-lite/service'

import { StoryPackView } from './StoryPackView'

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error'

async function readPreview(url: string): Promise<LitePreview | 'forbidden' | 'failed'> {
  const res = await fetch(url)
  if (res.status === 401 || res.status === 403) return 'forbidden'
  const json = (await res.json().catch(() => ({}))) as { success?: boolean } & Partial<LitePreview>
  if (!res.ok || json.success !== true) return 'failed'
  return json as LitePreview
}

export default function StoryPage() {
  const clientId = useParams().id as string
  const [load, setLoad] = useState<LoadState>('loading')
  const [list, setList] = useState<LitePackList | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<LitePreview | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [verified, setVerified] = useState(false)
  const seq = useRef(0)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async (wanted?: string) => {
    const mine = ++seq.current
    const stale = () => mine !== seq.current
    try {
      const res = await fetch(`/api/clients/${clientId}/story-lite`)
      if (stale()) return
      if (res.status === 401 || res.status === 403) return setLoad('forbidden')
      const json = (await res.json()) as { success?: boolean } & Partial<LitePackList>
      if (!res.ok || json.success !== true || !json.packs) return setLoad('error')
      const data: LitePackList = { live: json.live === true, packs: json.packs }
      setList(data)
      const pick = data.packs.find((p) => p.pack_id === (wanted ?? selected)) ?? data.packs.find((p) => p.state !== 'REVOKED') ?? data.packs[0]
      setSelected(pick?.pack_id ?? null)
      if (!pick) {
        setPreview(null)
        setPreviewFailed(false)
        return setLoad('ready')
      }
      const previewUrl = `/api/clients/${clientId}/story-lite/${pick.pack_id}/preview`
      // 1) fast first look (no picture re-download) so the page is on screen at once; 2) the full check enables authorising
      const quick = await readPreview(`${previewUrl}?check_files=0`)
      if (stale()) return
      if (quick === 'forbidden') return setLoad('forbidden')
      if (quick === 'failed') {
        // keep the picker usable: only this week failed to read, and the page says so
        setPreview(null)
        setPreviewFailed(true)
        return setLoad('ready')
      }
      setPreviewFailed(false)
      setVerified(false)
      setPreview(quick)
      setLoad('ready')
      const full = await readPreview(previewUrl)
      if (stale()) return
      if (full === 'forbidden') return setLoad('forbidden')
      if (full === 'failed') {
        // keep the fast look on screen; authorising stays off (verified is false) and the page says why
        setNotice('图片核对没有完成，现在不能授权。请刷新页面再试；还不行就找开发。')
        return
      }
      setPreview(full)
      setVerified(true)
    } catch {
      if (!stale()) setLoad('error')
    }
  }, [clientId, selected])

  useEffect(() => {
    void refresh()
    // load once on open; later reloads are triggered by the buttons and the pack picker
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  const mode = describeMode(list?.live === true)

  return (
    <main className="min-h-screen space-y-5 bg-[#f6f7f2] px-4 py-5 md:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/dashboard/clients/${clientId}`} className="text-sm font-semibold text-me-charcoal/70 hover:text-me-charcoal">
          ← 返回客户页
        </Link>
        <h1 className="font-display text-2xl font-bold tracking-tight text-me-charcoal">Story 自动发布</h1>
      </div>

      {notice && (
        <p role="status" className="rounded-lg border border-black/10 bg-white px-4 py-3 text-sm font-medium text-me-charcoal">
          {notice}
        </p>
      )}

      {load === 'loading' && <p className="text-sm text-me-charcoal/70">正在读取…</p>}
      {load === 'forbidden' && <p className="text-sm font-medium text-[#B03A2E]">这个页面只有管理员能看。</p>}
      {load === 'error' && (
        <p className="text-sm font-medium text-[#B03A2E]">读取失败，现在不知道状态。如果你刚点过「授权」或「停」，那一下可能已经生效，请刷新页面确认；还不行就找开发。</p>
      )}

      {load === 'ready' && list && (
        <>
          <div
            role="status"
            className={`rounded-xl border px-4 py-3 ${
              mode.tone === 'live' ? 'border-[#B03A2E] bg-[#B03A2E]/10' : 'border-me-ochre/50 bg-me-ochre/10'
            }`}
          >
            <p className="text-base font-bold text-me-charcoal">{mode.headline}</p>
            <p className="text-sm text-me-charcoal/80">{mode.detail}</p>
          </div>

          {list.packs.length > 1 && (
            <label className="flex flex-wrap items-center gap-2 text-sm text-me-charcoal">
              看哪一周：
              <select
                value={selected ?? ''}
                onChange={(e) => {
                  setNotice(null)
                  setLoad('loading')
                  void refresh(e.target.value)
                }}
                className="rounded-md border border-black/20 bg-white px-2 py-1.5 text-sm"
              >
                {list.packs.map((p) => (
                  <option key={p.pack_id} value={p.pack_id}>
                    {p.title}（{describePackState(p.state)}）
                  </option>
                ))}
              </select>
            </label>
          )}

          {preview ? (
            <StoryPackView clientId={clientId} preview={preview} live={list.live} verified={verified} otherAuthorized={list.packs.filter((p) => p.state === 'AUTHORIZED' && p.pack_id !== preview.pack_id).length}
              onChanged={() => refresh()}
              onNotice={setNotice} />
          ) : previewFailed ? (
            <p className="text-sm font-medium text-[#B03A2E]">这一周读不出来（可能里面还没有 Story），现在不知道状态，不能授权。可以换一周看，或找开发。</p>
          ) : (
            <p className="text-sm text-me-charcoal/80">现在还没有要授权的 Story 周包。周包准备好以后会出现在这里。</p>
          )}
        </>
      )}
    </main>
  )
}
