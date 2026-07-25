/**
 * 素材抓取管道 —— 把「抓 → 筛 → 入库」串成一条,接上出片链路的最后一环。
 *
 * 这是 stock-harvest(抓+筛)/ stock-ingest(建行)之后**真正落地**的一步:下载图 →
 * 传进 content-factory bucket → 写进 video_clips(标 is_still_image)。写完之后,
 * evaluate 建单时会把这些静图组成 sourceImagePool 喂给 i2v(见 evaluate.ts 分流),
 * 每段用不同的一张当底子 —— 这才让「所有 AI 画面从同一张种子图长出来」的老路终结。
 *
 * 分两层:
 * - ingestHarvestedImages: 已有图对象 → 落库。纯 IO 编排,是今天能端到端验证的部分。
 * - harvestAndIngestForClient: 完整版(拼词 → Apify 抓 → ingest),给 cron 用,需 APIFY_TOKEN。
 *
 * 🔴 红线(见 stock-ingest 头注):落库一律 track=b_generated + is_still_image=true +
 * is_real_footage=false。抓来的图只做氛围底子,绝不当客户真拍去打真价。
 */

import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { buildSearchQueries, normalizeHarvest, type HarvestedImage } from './stock-harvest'
import { buildStockClipRows } from './stock-ingest'
import { FACTORY_B_TRACK_SCENE_TAGS } from './constants'

const BUCKET = 'content-factory'
// 抓来的图统一进这个前缀,跟工厂产出的 renders/ 和 clips/ 分开,一眼能认出是外部素材
const STOCK_PREFIX = 'stock'
// 有些图床对无 UA 的请求直接 403(Pexels/Pixabay 咬过),带上常规 UA
const DL_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; MagicEngineBot/1.0)' }

export interface IngestResult {
  ingested: number
  skipped: number
  errors: string[]
}

/** URL → 稳定文件名(同一张图重复抓 = 同名 upsert 覆盖,天然去重不重复占存储) */
function fileNameFor(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 16)
  const ext = /\.(jpe?g|png|webp)(\?|$)/i.exec(url)?.[1]?.toLowerCase() ?? 'jpg'
  return `${hash}.${ext === 'jpeg' ? 'jpg' : ext}`
}

function contentTypeFor(name: string): string {
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}

/**
 * 下载 + 上传 + 落库。返回入库计数。
 * 单张失败(下载 403 / 上传错)不拖累其他张,记进 errors。
 */
export async function ingestHarvestedImages(
  clientId: string,
  images: HarvestedImage[],
  query: string,
  opts: { max?: number } = {},
): Promise<IngestResult> {
  const max = opts.max ?? 12
  const picked = images.slice(0, max)
  const errors: string[] = []

  // 先把图搬进 bucket,记下每张的落地路径(失败的 → null,buildStockClipRows 会跳过)
  const pathByIndex = new Map<number, string | null>()
  await Promise.all(
    picked.map(async (img, i) => {
      try {
        const res = await fetch(img.url, { headers: DL_HEADERS })
        if (!res.ok) { errors.push(`下载失败(${res.status}): ${img.url.slice(-40)}`); pathByIndex.set(i, null); return }
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.length === 0) { errors.push(`空文件: ${img.url.slice(-40)}`); pathByIndex.set(i, null); return }
        const name = fileNameFor(img.url)
        const path = `${STOCK_PREFIX}/${clientId}/${name}`
        const { error: upErr } = await supabaseAdmin.storage
          .from(BUCKET)
          .upload(path, buf, { contentType: contentTypeFor(name), upsert: true })
        if (upErr) { errors.push(`上传失败: ${upErr.message}`); pathByIndex.set(i, null); return }
        pathByIndex.set(i, path)
      } catch (e) {
        errors.push(`搬运异常: ${e instanceof Error ? e.message : e}`)
        pathByIndex.set(i, null)
      }
    }),
  )

  const rows = buildStockClipRows({
    clientId,
    images: picked,
    query,
    sceneTagWhitelist: FACTORY_B_TRACK_SCENE_TAGS,
    storagePathFor: (_img, i) => pathByIndex.get(i) ?? null,
    max,
  })

  if (rows.length === 0) {
    return { ingested: 0, skipped: picked.length, errors }
  }

  // 去重:同 storage_url 已入库过就不重插(重复抓同一批时幂等)
  const paths = rows.map((r) => r.storage_url)
  const { data: existing } = await supabaseAdmin
    .from('video_clips')
    .select('storage_url')
    .eq('client_id', clientId)
    .in('storage_url', paths)
  const seen = new Set((existing ?? []).map((r) => r.storage_url as string))
  const fresh = rows.filter((r) => !seen.has(r.storage_url))

  if (fresh.length > 0) {
    const { error: insErr } = await supabaseAdmin.from('video_clips').insert(fresh)
    if (insErr) {
      errors.push(`入库失败: ${insErr.message}`)
      return { ingested: 0, skipped: picked.length, errors }
    }
  }

  return { ingested: fresh.length, skipped: picked.length - fresh.length, errors }
}

/**
 * 完整版:从客户品牌资料拼搜索词 → Apify Pinterest 抓 → ingest。
 * 需 APIFY_TOKEN(缺则报错,不静默)。供 cron / 手动补库调用。
 */
export async function harvestAndIngestForClient(params: {
  clientId: string
  contentPillars: Array<{ name?: string } | string> | null
  coreProposition: string | null
  apifyToken?: string
  perQuery?: number
}): Promise<{ query: string; result: IngestResult }[]> {
  const { clientId, contentPillars, coreProposition, perQuery = 12 } = params
  const token = params.apifyToken ?? process.env.APIFY_TOKEN
  if (!token) throw new Error('APIFY_TOKEN 未配置,无法自动抓取素材')

  const queries = buildSearchQueries({ contentPillars, coreProposition, max: 3 })
  const out: { query: string; result: IngestResult }[] = []

  for (const query of queries) {
    // Apify 同步抓 + 直接取 dataset(silentflow/pinterest-scraper-ppr)
    const res = await fetch(
      `https://api.apify.com/v2/acts/silentflow~pinterest-scraper-ppr/run-sync-get-dataset-items?token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ search: query, maxItems: perQuery, includeDetails: true }),
      },
    )
    if (!res.ok) {
      out.push({ query, result: { ingested: 0, skipped: 0, errors: [`Apify 抓取失败(${res.status})`] } })
      continue
    }
    const raw = (await res.json()) as unknown[]
    const images = normalizeHarvest(raw)
    const result = await ingestHarvestedImages(clientId, images, query, { max: perQuery })
    out.push({ query, result })
  }

  return out
}
