// 出片前的两道确定性质量闸 —— 都是纯函数（同输入永远同输出，无外部调用、无 vision 猜测）。
//
// 为什么不用视觉模型判断：face-frame.ts 已记录教训——让视觉模型判断图像内容，它是在猜，
// 同一张图两次给不同答案，已废弃。这两道闸只吃"图自带的文字信息"和"分镜描述"，确定性可测。
//
// 返回值带"判定 + 证据碎片 + 稳定 code"——注意它**不是完整 receipt**：缺 request_id /
// client_id / 时间戳等身份字段（纯函数不该编造这些）。接 Inngest 时，由 step 把这些结论
// 连同身份字段一起落成 receipt。`code` 是稳定机器码，供下游分支/告警，别去解析中文 reason。
//
// 落点（诚实声明）：这两道闸目前是纯逻辑 + 测试，**未接进 live 出片管线**。接线是下一步，
// 且有两个前置在 PR 里写死：① classifyRenderMode 的 real_pixel 需要先有"真实像素推进"渲染
// 分支才有处可送；② verifyPlaceProvenance 只能喂摄影师原始描述/alt，**绝不能喂检索词**
// （source_meta.query 就是 "Xian Bell Tower" 那种搜索词，喂进去等于自我拆台）。

// ─────────────────────────────────────────────────────────────────────────
// 共用：轻量英文分词 + 单复数归一（词边界匹配，避免 sign⊂design、shop⊂shopping 误伤）
// ─────────────────────────────────────────────────────────────────────────

/**
 * 英文按词切成小写 token，并为每个复数 token 补一个去尾 -s 的单数形
 * （billboards→billboard、menus→menu、warriors→warrior），词表用单数即可命中复数。
 * 只削 's' 且 token 长度 > 3，避免 is/as/us 之类被误削。
 */
function singularEnglishTokens(s: string): Set<string> {
  const set = new Set<string>()
  for (const t of s.toLowerCase().match(/[a-z]+/g) ?? []) {
    set.add(t)
    if (t.length > 3 && t.endsWith('s')) set.add(t.slice(0, -1))
  }
  return set
}

// ─────────────────────────────────────────────────────────────────────────
// 闸 1 · 地点来源核验
// ─────────────────────────────────────────────────────────────────────────

export type PlaceProvenanceCode = 'PLACE_NAMED' | 'PLACE_NOT_NAMED' | 'NO_METADATA'

export interface PlaceProvenanceResult {
  ok: boolean
  code: PlaceProvenanceCode
  matchedKeyword: string | null
  reason: string
}

/**
 * 一张图能不能打上某个地名大字，取决于**这张图自己的来源信息**（摄影师描述 / alt /
 * 拍摄地 / 标题）有没有指名这个地方——而不是"我用什么搜索词找到它"。
 *
 * 2026-09-04 事故：用 "Xian Bell Tower" 搜到一座临水的塔，摄影师只写 "a tall pagoda
 * illuminated at night"，根本不是西安；用 "christmas" 搜到爱丁堡圣诞市集。
 *
 * 匹配策略（复审后修正）：英文关键词按**词边界 token** 匹配，不用裸子串——否则
 * "Chinatown"（旧金山/悉尼/奥克兰唐人街）会被 `china` 子串误放行。撇号先归一
 * （xi'an→xian），让带撇号的地名也能命中。含空格或中文的关键词按 substring（中文无词边界）。
 *
 * ⚠️ 已知边界：同音多义（"fine china" 瓷器 vs China 中国）关键词匹配无法区分——
 * 所以调用方的地点关键词应尽量**具体到城市**（用 shanghai/xian 而非泛泛的 china）。
 *
 * @param sourceMetadata 图自带的描述 / alt / location / 标题合并文本（**禁喂检索词**）
 * @param requiredPlaceKeywords 该镜声称的地点关键词（如 ["xi'an","xian","shaanxi"]）
 */
export function verifyPlaceProvenance(
  sourceMetadata: string,
  requiredPlaceKeywords: readonly string[],
): PlaceProvenanceResult {
  if (!sourceMetadata.trim()) {
    return {
      ok: false,
      code: 'NO_METADATA',
      matchedKeyword: null,
      reason: '来源无任何文字信息，无法证明地点，不得打地名大字',
    }
  }

  const stripApos = (x: string) => x.toLowerCase().replace(/['’]/g, '')
  const enTokens = singularEnglishTokens(stripApos(sourceMetadata))
  const hayForSubstring = stripApos(sourceMetadata)

  for (const rawKw of requiredPlaceKeywords) {
    const norm = stripApos(rawKw.trim())
    if (!norm) continue
    const isMultiWordOrCjk = /\s/.test(norm) || /[一-鿿]/.test(norm)
    const hit = isMultiWordOrCjk
      ? hayForSubstring.includes(norm)      // 中文/多词：无词边界，用 substring
      : enTokens.has(norm)                  // 英文单词：词边界，挡住 Chinatown⊃china
    if (hit) {
      return {
        ok: true,
        code: 'PLACE_NAMED',
        matchedKeyword: rawKw,
        reason: `来源文字含 "${rawKw}"`,
      }
    }
  }

  return {
    ok: false,
    code: 'PLACE_NOT_NAMED',
    matchedKeyword: null,
    reason: `来源文字未提及 ${requiredPlaceKeywords.join(' / ')}，不得打此地名大字`,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 闸 2 · i2v 适用性（该图生视频，还是走真实像素推进）
// ─────────────────────────────────────────────────────────────────────────

export type RenderMode = 'i2v' | 'real_pixel'
export type RenderModeCode = 'TEXT_OR_FACE_RISK' | 'CLEAR'

export interface RenderModeDecision {
  mode: RenderMode
  code: RenderModeCode
  reason: string
  riskSignals: string[]
}

// i2v 逐帧重画，画面里的**可读文字**或**密集/清晰人脸**会被涂糊 / 改写成乱码。
// 2026-09-04 三次实测：兵马俑俑脸融团、西安街头真人和"小卖部"招牌糊掉、重庆"重庆你好"
// 楼体字糊掉。这类镜头改走真实像素推进（Ken Burns），一帧都不重画。
//
// 单词类信号用词边界 + 单复数归一匹配（billboards/menus/warriors 复数也命中；
// design⊄sign、shopping⊄shop 不误伤）。复审补齐了人物主体词——真人镜绝大多数不写
// "face/people"，而是写 woman/chef/family/monk…（漏了就重演糊脸）。
const RISK_WORD_SIGNALS: readonly string[] = [
  // —— 可读文字类（词表用单数，复数由归一命中）——
  'sign', 'signage', 'shopfront', 'storefront', 'billboard', 'poster',
  'banner', 'slogan', 'logo', 'label', 'menu', 'text', 'letter', 'lettering',
  'character', 'graffiti', 'mural', 'calligraphy', 'newspaper', 'neon',
  // —— 人物主体类（真人镜的真实写法，不止 face/people）——
  'face', 'facial', 'portrait', 'person', 'human', 'people', 'crowd',
  'pedestrian', 'tourist', 'man', 'woman', 'girl', 'boy', 'child', 'kid',
  'family', 'couple', 'selfie', 'chef', 'cook', 'waiter', 'waitress',
  'vendor', 'guide', 'driver', 'performer', 'dancer', 'singer', 'monk',
  'nun', 'priest', 'worker', 'farmer', 'fisherman', 'warrior',
]

// 短语类信号（多词，走 substring）。
const RISK_PHRASE_SIGNALS: readonly string[] = [
  'street food', 'street market', 'night market', 'shop front', 'store front',
  'neon sign', 'led screen', 'chinese characters', 'hand-written', 'reads ',
]

// 中文信号只用**多字词**（描述多为英文，中文是加成）。刻意不放单字——
// 复审实测单字 substring 大面积误伤：无人机→"人"、十字/数字/名字→"字"、表面→"面"。
const RISK_CJK_SIGNALS: readonly string[] = [
  '招牌', '标语', '菜单', '横幅', '海报', '霓虹', '文字', '书法',
  '人群', '游客', '行人', '人物', '摊位', '市集',
]

/**
 * 判断一个镜头该走 i2v 还是真实像素。偏保守：拿不准偏 real_pixel——
 * 真实像素最坏只是"少一点 AI 运动"，无害；i2v 碰上文字/人脸则必崩，有害。
 *
 * @param shotDescription 分镜的画面描述（生成镜的 imagePrompt，或选图的来源描述）
 */
export function classifyRenderMode(shotDescription: string): RenderModeDecision {
  const hay = shotDescription.toLowerCase()
  const tokenSet = singularEnglishTokens(shotDescription)

  const hits: string[] = []
  for (const w of RISK_WORD_SIGNALS) if (tokenSet.has(w)) hits.push(w)
  for (const p of RISK_PHRASE_SIGNALS) if (hay.includes(p)) hits.push(p.trim())
  for (const c of RISK_CJK_SIGNALS) if (shotDescription.includes(c)) hits.push(c)

  if (hits.length > 0) {
    return {
      mode: 'real_pixel',
      code: 'TEXT_OR_FACE_RISK',
      reason: 'i2v 会糊掉可读文字 / 人脸，改真实像素推进',
      riskSignals: Array.from(new Set(hits)),
    }
  }
  return {
    mode: 'i2v',
    code: 'CLEAR',
    reason: '无文字 / 人脸风险，可安全 i2v 加动',
    riskSignals: [],
  }
}
