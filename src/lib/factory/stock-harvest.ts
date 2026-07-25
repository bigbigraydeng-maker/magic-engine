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
  /** 🔴 客户级禁区词(地理/品类):中国游客户填 paris/italy/santorini,建材客户填 beverage/drink */
  offTopic?: readonly string[]
}

const DEFAULTS: Required<HarvestOptions> = {
  minWidth: 700,
  minAspectRatio: 1.2,
  minSaves: 50,
  offTopic: [],
}

/**
 * 🔴 标题黑名单:抓回来但**不能当客户素材**的东西。
 *
 * 2026-07-26 PM 看片后查库,实测抓到的垃圾(全部真实样本):
 * - CTS(中国游)抓到 Positano/Amalfi(意大利)、paris trip planning、Santorini(希腊)
 *   → 画面配着「Your China trip starts here」出现 = 误导客户,踩「绝不编业务事实」红线
 * - CTS 还抓到「5 steps to choosing travel insurance」「asia travel map」「wallpaper 4k」
 *   → 资讯图/地图/壁纸根本不是可用的场景素材
 * - Oztop(建材)抓到 Schweppes 汽水、matcha 饮料、俄语设计教程、「Text portrait」海报
 *   → 一张建材都没有
 *
 * 光靠搜索词治不了 —— Pinterest 的相关推荐必然混进这些。所以入库前再筛一道。
 */
const TITLE_BLOCKLIST = [
  // 非场景素材:资讯图/教程/海报/地图/壁纸(有文字、没画面价值)
  /\b(infographics?|tutorials?|posters?|wallpapers?|templates?|mockups?|checklists?)\b/i,
  /\b(tips?|guide|how\s?to|steps?\s+to|ways?\s+to)\b/i,
  /\bmap\b/i,
  // 明显的社媒运营/设计类内容,不是实拍场景
  /\b(social media|branding concept|hero product shot)\b/i,
  // 非拉丁噪音标题(俄语/其他语种的教程推广)
  /[Ѐ-ӿ]/,
]

/** 标题是否该被挡掉(纯函数,可测) */
export function isBlockedTitle(title: string | null | undefined): boolean {
  if (!title) return false // 无标题不拦:Pinterest 很多好图没标题
  const t = title.trim()
  if (t.length <= 2) return true // "1" "💨" 这种
  return TITLE_BLOCKLIST.some((re) => re.test(t))
}

/**
 * 标题跟业务锚点是否冲突 —— 地理/品类跑偏的硬闸。
 * @param offTopic 客户级禁区词(如中国游客户禁 paris/italy;建材客户禁 beverage)
 */
export function isOffTopic(title: string | null | undefined, offTopic: readonly string[]): boolean {
  if (!title || offTopic.length === 0) return false
  const t = title.toLowerCase()
  return offTopic.some((w) => w.trim() && t.includes(w.trim().toLowerCase()))
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

    // 🔴 内容相关性两道闸(实测抓到过意大利/巴黎/希腊/汽水/俄语教程,见 TITLE_BLOCKLIST 头注)
    const title = typeof r.title === 'string' ? r.title : null
    if (isBlockedTitle(title)) continue          // 不是可用的场景素材
    if (isOffTopic(title, o.offTopic)) continue  // 跟客户业务对不上

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
  /** 🔴 业务锚点(行业 + 地域):必须拼进每一条搜索词,否则抓回来的东西跟客户没关系 */
  anchor?: string | null
  max?: number
}): string[] {
  const { contentPillars, coreProposition, anchor, max = 4 } = params
  const a = anchor?.trim()
  // 没有业务锚点就不抓 —— 抓回来也是废图,还要花钱
  if (!a) return []

  const qs: string[] = []
  for (const p of contentPillars ?? []) {
    const name = typeof p === 'string' ? p : p?.name
    if (!name?.trim()) continue
    // 抽象支柱名单独当搜索词会跑偏(实测:"Product Education & How-To photography"
    // 搜出一堆摄影教程;"Travel Planning & Education" 搜出保险资讯图和巴黎)。
    // 只取支柱里的**具体名词**,并且永远跟业务锚点绑在一起。
    const concrete = pillarKeywords(name)
    qs.push(concrete ? `${a} ${concrete}` : a)
    if (qs.length >= max) break
  }
  if (qs.length === 0 && coreProposition) {
    const words = coreProposition.split(/\s+/).filter((w) => w.length > 3).slice(0, 3)
    qs.push(words.length ? `${a} ${words.join(' ')}` : a)
  }
  // 去重后返回(不同支柱可能压出同一条词)
  return Array.from(new Set(qs)).slice(0, max)
}

/**
 * 从支柱名里剥出可搜的具体名词。
 * 「Product Education & How-To」「Destination Inspiration」这类是**内部策划用语**,
 * 直接拿去搜图必然跑偏 —— 剥掉这些抽象词,只留下有画面感的部分;全被剥光则返回 null,
 * 让调用方只用业务锚点搜(宁可宽泛也不要搜错方向)。
 */
function pillarKeywords(name: string): string | null {
  const ABSTRACT =
    /\b(education|educational|how[- ]?to|tips?|guide|guides|inspiration|trends?|planning|highlights?|offers?|social|proof|celebration|story|stories|expertise|heritage|product)\b/gi
  const cleaned = name
    .replace(/&/g, ' ')
    .replace(ABSTRACT, ' ')
    .replace(/[^A-Za-z0-9一-龥\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length >= 3 ? cleaned.toLowerCase() : null
}
