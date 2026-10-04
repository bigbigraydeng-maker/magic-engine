/**
 * 把 ME 里的素材传到 Meta，换回建广告要用的 id。
 *
 * ── 为什么这一步非有不可（2026-08-05 子牙复审的第一刀）─────────────────────
 * 在这之前，建广告那条线是这么拿素材的：
 *     imageHash: body.imageHash    // 调用方随便给
 * 也就是说，那道「素材必须属于这套房、来源够硬、有人签字」的闸门，唯一的调用方
 * 是一个**只读展示接口**；真正花钱的那条线根本不查它。
 * **A 房的图拿去卖 B 房，照样做得成** —— 闸门在旁边的页面上亮着红灯而已。
 *
 * 有了这个模块，建广告就只能说「用这几个 asset id」，由服务端自己过闸、自己上传、
 * 自己换 id。调用方**没有任何入口**能绕过闸门塞一张图进去。
 *
 * ── 图片和视频走的是两条不同的路 ─────────────────────────────────────────
 * 图片：`/adimages` 只收字节，所以要先把文件下载回来再转发。
 * 视频：`/advideos` 支持 `file_url`，Meta 自己去拉，我们不用中转几十 MB。
 * 视频传完还要**转码**，转码期间不能建广告 —— 这不是我们能加速的，只能如实说。
 */

const GRAPH_BASE = 'https://graph.facebook.com/v21.0'

/** 一次最多接受多大的图。超了不是我们能修的，得让人换图。 */
const MAX_IMAGE_BYTES = 30 * 1024 * 1024

export type UploadedAsset =
  | { kind: 'image'; hash: string }
  | { kind: 'video'; videoId: string }

export type UploadResult =
  | { ok: true; asset: UploadedAsset }
  | { ok: false; error: string }

/**
 * 把一张图传进广告账户，换回 image hash。
 *
 * 失败一律返回原因，不抛也不吞 —— 上游要把「哪一张没传上去」原样告诉人。
 */
export async function uploadImageToMeta(
  adAccountId: string,
  storageUrl: string,
  accessToken: string,
  filename = 'asset.jpg',
): Promise<UploadResult> {
  let bytes: ArrayBuffer
  try {
    const res = await fetch(storageUrl)
    if (!res.ok) return { ok: false, error: `取素材失败 HTTP ${res.status}` }
    bytes = await res.arrayBuffer()
  } catch (err) {
    return { ok: false, error: `取素材失败：${err instanceof Error ? err.message : String(err)}` }
  }

  if (bytes.byteLength === 0) return { ok: false, error: '素材文件是空的' }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: `图片 ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB，超过 ${MAX_IMAGE_BYTES / 1024 / 1024}MB —— 需要换一张小的`,
    }
  }

  const form = new FormData()
  form.append('access_token', accessToken)
  form.append(filename, new Blob([bytes]), filename)

  let json: unknown
  try {
    const res = await fetch(`${GRAPH_BASE}/${adAccountId}/adimages`, { method: 'POST', body: form })
    const text = await res.text()
    if (!res.ok) return { ok: false, error: `Meta 拒收图片 HTTP ${res.status}: ${text.slice(0, 300)}` }
    json = JSON.parse(text)
  } catch (err) {
    return { ok: false, error: `传图失败：${err instanceof Error ? err.message : String(err)}` }
  }

  // 回执形状是 { images: { "<刚才那个文件名>": { hash, url } } }。
  // 不按文件名取 —— Meta 会自己改名（去扩展名、加后缀都见过），按名字取会静默拿到
  // undefined，然后建出一条没有图的广告。取第一个有 hash 的就对了。
  const images = (json as { images?: Record<string, { hash?: unknown }> } | null)?.images
  const hash = Object.values(images ?? {})
    .map((v) => v?.hash)
    .find((h): h is string => typeof h === 'string' && h.length > 0)

  if (!hash) return { ok: false, error: `Meta 回执里没有 image hash：${JSON.stringify(json).slice(0, 200)}` }
  return { ok: true, asset: { kind: 'image', hash } }
}

/**
 * 把一条视频交给 Meta（Meta 自己去 `file_url` 拉，不经过我们）。
 *
 * ⚠️ 拿到 id **不等于能立刻建广告**：Meta 那边还要转码。转码没完就建，会报
 * 「视频还没准备好」。这个函数只负责交付，不负责等 —— 等多久不是我们能控的，
 * 假装它同步完成只会让上游在一个看不懂的错误上卡住。
 */
export async function uploadVideoToMeta(
  adAccountId: string,
  storageUrl: string,
  accessToken: string,
  title?: string,
): Promise<UploadResult> {
  const body = new URLSearchParams({
    file_url: storageUrl,
    access_token: accessToken,
    ...(title ? { title } : {}),
  })

  try {
    const res = await fetch(`${GRAPH_BASE}/${adAccountId}/advideos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, error: `Meta 拒收视频 HTTP ${res.status}: ${text.slice(0, 300)}` }
    const id = (JSON.parse(text) as { id?: unknown }).id
    if (typeof id !== 'string' || !id) {
      return { ok: false, error: `Meta 回执里没有 video id：${text.slice(0, 200)}` }
    }
    return { ok: true, asset: { kind: 'video', videoId: id } }
  } catch (err) {
    return { ok: false, error: `传视频失败：${err instanceof Error ? err.message : String(err)}` }
  }
}

/** 按 mime 分流。判 mime 不判文件名 —— 文件名会骗人。 */
export async function uploadAssetToMeta(
  adAccountId: string,
  asset: { storageUrl: string; mimeType: string | null; filename?: string },
  accessToken: string,
): Promise<UploadResult> {
  return (asset.mimeType ?? '').startsWith('video/')
    ? uploadVideoToMeta(adAccountId, asset.storageUrl, accessToken, asset.filename)
    : uploadImageToMeta(adAccountId, asset.storageUrl, accessToken, asset.filename ?? 'asset.jpg')
}

// ── 等视频转码好 ────────────────────────────────────────────────────────────

export interface WaitVideoOptions {
  /** 两次查询之间等多久。默认 4 秒。 */
  intervalMs?: number
  /** **所有视频共用**的总期限。默认 25 秒。25 秒够不够没有实测依据 —— 不够就如实报，不假装好了。 */
  timeoutMs?: number
  /** 单次查询的上限。默认 15 秒。 */
  requestTimeoutMs?: number
  /** 可注入，测试用。 */
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export type WaitVideoResult =
  | { ok: true }
  | { ok: false; reason: 'timeout' | 'video_error' | 'fatal'; error: string }

type Probe = { state: 'ready' } | { state: 'wait' } | { state: 'fatal'; error: string }

/**
 * Meta 的「临时性」错误码：限流、临时故障。它们常常是 **HTTP 400**，不是 429 ——
 * 只看状态码会把限流当成致命错误。1 未知错误、2 临时故障、4 应用限流、17 用户限流、
 * 32 主页限流、341 临时故障、613 调用过多、80004 广告类限流。
 */
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613, 80004])

function classifyHttpError(httpStatus: number, json: unknown): Probe {
  const err = (json as { error?: { code?: unknown; is_transient?: unknown; message?: unknown } } | null)?.error
  const code = typeof err?.code === 'number' ? err.code : undefined
  if (code === 190) return { state: 'fatal', error: '这个客户的 Meta 授权失效了（code 190），要重新授权' }
  if (httpStatus === 429 || httpStatus >= 500) return { state: 'wait' }
  if (err?.is_transient === true || (code !== undefined && TRANSIENT_CODES.has(code))) {
    return { state: 'wait' }
  }
  // 响应体读不懂的 4xx 分类不了 —— 白等没意义，直接报。
  const why = typeof err?.message === 'string' ? err.message : '返回内容读不懂'
  return { state: 'fatal', error: `Meta 拒绝查询视频 HTTP ${httpStatus}：${why.slice(0, 200)}` }
}

async function probeVideo(videoId: string, accessToken: string, requestTimeoutMs: number): Promise<Probe> {
  if (!videoId) return { state: 'fatal', error: '有一条创意没有视频号' }
  const params = new URLSearchParams({ fields: 'status', access_token: accessToken })
  let res: Response
  try {
    res = await fetch(`${GRAPH_BASE}/${videoId}?${params}`, { signal: AbortSignal.timeout(requestTimeoutMs) })
  } catch {
    return { state: 'wait' } // 网络抖动 / 超时：下一轮再试，总期限兜底
  }
  const text = await res.text().catch(() => '')
  let json: unknown = null
  try { json = JSON.parse(text) } catch { /* 读不懂就保持 null */ }
  if (!res.ok) return classifyHttpError(res.status, json)

  const st = (json as { status?: { video_status?: unknown } } | null)?.status?.video_status
  if (st === 'ready') return { state: 'ready' }
  if (st === 'error') return { state: 'fatal', error: `视频 ${videoId} 转码失败（Meta 报 error）` }
  // processing / uploading / 字段缺失 / 没见过的值：一律当「还没好」。缺失不等于好了。
  return { state: 'wait' }
}

/** 不是有限数 / 太小的配置当没给：NaN 会让期限永远不到（热循环），0 会连着打 Graph 直到限流。 */
const sane = (n: number | undefined, fallback: number, min: number): number =>
  typeof n === 'number' && Number.isFinite(n) && n >= min ? n : fallback

/**
 * 等视频转码好再建广告。**不假装同步完成**：到期还没好就返回失败，由上游如实告诉人
 * 「广告没建，稍后重试」。放在任何写操作之前调用，所以失败时账户里什么都没建。
 *
 * 每一轮对所有没好的视频**同时**查：串行的话 4 条视频各卡 15 秒，一轮就是 60 秒，
 * 远超总期限（期限只在整轮结束后才检查）。单次请求的超时也随剩余期限收紧。
 */
export async function waitForVideoReady(
  videoIds: readonly string[],
  accessToken: string,
  opts: WaitVideoOptions = {},
): Promise<WaitVideoResult> {
  const intervalMs = sane(opts.intervalMs, 4_000, 500)
  const timeoutMs = sane(opts.timeoutMs, 25_000, 1_000)
  const requestTimeoutMs = sane(opts.requestTimeoutMs, 15_000, 1_000)
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  const startedAt = now()
  const pending = new Set(videoIds)
  while (pending.size > 0) {
    const perRequest = Math.max(1_000, Math.min(requestTimeoutMs, startedAt + timeoutMs - now()))
    const ids = [...pending]
    const probes = await Promise.all(ids.map((id) => probeVideo(id, accessToken, perRequest)))
    for (const [k, probe] of probes.entries()) {
      if (probe.state === 'fatal') {
        return { ok: false, reason: probe.error.includes('转码失败') ? 'video_error' : 'fatal', error: probe.error }
      }
      if (probe.state === 'ready') pending.delete(ids[k])
    }
    if (pending.size === 0) break
    const left = startedAt + timeoutMs - now()
    if (left <= 0) {
      const secs = Math.round((now() - startedAt) / 1000)
      return {
        ok: false,
        reason: 'timeout',
        error: `等了 ${secs} 秒，视频还在转码（${[...pending].join('、')}）—— 广告没建，稍后重试`,
      }
    }
    await sleep(Math.min(intervalMs, left))
  }
  return { ok: true }
}
