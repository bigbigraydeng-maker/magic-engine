'use client'

/**
 * 这套房的推广素材 —— 上传口 + 逐张过闸 + 逐张签字。
 *
 * PM 2026-08-05 的要求：地产版要在客户建档后能上传图片，而且
 * 「推广素材必须要严谨，不能随意更改」。这块面板是那句话的操作面：
 *
 *   · **上传口**：一套房一条链接。发给中介，他点开就是传这套房的照片，
 *     不用选、不用填。归类由链接完成。
 *   · **过闸**：每张都摆明能不能投放，不能投的**逐张写清缺什么**。
 *     刻意不做「一键全部通过」——那个按钮存在的第一天就会被一直点。
 *   · **签字**：确认这一步必须由看过东西的人点，而且留下是谁点的。
 *     系统没有任何办法自动分辨客户传的是实拍还是网上存的图。
 *
 * 「不能随意更改」由库层的两个触发器保证（改挂房源 / 就地换文件都会被拒），
 * 这一页不提供任何入口去做那两件事 —— 换图的正确做法是归档旧的再传新的。
 */

import { useState, useEffect, useCallback } from 'react'

interface Verdict {
  usable: boolean
  reasons: string[]
  why: string
}

interface Asset {
  id: string
  storageUrl: string
  filename: string
  mimeType: string | null
  source: string | null
  verifiedBy: string | null
  verifiedAt: string | null
  verdict?: Verdict
}

interface ArchivedAsset {
  id: string
  storageUrl: string
  filename: string
  mimeType: string | null
  archivedAt: string
}

interface Shot {
  no: number
  what: string
  seconds: string
  how: string
  optional: boolean
}

interface ShootBrief {
  title: string
  intro: string
  shots: Shot[]
  rules: string[]
}

interface Payload {
  shootBrief?: ShootBrief
  shootBriefText?: string
  uploadUrl: string | null
  uploadUrlError: string | null
  summary: string
  truncated?: boolean
  usable: Asset[]
  rejected: Asset[]
  archived: ArchivedAsset[]
}

export function ListingAssetsPanel({
  clientId,
  listingId,
}: {
  clientId: string
  listingId: string
}) {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copiedBrief, setCopiedBrief] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/listings/${listingId}/assets`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取失败')
    }
  }, [clientId, listingId])

  useEffect(() => {
    void load()
  }, [load])

  async function setSource(assetId: string, source: string) {
    setBusyId(assetId)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/assets/${assetId}/provenance`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
      })
      const json = await res.json()
      if (!res.ok || json.success === false) throw new Error(json.error ?? `HTTP ${res.status}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusyId(null)
    }
  }

  /**
   * 收起来 / 放回来。
   *
   * 2026-08-05 魏征 P0-2：在这个按钮存在之前，面板底部、migration 注释、
   * 触发器报错三处都在说「换图请归档这一条再传新的」，而**全系统没有任何
   * 写归档的入口** —— 中介传错一张，产品上没有任何手段让它消失。
   *
   * 归档只打一个时间戳，文件和归属一个字节都不动：已经投出去的广告当时用的
   * 是哪一张，必须永远查得回来。所以这个动作是**可逆**的，而「改挂房源」
   * 「换文件」永远不可逆 —— 三者的可逆性差异是刻意的，不是疏忽。
   */
  async function setArchived(assetId: string, archived: boolean) {
    setBusyId(assetId)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/assets/${assetId}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusyId(null)
    }
  }

  async function copyBrief() {
    if (!data?.shootBriefText) return
    await navigator.clipboard.writeText(data.shootBriefText)
    setCopiedBrief(true)
    setTimeout(() => setCopiedBrief(false), 2000)
  }

  async function copyLink() {
    if (!data?.uploadUrl) return
    await navigator.clipboard.writeText(data.uploadUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!data && !error) {
    return <p className="text-sm font-semibold text-me-charcoal/50">读取素材…</p>
  }

  return (
    <section className="rounded-xl border border-me-charcoal/10 bg-white p-5">
      <h2 className="text-base font-black text-me-charcoal">这套房的推广素材</h2>

      {/* ── 上传口 ─────────────────────────────────────────── */}
      <div className="mt-3 rounded-lg bg-me-charcoal/[0.03] p-4">
        <p className="text-sm font-semibold text-me-charcoal/80">
          把这条链接发给中介 —— <strong>只属于这套房</strong>。他点开、选照片、传完，
          照片自动就归到这套房名下，不用他选也不用填表。
        </p>
        {data?.uploadUrl ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="max-w-full flex-1 overflow-x-auto rounded border border-me-charcoal/15 bg-white px-3 py-2 text-xs text-me-charcoal/70">
              {data.uploadUrl}
            </code>
            <button
              onClick={copyLink}
              className="rounded-lg bg-me-charcoal px-3 py-2 text-sm font-bold text-white"
            >
              {copied ? '已复制' : '复制链接'}
            </button>
          </div>
        ) : (
          <p className="mt-2 text-sm font-bold text-[#C2453A]">{data?.uploadUrlError}</p>
        )}
      </div>

      {/* ── 拍摄单：跟上传链接放在一起 ───────────────────────
          拿脚本去拍的人和传照片的人是同一个人。分开放就变成
          「脚本在一条微信里、链接在另一条微信里」，他一定会漏一个。 */}
      {data?.shootBrief && (
        <details className="mt-4 rounded-lg border border-me-charcoal/10 p-4">
          <summary className="cursor-pointer text-sm font-black text-me-charcoal">
            该拍什么 —— 拍摄单（{data.shootBrief.shots.length} 个镜头）
          </summary>

          <p className="mt-2 text-xs text-me-charcoal/60">{data.shootBrief.intro}</p>

          <ol className="mt-3 space-y-2">
            {data.shootBrief.shots.map((s) => (
              <li key={s.no} className="text-sm">
                <span className="font-bold text-me-charcoal">
                  {s.no}. {s.what}
                </span>
                <span className="ml-2 text-xs text-me-charcoal/50">{s.seconds}</span>
                {s.optional && (
                  <span className="ml-1 text-[11px] text-me-charcoal/40">［可省］</span>
                )}
                {s.how && <p className="mt-0.5 text-xs text-me-charcoal/60">{s.how}</p>}
              </li>
            ))}
          </ol>

          <ul className="mt-3 space-y-1 border-t border-me-charcoal/10 pt-3 text-xs text-me-charcoal/60">
            {data.shootBrief.rules.map((r, i) => (
              <li key={i}>· {r.replace(/\*\*/g, '')}</li>
            ))}
          </ul>

          <button
            onClick={copyBrief}
            className="mt-3 rounded-lg bg-me-charcoal px-3 py-2 text-sm font-bold text-white"
          >
            {copiedBrief ? '已复制（含上传链接）' : '复制拍摄单 —— 直接发微信'}
          </button>
        </details>
      )}

      {/* ── 现在能不能出广告 ───────────────────────────────── */}
      <p className="mt-4 text-sm font-black text-me-charcoal">{data?.summary}</p>
      {error && <p className="mt-2 text-sm font-bold text-[#C2453A]">{error}</p>}

      {/* ── 能用的 ─────────────────────────────────────────── */}
      {data && data.usable.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-black uppercase tracking-wide text-me-charcoal/50">
            可以投放（{data.usable.length}）
          </h3>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {data.usable.map((a) => (
              <figure key={a.id} className="rounded-lg border border-emerald-200 bg-emerald-50 p-2">
                <Thumb asset={a} />
                <figcaption className="mt-1 truncate text-[11px] text-emerald-800" title={a.filename}>
                  ✅ {a.filename || a.id}
                </figcaption>
                <p className="text-[10px] text-emerald-700">
                  {a.verifiedBy} 确认
                </p>
                {/* 只有「客户实拍（已确认）」才谈得上撤回 —— 撤回是把它退回未确认状态。
                    `fde_shot`（我们自己拍的）不能走这个按钮：2026-08-05 魏征抽查发现，
                    原来它也带撤回，一点就变成 `client_provided`，审计签名被清空，
                    而 UI 上没有任何路径能改回 `fde_shot`；再点一下确认，
                    **我们自己拍的照片就变成了「客户实拍」**，且不可逆。 */}
                {a.source === 'client_verified' && (
                  <button
                    onClick={() => setSource(a.id, 'client_provided')}
                    disabled={busyId === a.id}
                    className="mt-1 text-[11px] text-me-charcoal/50 underline disabled:opacity-40"
                  >
                    撤回确认
                  </button>
                )}
              </figure>
            ))}
          </div>
        </div>
      )}

      {/* ── 不能用的：逐张写清缺什么 ───────────────────────── */}
      {data && data.rejected.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-black uppercase tracking-wide text-me-charcoal/50">
            还不能投放（{data.rejected.length}）
          </h3>
          <ul className="mt-2 space-y-2">
            {data.rejected.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3"
              >
                <div className="w-20 shrink-0">
                  <Thumb asset={a} />
                </div>
                <div className="min-w-[12rem] flex-1">
                  <p className="truncate text-xs font-bold text-me-charcoal" title={a.filename}>
                    {a.filename || a.id}
                  </p>
                  <p className="mt-1 text-xs text-amber-900">{a.verdict?.why}</p>
                </div>
                {/* 传错了就收起来 —— 这是唯一能让一张素材从面板上消失的办法。
                    在这个按钮存在之前，传错一张就永远挂在这里（魏征 P0-2）。 */}
                <button
                  onClick={() => setArchived(a.id, true)}
                  disabled={busyId === a.id}
                  className="shrink-0 rounded-lg px-3 py-2 text-xs font-bold text-me-charcoal/60 ring-1 ring-me-charcoal/20 disabled:opacity-40"
                >
                  收起来
                </button>
                {/* 只有「客户传的、就差一个人看一眼」这一种能在这里直接补。
                    AI 生成 / 图库 / 来源不明 / 绑错房 / 已归档一律不给按钮 ——
                    有按钮就等于暗示可以绕过去。

                    🔴 2026-08-05 魏征抽查抓到的真 bug：这里原来是数 reasons 条数。
                    而 `not_client_provided` 是个**合并理由**——「客户传的还没确认」和
                    「AI 生成的」压成了同一个 code。于是 ai_generated / stock / unknown
                    的 reasons 也正好是那两条，按钮照样出，点一下就洗成「客户实拍」。
                    生产库里 83 张素材**全是 unknown**，补挂那一刻每张都会长出这个按钮。
                    所以判据必须落在 **source 本身**，不能落在理由条数上。 */}
                {a.source === 'client_provided' &&
                  a.verdict?.reasons.length === 1 &&
                  a.verdict.reasons[0] === 'not_verified' && (
                    <button
                      onClick={() => setSource(a.id, 'client_verified')}
                      disabled={busyId === a.id}
                      className="shrink-0 rounded-lg bg-me-charcoal px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
                    >
                      {busyId === a.id ? '处理中…' : '我看过，确认是这套房'}
                    </button>
                  )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-me-charcoal/50">
            没有「一键全部通过」—— 确认的意思是你看过这一张。
            传错了点「收起来」，再传新的：已经投出去的广告，画面不能在背后被换掉，
            所以这里只做收起，不做替换。
          </p>
        </div>
      )}

      {/* ── 已收起来的：能放回来，不是消失 ─────────────────── */}
      {data && data.archived?.length > 0 && (
        <details className="mt-5">
          <summary className="cursor-pointer text-xs font-black uppercase tracking-wide text-me-charcoal/50">
            已收起来（{data.archived.length}）
          </summary>
          <ul className="mt-2 space-y-2">
            {data.archived.map((a) => (
              <li key={a.id} className="flex items-center gap-3 rounded-lg bg-me-charcoal/[0.03] p-2">
                <div className="w-16 shrink-0 opacity-50">
                  <Thumb asset={{ ...a, source: null, verifiedBy: null, verifiedAt: null }} />
                </div>
                <span className="flex-1 truncate text-xs text-me-charcoal/60" title={a.filename}>
                  {a.filename || a.id}
                </span>
                <button
                  onClick={() => setArchived(a.id, false)}
                  disabled={busyId === a.id}
                  className="shrink-0 text-xs text-me-charcoal/60 underline disabled:opacity-40"
                >
                  放回来
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-me-charcoal/40">
            收起来只是不在上面显示，文件和归属一个字节都没动 ——
            已经投出去的广告当时用的是哪一张，必须永远查得回来。
          </p>
        </details>
      )}

      {data?.truncated && (
        <p className="mt-4 text-xs text-amber-800">
          ⚠️ 这套房的素材超过一页能显示的数量，上面只是其中一部分。
        </p>
      )}
    </section>
  )
}

function Thumb({ asset }: { asset: Asset }) {
  const isVideo = (asset.mimeType ?? '').startsWith('video/')
  if (isVideo) {
    return (
      <video
        src={asset.storageUrl}
        className="h-20 w-full rounded object-cover"
        muted
        preload="metadata"
      />
    )
  }
  return (
    // 素材是 Supabase Storage 的公开 URL，不走 next/image 的优化域白名单。
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={asset.storageUrl}
      alt={asset.filename || '素材'}
      className="h-20 w-full rounded object-cover"
      loading="lazy"
    />
  )
}
