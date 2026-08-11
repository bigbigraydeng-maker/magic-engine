/**
 * 一条经验能不能进公共池 —— 「学术不学案例」的机器版判据。
 *
 * PM 2026-08-04 拍板的原话：
 *   「什么好使共享出来我认为也合理，学『术』，方法，而不是去学具体的案例。」
 *
 * 翻成可执行的判据：
 *   **如果读的人能从这条经验反推出「某个具体客户花了多少钱、拿到多少结果」，
 *   就不能共享。抽象到「术」的层级 —— 没有客户名、没有金额、没有人名 —— 就可以。**
 *
 * 为什么非要有这道闸（当天实测，不是假想）：
 *   `global_learned_lessons` 全仓**零个写入方**，11 条全是 agent 手敲 SQL 塞进去的，
 *   零校验。其中 5 条含买家真名（David / Anita / Karen）、每 lead 成本（$6.35）、
 *   花费拆分（$86.57 / $14.74）、客户商业条款（$10,000 礼卡）。而 `format.ts:78`
 *   把 `rationale` **原样**拼进提示词：
 *       const why = l.rationale ? ` — why: ${l.rationale}` : ''
 *   狄仁杰复刻 Parkhomes（与 30 Kiteroa 互为竞争开发商）的取数条件，返回 10 条含
 *   上述 5 条。7/29 起至少 8 个客户跑过会读它的入口。
 *   → 违反当日 PM 批准的服务协议 §11.2（只保留 aggregated / non-personal）与 §11.3。
 *
 * ⚠️ 这道闸是**助手不是保证**。它抓得住金额、客户名、给定的人名；抓不住
 * 「用别的方式描述同一件事」。所以规矩是两层：
 *   1. 这个函数拦掉明显的
 *   2. 个案一律落 `evidence`（evidence 不进提示词），`lesson`/`rationale` 只写「为什么」
 * 第 2 层才是真正的契约，这个函数只是让人少犯懒。
 */

export type LeakKind =
  /** 金额 —— 最直接的「花了多少」 */
  | 'money'
  /** 客户名 / 项目名 */
  | 'client_name'
  /** 人名（买家、联系人） */
  | 'person_name'
  /** 「N 个咨询 / N 条留资」这类结果计数 */
  | 'outcome_count'

export interface LeakFinding {
  kind: LeakKind
  /** 命中的原文片段，方便直接定位改哪里。 */
  matched: string
  /** 人话：为什么它不能留在共享层。 */
  why: string
}

export interface ShareabilityVerdict {
  shareable: boolean
  findings: LeakFinding[]
  /** 给人看的一句话。 */
  summary: string
}

export interface ShareabilityContext {
  /** 全部客户名 / 项目名。调用方从 clients + client_projects 取。 */
  clientNames?: string[]
  /** 已知人名（买家、联系人）。调用方从 contacts 取。 */
  personNames?: string[]
}

/**
 * 金额。
 *
 * 2026-08-05 魏征抽查：原来那条只认「符号在前」（`$86.57`）和四个中文单位，
 * 实测 34 种写法漏 28 种 —— `86.57 NZD` / `NZD 86.57` / `86.57 dollars` /
 * 全角 `＄100` / `花了 86 块` / `1.2k spend` 全部放行。
 * 一道漏 82% 的闸比没有闸更危险：它让人以为查过了。
 *
 * 现在四条腿一起抓：符号（含全角）· 货币代码前后置 · 中英文单位后置 ·
 * 花钱动词 + 数字。宁可多拦。
 */
const CURRENCY_SYM = '(?:NZ\\$|AU\\$|US\\$|[$＄￥¥€£])'
const CURRENCY_CODE = '(?:NZD|AUD|USD|CNY|RMB|EUR|GBP)'
const NUM = '\\d[\\d,]*(?:\\.\\d+)?[kKmM万]?'
const MONEY = new RegExp(
  [
    `${CURRENCY_SYM}\\s?${NUM}`, // $86.57 / ＄100 / NZ$1,250
    `${NUM}\\s?${CURRENCY_CODE}`, // 86.57 NZD
    `${CURRENCY_CODE}\\s?${NUM}`, // NZD 86.57 / USD 50
    `${NUM}\\s?(?:元|块|角|美元|纽币|澳元|人民币|dollars?|bucks?)`, // 3000 元 / 86 块 / 50 dollars
    `[一二三四五六七八九十百千万]+\\s?(?:元|块|美元|纽币|澳元)`, // 八百元
    // 花钱动词紧跟数字：`spent 86.57` / `花了 86` / `预算 30` / `cost per lead 6.35`
    `(?:spent|spend|cost(?:s|ing)?|budget|paid|charged|花(?:了|费)?|花掉|预算|成本|单价|均价)\\s*(?:per\\s+\\w+\\s*)?${NUM}`,
    `${NUM}\\s*(?:\\/|per\\s*)\\s*(?:day|天|lead|conversion|条|个)`, // 30/天 · 6.35 per lead
    `${NUM}\\s*(?:spend|spent|budget|cost|花费|预算|成本)`, // 1.2k spend（动词在数字后面）
  ].join('|'),
  'gi',
)

/**
 * 结果计数 —— 「这个客户拿到了多少」。
 *
 * ── 为什么从「列举结果词」改成「默认可疑 + 白名单放行」──────────────────
 * 原来是一张结果词清单（咨询/留资/线索/lead…），于是 `13 inquiries`（美式拼写）、
 * `13 bookings`、`13 客资`、`13 单`、`13 个买家` 全部漏掉。清单永远补不齐，
 * 因为写经验的人不会照着清单挑词。
 *
 * 反过来做就稳了：**数字后面跟名词一律当结果计数，除非那个名词在白名单里**。
 * 白名单是「方法论量词」—— 秒/天/%/倍/版本/条规则这些，集合小而且稳定。
 *
 * 代价是会误伤一些方法论表述（比如「测 2 个钩子」）。这个方向的误差是能接受的：
 * 误拦一条经验的代价是重写一句话，漏掉一条的代价是客户数据每天注入 25 个客户
 * 的提示词。宁可多拦。
 */
const METHODOLOGY_UNITS = new Set([
  // 时间 / 比例 / 倍数
  'second', 'seconds', 'sec', 'secs', 's', 'minute', 'minutes', 'min', 'mins',
  'hour', 'hours', 'day', 'days', 'week', 'weeks', 'month', 'months', 'year', 'years',
  'percent', 'pt', 'pts', 'x', 'times',
  // 做法本身的量词
  'variant', 'variants', 'version', 'versions', 'ad', 'ads', 'creative', 'creatives',
  'placement', 'placements', 'pillar', 'pillars', 'step', 'steps', 'round', 'rounds',
  'option', 'options', 'language', 'languages', 'script', 'scripts', 'hook', 'hooks',
  'frame', 'frames', 'shot', 'shots', 'line', 'lines', 'word', 'words', 'rule', 'rules',
  // 技术规格 —— 2026-08-05 拿库里 11 条现役经验实测时误伤的那一类
  'px', 'pixels', 'fps', 'kb', 'mb', 'gb', 'ms', 'dpi', 'bit', 'bits', 'chars', 'characters',
])

/** 中文里跟着数字的方法论量词。其余中文量词（个/条/位/名/单/次）一律当结果。 */
const METHODOLOGY_CN =
  /^(?:秒|分钟|小时|天|周|月|年|倍|成|版|轮|步|页|字|行|帧|种语言|横屏|竖屏|像素|度|档|级|层|维)/

/** `13 inquiries` / `13 sign-ups` —— 数字 + 英文名词。 */
const EN_NUM_NOUN = /(\d[\d,]*)\s+([a-z][a-z-]*)/gi
/** 英文拼写数字 + 名词：`thirteen leads`。 */
const EN_WORD_NUM_NOUN =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|fifty|hundred)\s+([a-z][a-z-]*)/gi
/** `13 个买家` / `13 条` / `13 单` —— 数字 + 中文量词或名词。 */
const CN_NUM_NOUN = /(\d[\d,]*)\s*([一-鿿]{1,4})/g

function uniq(xs: string[]): string[] {
  return Array.from(new Set(xs))
}

function findMoney(text: string): LeakFinding[] {
  return uniq(text.match(MONEY) ?? []).map(m => ({
    kind: 'money' as const,
    matched: m,
    why: '金额会让人反推出这个客户花了多少 —— 挪进 evidence，正文只留「为什么」',
  }))
}

/**
 * 结果计数。金额已经被 `findMoney` 抓过的片段不再重复报 —— 同一处报两遍
 * 会让人以为有两个问题。
 */
function findOutcomeCounts(text: string, alreadyMoney: string[]): LeakFinding[] {
  const hits: string[] = []
  const coveredByMoney = (s: string) => alreadyMoney.some(m => m.includes(s) || s.includes(m))

  for (const re of [EN_NUM_NOUN, EN_WORD_NUM_NOUN]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const noun = m[2].toLowerCase()
      if (METHODOLOGY_UNITS.has(noun)) continue
      if (coveredByMoney(m[0])) continue
      hits.push(m[0].trim())
    }
  }

  CN_NUM_NOUN.lastIndex = 0
  let c: RegExpExecArray | null
  while ((c = CN_NUM_NOUN.exec(text)) !== null) {
    if (METHODOLOGY_CN.test(c[2])) continue
    if (coveredByMoney(c[0])) continue
    hits.push(c[0].trim())
  }

  return uniq(hits).map(m => ({
    kind: 'outcome_count' as const,
    matched: m,
    why: '数字跟着名词，读的人能反推出这个客户拿到多少 —— 挪进 evidence，正文只留「为什么」',
  }))
}

/**
 * 名字匹配用大小写不敏感的**整词/整串**包含。
 *
 * 刻意不做模糊匹配：客户名里常有 "Real Estate" "Tours" 这类通用词，模糊匹配会
 * 把正常的行业描述全判成泄露，最后没人愿意用这道闸。
 */
function findNames(text: string, names: string[], kind: 'client_name' | 'person_name', why: string): LeakFinding[] {
  const hay = text.toLowerCase()
  return uniq(
    names
      .map(n => n.trim())
      .filter(n => n.length >= 2 && hay.includes(n.toLowerCase())),
  ).map(matched => ({ kind, matched, why }))
}

/**
 * 判定一条经验能不能进跨客户共享层。
 *
 * `lesson` 和 `rationale` 一起看 —— 两个字段都会进提示词。
 */
export function checkShareable(
  lesson: string,
  rationale: string | null | undefined,
  ctx: ShareabilityContext = {},
): ShareabilityVerdict {
  const text = `${lesson}\n${rationale ?? ''}`

  const money = findMoney(text)
  const findings: LeakFinding[] = [
    ...money,
    ...findOutcomeCounts(text, money.map(f => f.matched)),
    ...findNames(text, ctx.clientNames ?? [], 'client_name',
      '客户名会把这条经验直接绑到某一家 —— 抽象成行业/场景描述'),
    ...findNames(text, ctx.personNames ?? [], 'person_name',
      '人名是个人信息，跨客户共享等于二次使用（服务协议 §11.3）'),
  ]

  return {
    shareable: findings.length === 0,
    findings,
    summary: findings.length === 0
      ? '可以进公共池：没有金额、客户名、人名或结果计数。'
      : `不能进公共池：命中 ${findings.length} 处（${uniq(findings.map(f => f.kind)).join(' / ')}）—— 个案挪进 evidence，正文只留「为什么」。`,
  }
}

/**
 * 写入前的强制闸门。不通过就抛 —— 让「忘了脱敏」变成一次失败的写入，
 * 而不是一条静静躺在库里、每天注入 25 个客户提示词的经验。
 *
 * 用法：任何往 `global_learned_lessons` 写的地方，第一行调它。
 */
export function assertShareable(
  lesson: string,
  rationale: string | null | undefined,
  ctx: ShareabilityContext = {},
): void {
  const v = checkShareable(lesson, rationale, ctx)
  if (v.shareable) return
  const detail = v.findings.map(f => `  · [${f.kind}] "${f.matched}" — ${f.why}`).join('\n')
  throw new Error(`拒绝写入公共经验池。\n${v.summary}\n${detail}`)
}
