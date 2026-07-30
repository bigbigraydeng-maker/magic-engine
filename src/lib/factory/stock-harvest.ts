/**
 * 素材抓取 — 从全网补齐画面,治「库里全是通用风光图」。
 *
 * 为什么要有:PM 2026-07-24 看片判决「所有作品千篇一律…几张图片混剪」。抽帧核实后确认
 * 根因之一是**素材池太薄且同质**(CTS 18 条全是通用风光,任何一家旅行社都能用)。
 * PM 2026-07-25 拍板:「素材不足你去全网给我抓,apify/pinterest/unsplash 都给我用上」。
 *
 * 选型说明(为什么是 Apify 而不是 Unsplash API):
 * - `src/lib/images/unsplash.ts` 已存在但**是死代码且需 UNSPLASH_ACCESS_KEY**,本机/线上都没配。
 * - Apify 凭据现成且已验证可用(同一套凭据已成功抓过 FB reel)。
 * - Pinterest 额外给**热度信号**(saves),能按「被收藏多少次」排序挑图 —— 这是 Unsplash
 *   给不了的:好不好看有客观代理指标,不靠 AI 自己瞎猜。
 *
 * 成本:约 $0.002/张(silentflow/pinterest-scraper-ppr),12 张 ≈ $0.023。
 *
 * 🔴 用途边界(见 CLAUDE.md「素材来源政策」):抓来的图只做**氛围/背景**。
 * 客户的真实产品、真实价格,只能用客户自己提供的素材 —— 抓来的图冒充客户产品去打真价,
 * 是已经出过的事故。这条不是版权洁癖,是客户利益。
 */

export interface HarvestedImage {
  url: string
  width: number
  height: number
  /** Pinterest 收藏数 —— 唯一客观的「好不好看」代理指标 */
  saves: number
  title: string | null
  /** 主色,用于跟品牌配色做粗筛 */
  dominantColor: string | null
  aspectRatio: number
}

export interface HarvestOptions {
  /** 最少宽度 —— 低于这个数放进 1080×1920 会糊 */
  minWidth?: number
  /** 只要竖版:高/宽 ≥ 这个值(9:16 = 1.78,放宽到 1.2 以容纳 4:5) */
  minAspectRatio?: number
  /** 最少收藏数,过滤没人认可的图 */
  minSaves?: number
}

const DEFAULTS: Required<HarvestOptions> = {
  minWidth: 700,
  minAspectRatio: 1.2,
  minSaves: 50,
}

/** Apify 抓回来的原始行 → 规范化 + 按可用性过滤。纯函数,可测。 */
export function normalizeHarvest(
  rows: unknown[],
  opts: HarvestOptions = {},
): HarvestedImage[] {
  const o = { ...DEFAULTS, ...opts }
  const out: HarvestedImage[] = []
  const seen = new Set<string>()

  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>

    // 视频不要:本模块只补静图,视频走 i2v 生成
    if (r.isVideo === true) continue

    const urls = (r.imageUrls ?? {}) as Record<string, unknown>
    const url = typeof urls.original === 'string' ? urls.original
      : typeof r.imageUrl === 'string' ? r.imageUrl
      : null
    if (!url || seen.has(url)) continue

    const width = Number(r.width) || 0
    const height = Number(r.height) || 0
    if (width < o.minWidth) continue

    const aspectRatio = height > 0 && width > 0 ? height / width : 0
    if (aspectRatio < o.minAspectRatio) continue

    const saves = Number(r.saves) || 0
    if (saves < o.minSaves) continue

    seen.add(url)
    out.push({
      url,
      width,
      height,
      saves,
      title: typeof r.title === 'string' && r.title.trim() ? r.title.trim().slice(0, 160) : null,
      dominantColor: typeof r.dominantColor === 'string' ? r.dominantColor : null,
      aspectRatio: Math.round(aspectRatio * 100) / 100,
    })
  }

  // 收藏数降序 = 先用最被认可的
  return out.sort((a, b) => b.saves - a.saves)
}

/**
 * 按客户品牌资料拼搜索词。
 * 不硬编码任何客户 —— 词从 brief 的可溯源条目来(跟角度溯源同一条纪律)。
 */
export function buildSearchQueries(params: {
  contentPillars: Array<{ name?: string } | string> | null
  coreProposition: string | null
  max?: number
}): string[] {
  const { contentPillars, coreProposition, max = 4 } = params
  const qs: string[] = []
  for (const p of contentPillars ?? []) {
    const name = typeof p === 'string' ? p : p?.name
    if (name && name.trim()) qs.push(`${name.trim()} photography vertical`)
    if (qs.length >= max) break
  }
  if (qs.length === 0 && coreProposition) {
    // 兜底:取 core_proposition 前几个实词,避免整句当搜索词(搜不到东西)
    const words = coreProposition.split(/\s+/).filter((w) => w.length > 3).slice(0, 4)
    if (words.length) qs.push(`${words.join(' ')} photography vertical`)
  }
  return qs.slice(0, max)
}
