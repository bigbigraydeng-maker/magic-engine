/**
 * 抓来的素材入库 —— 把 stock-harvest 筛出的图变成工厂真能用的 video_clips。
 *
 * 这一段是 2026-07-25 的接线缺口:stock-harvest 抓+筛做完了但**没有任何调用方**,
 * 能力孤立在链路之外 = 有配方没进厨房。同样的错今天已经犯过一次(爆款配方接了,
 * 但只作用于新生成画面,而成片全用库存,等于没生效)。
 *
 * 链路:抓图 → 筛 → **本模块入库** → worker i2v 转视频 → strategist 选片 → 出片
 *
 * 🔴 入库红线(不可放宽):
 * 抓来的图一律 `track = 'b_generated'`,**绝不能标 a_real**。
 * strategist.selectClips 在客户有 verified_offer(真价)时会**只留 a_real**
 * —— 这是「AI/网图绝不背书客户真实价格」那道闸的唯一实现。标错 track 会让网图
 * 直接盖上客户真价发出去,是已经出过的事故(见 CLAUDE.md「绝不凭空注入客户业务数据」)。
 * `a_real` 只留给客户自己上传的真拍素材。
 */

import type { HarvestedImage } from './stock-harvest'

/** video_clips 一行(入库用,字段对齐实表 NOT NULL 约束) */
export interface StockClipRow {
  client_id: string
  scene_tag: string
  track: 'b_generated'
  storage_url: string
  duration_seconds: number
  motion_type: string | null
  title: string | null
  generation_cost_usd: number
  source_meta: Record<string, unknown>
}

/** 静图还没转成视频时的占位时长 —— i2v 产出通常 3-5 秒,取 4 秒中位 */
const PLACEHOLDER_DURATION_S = 4

/** scene_tag 只能用抽象标签:具体地标进 B 轨会撞护栏 6(complete-work-order 会 422 拒收)。 */
const ABSTRACT_SCENE_FALLBACK = 'establishing'

/**
 * 把搜索词规范成合法 scene_tag。
 * 只留字母数字和下划线,避免 SQL/路径里出现怪字符;空则退回抽象兜底。
 */
export function toSceneTag(query: string, whitelist: readonly string[]): string {
  const norm = query
    .toLowerCase()
    .replace(/photography|vertical|photo|image/g, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  if (!norm) return ABSTRACT_SCENE_FALLBACK
  // 命中白名单直接用;否则退回抽象兜底(护栏 6:B 轨不许具体地标)
  return (whitelist as readonly string[]).includes(norm) ? norm : ABSTRACT_SCENE_FALLBACK
}

/**
 * 抓来的图 → video_clips 行。纯函数,不碰 DB(便于测 + 便于调用方决定何时写)。
 *
 * @param storagePathFor 由调用方提供:把图搬进 content-factory bucket 后的路径。
 *   传 null 表示这张图搬运失败 → 跳过,绝不用外链入库(外链会失效,成片到时候黑屏)。
 */
export function buildStockClipRows(params: {
  clientId: string
  images: HarvestedImage[]
  query: string
  sceneTagWhitelist: readonly string[]
  storagePathFor: (img: HarvestedImage, index: number) => string | null
  max?: number
}): StockClipRow[] {
  const { clientId, images, query, sceneTagWhitelist, storagePathFor, max = 20 } = params
  const sceneTag = toSceneTag(query, sceneTagWhitelist)
  const rows: StockClipRow[] = []

  images.slice(0, max).forEach((img, i) => {
    const path = storagePathFor(img, i)
    // 没搬进自家存储的一律不入库:外链哪天失效,出片直接黑屏且很难反查
    if (!path) return

    rows.push({
      client_id: clientId,
      scene_tag: sceneTag,
      // 🔴 见文件头注:抓来的一律 b_generated,绝不 a_real
      track: 'b_generated',
      storage_url: path,
      duration_seconds: PLACEHOLDER_DURATION_S,
      motion_type: null,
      title: img.title,
      generation_cost_usd: 0, // 抓取成本记在别处,单张视作 0
      source_meta: {
        // 溯源:这批素材从哪来、凭什么被选中 —— 出问题时能一路查回原图
        origin: 'stock_harvest',
        provider: 'pinterest',
        source_url: img.url,
        saves: img.saves,
        width: img.width,
        height: img.height,
        query,
        harvested_at: new Date().toISOString(),
        // 明确标注:**不是客户真拍**,别拿去打真价
        is_real_footage: false,
        // 🔴🔴 最关键的一条:这是**静图**,不是视频片段。
        // selectClips 会把 clipStock 里的东西当**现成视频**直接塞进 segments[].clip_ids,
        // worker 下载它当 mp4 播 —— 静图当视频 = 黑屏/装配失败。
        // selectClips 必须靠这个标记把它排除出视频池,只当 i2v 源图用(sourceImagePool)。
        is_still_image: true,
      },
    })
  })

  return rows
}
