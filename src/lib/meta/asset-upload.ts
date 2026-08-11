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
