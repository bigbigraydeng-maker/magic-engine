// 按一句画面描述,从一批已分析素材里挑最匹配的几张。
//
// 抽出这份逻辑之前,`asset-library/search` 路由(人工选图界面)和 Creatomate
// 出片管线(scene-assets.ts,自动选图)各写一份的话,任何一处改排序规则都会
// 悄悄跟另一处岔开——两个调用方现在共用同一份判断(设计复审 ⚠️ 提出的要求)。
import { getOpenAIClient } from '@/lib/ai/openai-client'
import { canBackRealPrice, normaliseSource, type AssetSource } from '@/lib/assets/provenance'

export interface VisionMetadata {
  objects?: string[]
  scene?: string
  emotion?: string
  has_people?: boolean
  brand_elements?: string[]
  quality_score?: number
  ai_notes?: string
}

export interface RankableAsset {
  id: string
  storage_url: string | null
  original_filename: string | null
  /** 数据库读出来的原始形状,不假设一定符合 VisionMetadata(同 client-asset-pool.ts
   *  的教训:quality_score 是 jsonb 里的键,老数据/坏数据可能什么都没有)。 */
  vision_metadata: unknown
  source: unknown
}

export interface AssetPick {
  id: string
  storageUrl: string
  reason: string
  qualityScore: number
  metadata: VisionMetadata | null
  source: AssetSource
}

function visionOf(a: RankableAsset): VisionMetadata {
  return (a.vision_metadata ?? {}) as VisionMetadata
}

function scoreOf(a: RankableAsset): number {
  return visionOf(a).quality_score ?? 0
}

function toPick(a: RankableAsset, reason: string): AssetPick {
  return {
    id: a.id,
    storageUrl: a.storage_url ?? '',
    reason,
    qualityScore: scoreOf(a),
    metadata: a.vision_metadata ? visionOf(a) : null,
    source: normaliseSource(a.source),
  }
}

/**
 * 按 prompt 排序一批素材,返回 topN。
 *
 * `requireVerified: true` 时只保留能打真实价格的来源(`client_verified`/`fde_shot`,
 * 见 provenance.ts::canBackRealPrice)——出片自动选图管线必须开这个,不然免登录
 * 上传链接传进来的网图/AI 图会被自动当"客户真实照片"塞进无人审核的成片
 * (设计复审 ❌ 指出的红线风险)。人工选图界面(FDE 自己挑)不受此限,人能看见
 * 也能选未核实的图,所以那条调用路径保持 `requireVerified` 默认 false。
 *
 * `requireConfidentMatch: true` 时,挑出来的图跟 prompt 一个关键词都对不上也会被
 * 丢掉(丢完可能变成返回空数组)——2026-09-14 实测发现:素材库明明有标注清楚的
 * 故宫/兵马俑真实照片,LLM 排序还是选了完全文不对题的长城/梯田照片,且自己编的
 * reason 读起来像真的匹配上了,调用方无从分辨。出片自动选图管线必须开这个,
 * 选不准就该走回原有的 AI 现画兜底,而不是把猜错的图当"匹配成功"直接发布
 * (对应 CLAUDE.md 客户数据红线:对外画面配错等于内容跟文案对不上)。人工选图
 * 界面让人自己挑,"最接近的几张"本身有用,所以默认 false 不受此限。
 */
export async function rankAssetsByPrompt(
  prompt: string,
  assets: RankableAsset[],
  topN: number,
  opts: { requireVerified?: boolean; requireConfidentMatch?: boolean } = {},
): Promise<AssetPick[]> {
  const pool = opts.requireVerified
    ? assets.filter((a) => canBackRealPrice(a.source as string | null | undefined))
    : assets
  if (pool.length === 0) return []

  let picks: AssetPick[]
  // 素材少的时候不必烧一次 LLM 调用,全给,按质量分排。
  if (pool.length <= topN) {
    picks = pool
      .slice()
      .sort((a, b) => scoreOf(b) - scoreOf(a))
      .map((a) => toPick(a, 'Closest available library photo'))
  } else {
    try {
      picks = await rankWithLlm(prompt, pool, topN)
    } catch (err: unknown) {
      console.error('[rank-assets-by-prompt] LLM ranking failed, using fallback:', err)
      picks = keywordFallback(prompt, pool, topN)
    }
  }

  return opts.requireConfidentMatch ? picks.filter((p) => keywordOverlap(prompt, p) > 0) : picks
}

/** scene-plan.ts 生成的 imagePrompt 按铁律固定带 "no product/logo" 这类否定约束
 *  (绝不能出现客户真实产品/logo)。这些约束不保证总是逗号打头的独立分句——
 *  scene-plan.ts 只要求"不要描述产品/logo",没规定固定措辞,LLM 完全可能写成
 *  "palace courtyard with no product or logo" 这种否定词出现在分句中间的自然
 *  表述(2026-09-14 复审第三次指出:只查段首否定词的上一版会漏掉这种写法)。 */
const NEGATION_WORDS = new Set(['no', 'not', 'without', 'excluding', 'never'])

/** 按逗号/分号/句号分段,每段内逐词扫描——遇到否定词之前的词进 `positive`,遇到之后
 *  (包括同一段里否定词右边的所有词,直到这一段结束)全部转入 `negated`,不再要求
 *  否定词必须是段首("no product/logo" 和 "...with no product or logo" 都要能
 *  识别)。句号必须跟逗号/分号一样切段——Codex 复审指出:`planScenes` 可能返回
 *  "No product or logo. Palace courtyard at dusk." 这种多句 prompt,上一版只按
 *  逗号/分号分段,句号不会重置否定状态,"Palace"/"courtyard" 会被错误并入 negated,
 *  合法的宫殿素材因此被误判成"带着被禁内容"、不必要地走 AI 现画兜底。只按 ASCII
 *  字母数字切词,CTS 现有 imagePrompt 全英文,够用。哪天有客户的 imagePrompt/objects
 *  混进中文,纯中文段会被当分隔符整段吃掉,判成零重叠,`requireConfidentMatch`
 *  会把这类 prompt 的匹配全部清空,不是漏改,是已知边界。 */
function parsePromptWords(prompt: string): { positive: Set<string>; negated: Set<string> } {
  const positive = new Set<string>()
  const negated = new Set<string>()
  for (const segment of prompt.split(/[,;.]/)) {
    const rawWords = segment.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    let inNegatedScope = false
    for (const w of rawWords) {
      if (NEGATION_WORDS.has(w)) {
        inNegatedScope = true
        continue
      }
      if (w.length < 3) continue
      ;(inNegatedScope ? negated : positive).add(w)
    }
  }
  return { positive, negated }
}

function promptWordsOf(prompt: string): Set<string> {
  return parsePromptWords(prompt).positive
}

/** 太笼统的名词自己撑不起"文对图对"——比如 prompt 是 "Forbidden City courtyard",
 *  错误素材标了 "city skyline",光凭 city 就会被 `subjectOverlap` 判成重叠,让
 *  `requireConfidentMatch` 把文不对题的图当可信匹配继续放行(P1 复审指出)。这里把
 *  常见到跟任何画面都能扯上关系的词排除在重叠判定之外,只有地标/主体这类有区分度
 *  的词命中才算数。
 *
 *  第三轮复审补充:光靠具体名词不够,"sunset"/"ancient"/"traditional" 这类时间/氛围/
 *  年代描述词同样能挂在任何主体上("sunset at the Forbidden City" 跟错误素材
 *  "Great Wall at sunset" 共享 sunset,却不代表主体对得上)——这里一并排除常见的
 *  时段/光线/年代/风格类描述词。这份清单本质是黑名单,不可能穷尽;新发现漏网词
 *  就继续加,不必因此推翻黑名单这个机制。 */
const GENERIC_OBJECT_WORDS = new Set([
  'city', 'cities', 'town', 'towns', 'people', 'person', 'persons', 'man', 'men', 'woman', 'women',
  'child', 'children', 'kid', 'kids', 'building', 'buildings', 'photo', 'photos', 'picture', 'pictures',
  'image', 'images', 'background', 'scene', 'scenes', 'day', 'night', 'view', 'views', 'area', 'areas',
  'place', 'places', 'group', 'groups', 'shot', 'shots', 'outdoor', 'indoor', 'close', 'wide', 'street',
  'streets', 'road', 'roads', 'sky', 'skyline', 'water', 'tree', 'trees', 'car', 'cars', 'room', 'rooms',
  'house', 'houses', 'light', 'lights', 'color', 'colors', 'style', 'styles', 'type', 'types', 'set',
  'sets', 'landscape', 'landscapes', 'crowd', 'crowds', 'walking', 'standing', 'sitting', 'smiling',
  'sunset', 'sunsets', 'sunrise', 'sunrises', 'dusk', 'dawn', 'twilight', 'morning', 'evening',
  'afternoon', 'noon', 'midnight', 'ancient', 'historic', 'historical', 'traditional', 'modern',
  'contemporary', 'old', 'new', 'golden', 'scenic', 'iconic', 'famous', 'beautiful', 'stunning',
  'picturesque', 'aerial', 'panoramic', 'distant', 'nearby', 'foreground', 'sunny', 'cloudy', 'rainy',
  'sunlit', 'misty', 'foggy', 'calm', 'busy', 'quiet', 'peaceful', 'vibrant', 'colorful', 'colourful',
  'bright', 'dark', 'warm', 'cool',
])

/** 光排除笼统名词不够——"the Forbidden City courtyard" 跟错误素材 "the Great Wall"
 *  两边都有 "the",这个虚词不在名词清单里,原样会被判成重叠(P1 复审第二轮指出)。
 *  这里再排除一批英语功能词(冠词/介词/连词/代词等),它们不携带任何主体信息,
 *  命中它们不能算"文对图对"。 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'so', 'to', 'of', 'in', 'on', 'at', 'by', 'for',
  'with', 'from', 'into', 'onto', 'out', 'off', 'over', 'under', 'up', 'down', 'near', 'about',
  'is', 'was', 'were', 'are', 'be', 'been', 'being', 'as', 'this', 'that', 'these', 'those',
  'it', 'its', 'not', 'no', 'yes', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other',
  'some', 'such', 'only', 'own', 'same', 'too', 'very', 'just', 'also', 'still', 'while', 'during',
  'before', 'after', 'above', 'below', 'between', 'through', 'per', 'than', 'then', 'here', 'there',
])

/** vision_metadata.objects 理论上是 string[],但来自 unknown 的 jsonb 读入
 *  (`analyseImage()` 只查过字段存不存在,没查过它到底是不是数组),老数据/坏数据可能把
 *  整个字段存成字符串/对象而不是数组——这种情况下字段本身就不是数组,直接 `.reduce`
 *  会在拿到任何元素之前就抛出 TypeError,把整条自动选图链路炸掉(P2 复审指出:第二轮
 *  只挡了"数组里混进坏元素",没挡"这个字段压根不是数组")。这里先用 `Array.isArray`
 *  归一化,不是数组就当空数组处理。 */
function asObjectList(objects: unknown): string[] {
  return Array.isArray(objects) ? objects : []
}

/** prompt 分词与一组 object 短语的原始重叠数,不做通用词过滤——排序阶段(`keywordFallback`,
 *  含人工素材搜索的降级路径)哪怕命中的是 "city"/"people" 这类笼统词,也是比"完全不看
 *  关键词、只按质量分排"更有效的相关性信号(P2 复审指出:generic-word 过滤本该只用在
 *  置信度门,不该连累人工搜索排序,否则 "city skyline at night" 这类本就通用的 prompt
 *  会让所有候选 overlap 都是 0,退化成纯质量分排序)。置信度门请用 `subjectOverlap`。 */
function objectOverlap(promptWords: Set<string>, objects: string[]): number {
  return asObjectList(objects).reduce((n, obj) => {
    if (typeof obj !== 'string') return n
    const words = obj.toLowerCase().split(/[^a-z0-9]+/)
    return n + (words.some((w) => promptWords.has(w)) ? 1 : 0)
  }, 0)
}

/** 置信度门专用的重叠数——只认主体/地标级别的词命中,常见笼统名词/时段氛围描述词/
 *  英语虚词都不算数(见 `GENERIC_OBJECT_WORDS`/`STOPWORDS` 注释)。跟 `objectOverlap`
 *  分开是因为两者用途不同:这里要的是"文对图对"的强信号,排序打分要的是"多少有点关系"
 *  的弱信号,同一套过滤规则套两个用途会顾此失彼(P2 复审指出)。 */
function subjectOverlap(promptWords: Set<string>, objects: string[]): number {
  return asObjectList(objects).reduce((n, obj) => {
    if (typeof obj !== 'string') return n
    const words = obj.toLowerCase().split(/[^a-z0-9]+/)
    return n + (words.some((w) => !GENERIC_OBJECT_WORDS.has(w) && !STOPWORDS.has(w) && promptWords.has(w)) ? 1 : 0)
  }, 0)
}

/** prompt 明确要求"no product/logo"时,`vision-analyzer.ts` 只要列出了任何
 *  `brand_elements`(哪怕是"Nike swoosh"这种自然描述,没有字面出现"logo"/"product"
 *  这两个词),就该当成"带着被禁内容"——Codex 复审(P1)指出:下面 `containsNegatedContent`
 *  的字面词匹配找不到这种自然描述,会让真的带 logo 的素材凭一个不相关的正向词
 *  (比如 palace)混过置信度门。`brand_elements` 这个字段本身的存在就是
 *  "vision-analyzer 确实看到了可识别品牌元素"的信号,不需要它复述否定词原文。 */
const PRODUCT_OR_LOGO_WORDS = new Set(['logo', 'logos', 'product', 'products', 'brand', 'branding', 'branded'])

/** 素材的 objects/scene/brand_elements 里只要出现一个否定分句的词,直接判"带着
 *  被禁内容",不管别处有没有正向命中——2026-09-14 复审第二次指出:上一轮只堵了
 *  "否定词自己贡献正向重叠",没堵"素材本身确实带着被禁内容,却靠另一个正向词
 *  (比如 palace)照样通过置信度门"。可见 logo 由 `vision-analyzer.ts` 存进
 *  `brand_elements`,不保证也写进 `objects`,所以三个字段都要查,不能只查 objects。 */
function containsNegatedContent(negated: Set<string>, pick: AssetPick): boolean {
  if (negated.size === 0) return false
  const meta = pick.metadata
  const brandElements = asObjectList(meta?.brand_elements)
  // 语义类别兜底(见 PRODUCT_OR_LOGO_WORDS 注释):prompt 要求不出现产品/logo/品牌，
  // 只要这条素材本身被标了任何品牌元素，不管措辞是不是字面命中，一律当作带着被禁内容。
  if (brandElements.length > 0 && [...negated].some((w) => PRODUCT_OR_LOGO_WORDS.has(w))) {
    return true
  }
  // objects/brand_elements 理论上是 string[],但跟 asObjectList 同样的理由(见其注释):
  // 老数据/坏数据可能把整个字段存成非数组,直接展开(...)会在 typeof 防护跑到之前就抛出
  // TypeError,把整条自动选图链路炸掉——必须先用 asObjectList 归一化,不能只信类型声明
  // (2026-09-14 复审第三次指出:这里新写的展开路径漏了这道已有的防护)。
  const fields = [...asObjectList(meta?.objects), meta?.scene, ...brandElements]
  return fields.some((f) => {
    if (typeof f !== 'string') return false
    return f
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .some((w) => negated.has(w))
  })
}

/** prompt 与素材 objects 的主体/地标重叠数——挑图理由文字读着再确定,这个数字对不上就不算数。
 *  只看 `vision_metadata.objects`(最多 5 项"主要物体"),不看自由文本的 `ai_notes`——
 *  地标名字只写在 ai_notes 里、没挤进 objects 的图会被误判成零重叠,即使排序本来选对了。
 *  这是"宁可错杀不可放过"的保守选择,不是遗漏;objects 命中率不够再考虑纳入 ai_notes。 */
function keywordOverlap(prompt: string, pick: AssetPick): number {
  const { positive, negated } = parsePromptWords(prompt)
  if (containsNegatedContent(negated, pick)) return 0
  return subjectOverlap(positive, pick.metadata?.objects ?? [])
}

// 让 GPT-4o-mini 挑最匹配的几张。模型不可用/返回不可用结果时降级关键词重叠打分。
async function rankWithLlm(prompt: string, assets: RankableAsset[], topN: number): Promise<AssetPick[]> {
  const client = getOpenAIClient()
  const candidates = assets.map((a) => ({
    id: a.id,
    filename: a.original_filename,
    scene: visionOf(a).scene,
    emotion: visionOf(a).emotion,
    objects: visionOf(a).objects ?? [],
    ai_notes: visionOf(a).ai_notes,
    quality_score: scoreOf(a),
    brand_elements: visionOf(a).brand_elements ?? [],
  }))

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 500,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'Given an image generation prompt and a library of analyzed photos with structured metadata, ' +
          `return the top ${topN} most relevant photos for the prompt. ` +
          'Reply JSON only in the shape {"picks":[{"id":string,"reason":string}]}. ' +
          'Order picks best-first. reason is one short sentence on why the photo fits the prompt.',
      },
      { role: 'user', content: JSON.stringify({ image_prompt: prompt, candidates }) },
    ],
  })

  const raw = response.choices[0]?.message?.content ?? '{}'
  const parsed = JSON.parse(raw) as { picks?: Array<{ id?: string; reason?: string }> }
  const byId = new Map(assets.map((a) => [a.id, a]))

  const picks = (parsed.picks ?? [])
    .map((p) => {
      const asset = p.id ? byId.get(p.id) : undefined
      if (!asset) return null
      return toPick(asset, p.reason?.trim() || 'Recommended by Content Engine')
    })
    .filter((r): r is AssetPick => r !== null)
    .slice(0, topN)

  if (picks.length > 0) return picks
  return keywordFallback(prompt, assets, topN)
}

// 确定性兜底：按 prompt 与素材 objects 的名词重叠数排序，重叠数打平再按质量分。
function keywordFallback(prompt: string, assets: RankableAsset[], topN: number): AssetPick[] {
  const promptWords = promptWordsOf(prompt)

  return assets
    .map((a) => ({ asset: a, overlap: objectOverlap(promptWords, visionOf(a).objects ?? []) }))
    .sort((x, y) => y.overlap - x.overlap || scoreOf(y.asset) - scoreOf(x.asset))
    .slice(0, topN)
    .map(({ asset, overlap }) =>
      toPick(asset, overlap > 0 ? `Matches ${overlap} subject(s) in the prompt` : 'Best available library photo'),
    )
}
