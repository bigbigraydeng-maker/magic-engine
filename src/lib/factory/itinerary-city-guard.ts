// 出片前的「行程城市核验」闸 —— 纯函数（同输入永远同输出，无外部调用、无 vision 猜测）。
//
// 为什么不用视觉模型判断：face-frame.ts 已记录教训——让视觉模型判断图像内容，它是在猜，
// 同一张图两次给不同答案，已废弃。本闸只吃**文字**（镜头声明的上屏字幕 / 场景标签 /
// 角度 / caption）与**行程授权城市清单**，文字对文字，确定性可测。
//
// 画面像素层的错配（把长城实拍硬标成「外滩」骗过文字层）仍由马良帧审 + 人眼分镜自检兜底，
// 本闸不声称覆盖这一层。
//
// 返回值带"判定 + 证据碎片 + 稳定 code"——注意它**不是完整 receipt**：缺 request_id /
// client_id / 时间戳等身份字段（纯函数不该编造这些）。接 Inngest 时，由 step 把这些结论
// 连同身份字段一起落成 receipt。`code` 是稳定机器码，供下游分支/告警，别去解析中文 reason。
//
// 三态（不是两态）：
//   - pass  ：地名 ∈ 授权城市（归一后），或这段根本不是地点。
//   - flag  ：像地名但映不出唯一城市 / 拿不到授权清单 → 交人审，不硬判死。
//   - block ：地名确信识别出的城市，且不在该团授权城市里。
//
// 归一化 / 分词策略照抄 shot-guards.ts：英文按词边界 + 单复数归一（挡 Chinatown⊃china），
// 中文按 substring（中文无词边界）。别另造一套不一致的。

// ─────────────────────────────────────────────────────────────────────────
// 共用：轻量英文分词 + 单复数归一（词边界匹配，避免 sign⊂design、shop⊂shopping 误伤）
// ─────────────────────────────────────────────────────────────────────────

/**
 * 英文按词切成小写 token，并为每个复数 token 补一个去尾 -s 的单数形
 * （billboards→billboard、menus→menu、warriors→warrior），词表用单数即可命中复数。
 * 只削 's' 且 token 长度 > 3，避免 is/as/us 之类被误削。
 *
 * 与 shot-guards.ts 的 singularEnglishTokens 同策略（此处独立一份，避免跨文件耦合）。
 */
function singularEnglishTokens(s: string): Set<string> {
  const set = new Set<string>()
  for (const t of s.toLowerCase().match(/[a-z]+/g) ?? []) {
    set.add(t)
    if (t.length > 3 && t.endsWith('s')) set.add(t.slice(0, -1))
  }
  return set
}

/**
 * 归一化一个地名 / 城市名：去撇号、trim、小写、折叠空白。
 * 撇号先归一（xi'an→xian），让带撇号的地名也能命中。
 */
function normalizePlace(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
}

// ─────────────────────────────────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────────────────────────────────

export type ItineraryCityCode =
  | 'CITY_ON_ITINERARY'   // pass：地名在授权城市内
  | 'CITY_OFF_ITINERARY'  // block：地名确信在行程外
  | 'PLACE_UNMAPPED'      // flag：命中的地名映到多个城市、无法唯一判定
  | 'NO_ITINERARY'        // flag：没有授权城市清单可比
  | 'NO_PLACE_CLAIMED'    // pass：这段没有任何地名

export interface ItineraryCityItem {
  segmentIndex: number
  placeText: string        // 命中的原始地名文字；无地名时为 ''
  city: string             // 归一后的城市；无/不唯一时为 ''
  code: ItineraryCityCode
  reason: string           // 中文，给人看，别去机器解析
}

// 地名表：一个归一化词 -> 一个或多个城市。多个=有歧义。
export type PlaceGazetteer = ReadonlyMap<string, readonly string[]>

export interface ItineraryCityResult {
  verdict: 'pass' | 'flag' | 'block'
  items: ItineraryCityItem[]
}

// ─────────────────────────────────────────────────────────────────────────
// 闸 · 行程城市核验
// ─────────────────────────────────────────────────────────────────────────

/**
 * 逐段核「这段文字里声明的城市/景点」是否都在该团授权城市清单里。
 *
 * @param segmentTexts 逐段上屏文字（或 caption/angle 合并）
 * @param authorizedCities 该团 tour_cities（授权城市清单）
 * @param gazetteer 行业地名表（别名 + 地标归城）
 */
export function verifyItineraryCities(
  segmentTexts: readonly string[],
  authorizedCities: readonly string[],
  gazetteer: PlaceGazetteer,
): ItineraryCityResult {
  const authorizedSet = new Set<string>()
  for (const c of authorizedCities) {
    const n = normalizePlace(c)
    if (n) authorizedSet.add(n)
  }
  const authorizedDisplay = Array.from(authorizedSet).join(', ')

  const items: ItineraryCityItem[] = []

  segmentTexts.forEach((text, segmentIndex) => {
    const hits = findPlaceHits(text, gazetteer)

    if (hits.length === 0) {
      items.push({
        segmentIndex,
        placeText: '',
        city: '',
        code: 'NO_PLACE_CLAIMED',
        reason: '这段没有地点声明',
      })
      return
    }

    for (const hit of hits) {
      const cities = hit.cities
      if (cities.length !== 1) {
        items.push({
          segmentIndex,
          placeText: hit.placeText,
          city: '',
          code: 'PLACE_UNMAPPED',
          reason: `"${hit.placeText}" 映到多个城市（${cities.join(' / ')}），无法唯一判定，交人审`,
        })
        continue
      }

      const city = cities[0]
      const cityNorm = normalizePlace(city)

      if (authorizedSet.size === 0) {
        items.push({
          segmentIndex,
          placeText: hit.placeText,
          city,
          code: 'NO_ITINERARY',
          reason: `"${hit.placeText}" 属 ${city}，但拿不到本团授权城市清单，交人审`,
        })
        continue
      }

      if (authorizedSet.has(cityNorm)) {
        items.push({
          segmentIndex,
          placeText: hit.placeText,
          city,
          code: 'CITY_ON_ITINERARY',
          reason: `"${hit.placeText}" 属 ${city}，在本团行程内`,
        })
      } else {
        items.push({
          segmentIndex,
          placeText: hit.placeText,
          city,
          code: 'CITY_OFF_ITINERARY',
          reason: `"${hit.placeText}" 属 ${city}，不在本团行程内（本团只有 ${authorizedDisplay}）`,
        })
      }
    }
  })

  let verdict: ItineraryCityResult['verdict'] = 'pass'
  if (items.some((i) => i.code === 'CITY_OFF_ITINERARY')) {
    verdict = 'block'
  } else if (items.some((i) => i.code === 'PLACE_UNMAPPED' || i.code === 'NO_ITINERARY')) {
    verdict = 'flag'
  }

  return { verdict, items }
}

interface PlaceHit {
  placeText: string
  cities: readonly string[]
}

/**
 * 在一段文字里找所有命中的地名。
 * - 英文词（无空格、无 CJK）：词边界 + 单复数归一匹配（挡 Chinatown⊃china）。
 * - 多词 / 中文：substring 包含匹配（中文无词边界）。
 * 同一地名只报一次（按 gazetteer 键去重）。
 */
function findPlaceHits(text: string, gazetteer: PlaceGazetteer): PlaceHit[] {
  const hits: PlaceHit[] = []
  if (!text.trim()) return hits

  const stripApos = (x: string) => x.toLowerCase().replace(/['’]/g, '')
  const enTokens = singularEnglishTokens(stripApos(text))
  const hayForSubstring = stripApos(text)

  for (const [rawKey, cities] of gazetteer) {
    const key = normalizePlace(rawKey)
    if (!key) continue

    const isMultiWordOrCjk = /\s/.test(key) || /[一-鿿]/.test(key)
    const matched = isMultiWordOrCjk
      ? hayForSubstring.includes(key)   // 中文/多词：无词边界，用 substring
      : enTokens.has(key)               // 英文单词：词边界，挡住 Chinatown⊃china

    if (matched) {
      hits.push({ placeText: rawKey, cities })
    }
  }

  return hits
}

// ─────────────────────────────────────────────────────────────────────────
// 起步地名表（L2 旅游行业参考，跨所有旅游客户共享，不写死某客户）
//
// 键一律用 normalizePlace 归一后的形式（小写、去撇号、折叠空白）。
// 值 = 城市名数组；多个 = 有歧义（PLACE_UNMAPPED）。
// 起步覆盖 CTS 在投团涉及的城市/地标，其余靠 FLAG + 人审增量补。
// ─────────────────────────────────────────────────────────────────────────

export const CTS_TRAVEL_GAZETTEER: PlaceGazetteer = new Map<string, readonly string[]>([
  // —— 北京 ——
  ['beijing', ['Beijing']],
  ['北京', ['Beijing']],
  ['great wall', ['Beijing']],
  ['长城', ['Beijing']],
  ['forbidden city', ['Beijing']],
  ['故宫', ['Beijing']],
  ['tiananmen', ['Beijing']],
  ['天安门', ['Beijing']],
  ['temple of heaven', ['Beijing']],
  ['天坛', ['Beijing']],

  // —— 西安 ——
  ['xian', ['Xi\'an']],
  ['西安', ['Xi\'an']],
  ['terracotta warriors', ['Xi\'an']],
  ['兵马俑', ['Xi\'an']],
  ['city wall', ['Xi\'an']],
  ['西安城墙', ['Xi\'an']],
  ['big wild goose pagoda', ['Xi\'an']],
  ['大雁塔', ['Xi\'an']],

  // —— 上海 ——
  ['shanghai', ['Shanghai']],
  ['上海', ['Shanghai']],
  ['the bund', ['Shanghai']],
  ['外滩', ['Shanghai']],
  ['oriental pearl', ['Shanghai']],
  ['东方明珠', ['Shanghai']],
  ['yu garden', ['Shanghai']],
  ['豫园', ['Shanghai']],
  ['nanjing road', ['Shanghai']],
  ['南京路', ['Shanghai']],

  // —— 苏州 ——
  ['suzhou', ['Suzhou']],
  ['苏州', ['Suzhou']],
  ['suzhou gardens', ['Suzhou']],
  ['苏州园林', ['Suzhou']],
  ['master of nets', ['Suzhou']],
  ['网师园', ['Suzhou']],
  ['humble administrator', ['Suzhou']],
  ['拙政园', ['Suzhou']],
  ['shantang', ['Suzhou']],
  ['山塘街', ['Suzhou']],

  // —— 无锡 ——
  ['wuxi', ['Wuxi']],
  ['无锡', ['Wuxi']],
  ['taihu', ['Wuxi']],
  ['太湖', ['Wuxi']],
  ['turtle head', ['Wuxi']],
  ['鼋头渚', ['Wuxi']],

  // —— 杭州 ——
  ['hangzhou', ['Hangzhou']],
  ['杭州', ['Hangzhou']],
  ['west lake', ['Hangzhou']],
  ['西湖', ['Hangzhou']],
  ['leifeng pagoda', ['Hangzhou']],
  ['雷峰塔', ['Hangzhou']],
  ['lingyin', ['Hangzhou']],
  ['灵隐寺', ['Hangzhou']],

  // —— 歧义示例（仅示意歧义项，用于 PLACE_UNMAPPED 测试）——
  ['china', ['Beijing', 'Shanghai']],
  ['中国', ['Beijing', 'Shanghai']],
])
