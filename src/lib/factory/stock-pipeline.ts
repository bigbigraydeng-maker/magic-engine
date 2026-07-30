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
import { TRANSFORM_COST_USD, buildTransformPrompt, buildTransformedMeta } from './stock-transform'
import { FACTORY_B_TRACK_SCENE_TAGS } from './constants'

const BUCKET = 'content-factory'
// 抓来的图统一进这个前缀,跟工厂产出的 renders/ 和 clips/ 分开,一眼能认出是外部素材
const STOCK_PREFIX = 'stock'
// 有些图床对无 UA 的请求直接 403(Pexels/Pixabay 咬过),带上常规 UA
const DL_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; MagicEngineBot/1.0)' }
const DEFAULT_MAX = 12
/** 硬上限:调用方传再大也不超过这个数,防一次把整批图读进内存 */
const HARD_MAX = 30
/** 同时在飞的下载数 */
const DL_CONCURRENCY = 4
/** 单张下载超时:图床挂起时不能让整条 cron 卡死 */
const DL_TIMEOUT_MS = 20_000
/** 单张图上限 15MB:Pinterest original 通常 1-3MB,超这个量级多半不是我们要的东西 */
const MAX_IMAGE_BYTES = 15 * 1024 * 1024

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
  // 硬上限:防调用方(或未来的 cron)传个大数,把整批图同时读进内存
  const max = Math.min(opts.max ?? DEFAULT_MAX, HARD_MAX)
  const picked = images.slice(0, max)
  const errors: string[] = []

  // 🔴 先查后下:storage path = sha256(url) 的纯函数,**在任何网络 IO 之前就能算出**。
  // 此前是先把每张图都 fetch(1-3MB)+ upload 一遍,最后才查重 —— cron 每天重跑同一个
  // 搜索词会命中大部分同样的图,等于每天白下载白上传一整批。
  const pathOf = (img: HarvestedImage) => `${STOCK_PREFIX}/${clientId}/${fileNameFor(img.url)}`
  const { data: existingRows } = await supabaseAdmin
    .from('video_clips')
    .select('storage_url')
    .eq('client_id', clientId)
    .in('storage_url', picked.map(pathOf))
  const knownPaths = new Set((existingRows ?? []).map((r) => r.storage_url as string))

  // 有行 **且** 桶里对象还在,才算真的已入库。只看行会留下悬空行 ——
  // 桶被清过的话,evaluate 会把一个 404 地址当源图喂给 i2v,那次生成必然失败。
  const alreadyIngested = new Set<string>()
  if (knownPaths.size > 0) {
    const { data: objects } = await supabaseAdmin.storage
      .from(BUCKET)
      .list(`${STOCK_PREFIX}/${clientId}`, { limit: 1000 })
    const present = new Set((objects ?? []).map((o) => `${STOCK_PREFIX}/${clientId}/${o.name}`))
    knownPaths.forEach((p) => { if (present.has(p)) alreadyIngested.add(p) })
  }

  const todo = picked.filter((img) => !alreadyIngested.has(pathOf(img)))

  // 把图搬进 bucket,记下每张的落地路径(失败的 → null,buildStockClipRows 会跳过)
  const pathByIndex = new Map<number, string | null>()
  // 已入库的直接记路径,不再下载
  picked.forEach((img, i) => {
    if (alreadyIngested.has(pathOf(img))) pathByIndex.set(i, pathOf(img))
  })

  // 限并发:一次最多 4 个下载在飞,避免大图并发把内存顶爆
  const indexOfImg = new Map(picked.map((img, i) => [img, i] as const))
  for (let start = 0; start < todo.length; start += DL_CONCURRENCY) {
    const batch = todo.slice(start, start + DL_CONCURRENCY)
    await Promise.all(
      batch.map(async (img) => {
        const i = indexOfImg.get(img)!
        try {
          // 超时:图床挂起时不能让整条 cron 卡死
          const res = await fetch(img.url, { headers: DL_HEADERS, signal: AbortSignal.timeout(DL_TIMEOUT_MS) })
          if (!res.ok) { errors.push(`下载失败(${res.status}): ${img.url.slice(-40)}`); pathByIndex.set(i, null); return }
          // 内容类型必须真是图片:HTTP 200 也可能返回一个错误页 HTML,存进去 i2v 会失败
          const ct = res.headers.get('content-type') ?? ''
          if (!ct.startsWith('image/')) { errors.push(`非图片(${ct}): ${img.url.slice(-40)}`); pathByIndex.set(i, null); return }
          const buf = Buffer.from(await res.arrayBuffer())
          if (buf.length === 0) { errors.push(`空文件: ${img.url.slice(-40)}`); pathByIndex.set(i, null); return }
          if (buf.length > MAX_IMAGE_BYTES) { errors.push(`图太大(${Math.round(buf.length / 1e6)}MB): ${img.url.slice(-40)}`); pathByIndex.set(i, null); return }
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
  }

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

  // 去重复用开头那次查询的结果(knownPaths):库里已有行的不重插。
  // 注意跟 alreadyIngested 的区别 —— 那个还要求桶里对象在;这里只要有行就不该重插,
  // 否则「行在但对象被清掉」的情况会插出重复行。对象缺失的那些上面已重新上传补回。
  const fresh = rows.filter((r) => !knownPaths.has(r.storage_url))

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
 * 抓来的原图 → AI 改图 → 落库成新 clip。
 *
 * 这是 PM 反复要求的「抓图,用 ai 改图(防止版权问题),从图再升视频」的中间那段,
 * 此前完全缺失。改完的图才是 i2v 的合法源图 —— 原图只留作输入,永不进成片。
 *
 * 成本:gpt-image-1 每张约 $0.04。所以只改**还没改过的**,且限量。
 */
export async function transformStockImages(
  clientId: string,
  opts: { max?: number; look?: string | null } = {},
): Promise<{ transformed: number; skipped: number; errors: string[] }> {
  const max = Math.min(opts.max ?? 8, 16)
  const errors: string[] = []

  // 待改的:抓来的原图里,还没有衍生图的那些
  const { data: sources } = await supabaseAdmin
    .from('video_clips')
    .select('id, storage_url, title, scene_tag, source_meta')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .eq('source_meta->>origin', 'stock_harvest')
    .limit(60)

  const { data: derived } = await supabaseAdmin
    .from('video_clips')
    .select('source_meta')
    .eq('client_id', clientId)
    .eq('source_meta->>origin', 'stock_transformed')
  const alreadyDerived = new Set(
    (derived ?? [])
      .map((d) => ((d.source_meta ?? {}) as Record<string, unknown>).derived_from_clip_id)
      .filter((v): v is string => typeof v === 'string'),
  )

  const todo = (sources ?? []).filter((s) => !alreadyDerived.has(s.id as string)).slice(0, max)
  if (todo.length === 0) return { transformed: 0, skipped: 0, errors }

  const { transformImage } = await import('@/lib/visual/openai-images')
  const rows: Record<string, unknown>[] = []

  // 串行:gpt-image-1 慢且贵,并发容易撞速率限制,也不便于中途叫停
  for (const src of todo) {
    try {
      const publicUrl = toPublicUrl(src.storage_url as string)
      if (!publicUrl) { errors.push(`源图地址不可用: ${src.id}`); continue }
      const res = await fetch(publicUrl, { headers: DL_HEADERS, signal: AbortSignal.timeout(DL_TIMEOUT_MS) })
      if (!res.ok) { errors.push(`源图下载失败(${res.status})`); continue }
      const buf = Buffer.from(await res.arrayBuffer())

      const prompt = buildTransformPrompt({
        title: src.title as string | null,
        look: opts.look ?? null,
        sceneHint: src.scene_tag as string | null,
      })
      const { b64 } = await transformImage({
        image: buf,
        prompt,
        aspect_ratio: '9:16',
        filename: (src.storage_url as string).split('/').pop() ?? 'source.jpg',
      })

      const outBuf = Buffer.from(b64, 'base64')
      const path = `${STOCK_PREFIX}/${clientId}/ai_${src.id}.png`
      const { error: upErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(path, outBuf, { contentType: 'image/png', upsert: true })
      if (upErr) { errors.push(`改后图上传失败: ${upErr.message}`); continue }

      rows.push({
        client_id: clientId,
        scene_tag: src.scene_tag,
        track: 'b_generated',
        storage_url: path,
        duration_seconds: 4,
        motion_type: null,
        title: src.title,
        generation_cost_usd: TRANSFORM_COST_USD,
        source_meta: buildTransformedMeta({
          sourceClipId: src.id as string,
          sourceUrl: ((src.source_meta ?? {}) as Record<string, unknown>).source_url as string | null,
          prompt,
          query: ((src.source_meta ?? {}) as Record<string, unknown>).query as string | null,
        }),
      })
    } catch (e) {
      errors.push(`改图失败: ${e instanceof Error ? e.message : e}`)
    }
  }

  if (rows.length > 0) {
    const { error: insErr } = await supabaseAdmin.from('video_clips').insert(rows)
    if (insErr) { errors.push(`改后图入库失败: ${insErr.message}`); return { transformed: 0, skipped: todo.length, errors } }
  }
  return { transformed: rows.length, skipped: todo.length - rows.length, errors }
}

/** storage 相对路径 → 公开 URL(改图要先把源图下载下来) */
function toPublicUrl(storageUrl: string | null): string | null {
  if (!storageUrl) return null
  if (/^https?:\/\//i.test(storageUrl)) return storageUrl
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  return base ? `${base}/storage/v1/object/public/${BUCKET}/${storageUrl.replace(/^\/+/, '')}` : null
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
  // 用全仓既有的 APIFY_API_KEY(诊断/口碑/社媒采集器都在用,Render 上早已配好)。
  // 🔴 教训:我本来新造了个 APIFY_TOKEN —— 平白多一个要人工配的变量,
  // 而同一个账号的 key 仓里到处都在用。写新 env 前先 grep 既有命名。
  const token = params.apifyToken ?? process.env.APIFY_API_KEY ?? process.env.APIFY_TOKEN
  if (!token) throw new Error('APIFY_API_KEY 未配置,无法自动抓取素材')

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
