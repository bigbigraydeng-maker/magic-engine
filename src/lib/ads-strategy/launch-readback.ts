/**
 * 建完广告，强制回读一遍 —— 把「买家实际会看到的每一句话」摊开，并撞一遍已知的坑。
 *
 * 为什么是「回读」而不是「上线前打勾」（PM 2026-08-04 第 5 问选丙）：
 *
 *   魏征原话：「一个『我确认检查过了』的勾选项，跟当时那个『我以为四个字段都
 *   填进去了』是同一种东西。」库里那条 `meta-automation-editor-verify-each-
 *   field-not-end-of-flow`，本身就是 agent 跳过逐步验证学来的。
 *
 *   而且创建接口的回显**不含 Meta 自己补上的东西**：
 *     - 受众放宽（targeting_relaxation / advantage_audience）是 Meta 自动开的
 *     - 隐式 Lookalike 是 Meta 自动挂的
 *     - 聊天模板的中文问候语是 Meta 自动生成、自动开启的
 *   传参时它们都不存在，回读时才现形。**只有回读能看见。**
 *
 * 「慢半拍」不是问题：广告建出来默认暂停，回读发现问题就改，改完再开，钱一分没花。
 *
 * 纯函数。取数（调 Meta 读回真实落地的 targeting / creative / 聊天模板）在调用方，
 * 规则本身可单测、可变异测试。
 *
 * 每一条规则都来自 2026-08-04 当天的真实事故，不是想象出来的。
 */

export type Severity =
  /** 🔴 会伤到真买家或烧错钱 —— 不修不许开 */
  | 'blocker'
  /** ⚠️ 大概率不是本意，但不致命 */
  | 'warn'

export interface LaunchFinding {
  code: string
  severity: Severity
  /** 给人看的一句话，不带黑话。 */
  message: string
  /** 这条规则是哪次事故换来的 —— 让后来的人知道它不是洁癖。 */
  learnedFrom: string
}

/** 一条创意在买家眼里的样子。 */
export interface CreativeReadback {
  adId: string
  adName: string
  /** 正文 / 标题 / 问候语 / 建议回复按钮 —— 买家会读到的每一句。 */
  buyerFacingText: string[]
}

/** 从 Meta 回读到的、一个广告组的真实落地状态。 */
export interface AdSetReadback {
  adSetId: string
  adSetName: string
  /** 私信类目标（CONVERSATIONS / MESSAGING…）会触发问候语。 */
  optimizationGoal: string
  /**
   * 落点（MESSENGER / WHATSAPP / INSTAGRAM_DIRECT / WEBSITE / ON_AD…）。
   *
   * **不能只看 optimizationGoal**（2026-08-05 子牙复审）：一个广告组完全可以
   * 目标写 `LINK_CLICKS`、落点却是 MESSENGER —— 买家照样进私信、照样收到自动
   * 问候语，但按目标判会漏掉整组。缺失＝查不出来，按「不是私信」放行并另有一条
   * 提醒（见 `messaging_destination_unknown`）。
   */
  destinationType?: string
  /** 回读到的 targeting，不是创建时传的那份。 */
  targeting: {
    /** Meta 自动放宽：允许投给名单以外的人。 */
    customAudienceRelaxed?: boolean
    /** Meta 的「优势受众」，开着等于名单形同虚设。 */
    advantageAudience?: boolean
    /** 显式挂上的受众名单。 */
    customAudienceIds?: string[]
    /** Meta 自动补挂的隐式相似人群 —— 创建时传参里没有。 */
    implicitLookalikeIds?: string[]
    /** 投放地区名，用于跟房源所在地对照。 */
    geoNames?: string[]
  }
  creatives: CreativeReadback[]
}

export interface LaunchReadbackInput {
  adSet: AdSetReadback
  /** 广告组**声称**自己在做重定向（名字里有「暖池 / 重定向 / retarget」等）。 */
  claimsRetargeting?: boolean
  /** 房源/客户所在地区，用于对照投放地区。给不出就跳过这条检查。 */
  expectedGeo?: string | null
}

export interface LaunchReadbackReport {
  findings: LaunchFinding[]
  /** 有 blocker 就是 false —— 调用方据此决定开不开。 */
  safeToActivate: boolean
  /** 买家实际会看到的每一句话，原样打出来给人过目。 */
  buyerWillSee: { adName: string; lines: string[] }[]
}

const MESSAGING_GOALS = new Set([
  'CONVERSATIONS', 'MESSAGING_PURCHASE_CONVERSION', 'MEANINGFUL_CALL_ATTEMPT',
])

/** 落点本身就是私信 —— 跟目标无关，进了这些地方就会有自动问候语。 */
const MESSAGING_DESTINATIONS = new Set([
  'MESSENGER', 'WHATSAPP', 'INSTAGRAM_DIRECT', 'MESSAGING_APPS',
])

/**
 * 这个广告组会不会把买家带进私信。
 *
 * 目标和落点是**或**的关系，不是且：任一命中就按私信处理。漏判的代价是那次
 * 得罪 5 个买家的事故再来一遍，误判的代价只是多看一行提醒。
 */
function isMessagingAdSet(adSet: AdSetReadback): boolean {
  if (MESSAGING_GOALS.has(adSet.optimizationGoal.toUpperCase())) return true
  const d = adSet.destinationType
  return typeof d === 'string' && MESSAGING_DESTINATIONS.has(d.toUpperCase())
}

/**
 * 文字体系。**中文和韩文必须分开**——2026-08-04 魏征抽查发现的真 bug：
 * 原来把「CJK」当一个桶，于是同一个私信广告组里放中文创意 + 韩文创意
 * （`Ad F · 中文` 和 `Ad H · KR · 학군` 在库里真实存在）**完全不报警**，
 * 而韩国买家收到中文自动问候语，跟 Boris/Richard/Jude 是同一次事故。
 */
export type Script = 'han' | 'hangul' | 'kana' | 'latin'

const SCRIPT_RANGES: Readonly<Record<Script, RegExp>> = {
  han:    /[㐀-䶿一-鿿]/g,
  hangul: /[ᄀ-ᇿ㄰-㆏가-힯]/g,
  kana:   /[぀-ヿ]/g,
  latin:  /[A-Za-z]/g,
}

/**
 * 一条创意**整体**用的是什么文字，按字符数取多数。
 *
 * 为什么按整条而不是按行（这是原来那版的第二个 bug）：
 *   原版逐行判定、再把结果合并成集合，于是中文广告里夹一行
 *   `WhatsApp: +64 21 555 123` 或一行 `🔥🔥🔥`，那一行被判成 latin，
 *   整条创意就"变成了双语"，触发 blocker。而「中文文案带个电话号码」
 *   是日常写法 —— 噪音 blocker 的唯一结局是被人绕过。
 *
 * 没有任何文字字符（纯数字/纯 emoji/纯 URL）返回 null，不参与判定。
 */
/**
 * 字符权重。**不能按字符数直接比大小** —— 一个汉字承载的信息约等于一个英文单词
 * （4–5 个字母）。不加权的话「Rangitoto College 学区 全新四房独立屋」会被判成
 * 英文（拉丁 17 个字母 vs 汉字 9 个），而它显然是一条中文广告：看不懂中文的
 * 买家看到满屏汉字就划走了，专有名词是英文并不改变这一点。
 */
const SCRIPT_WEIGHT: Readonly<Record<Script, number>> = {
  han: 4, hangul: 4, kana: 4, latin: 1,
}

export function dominantScript(texts: readonly string[]): Script | null {
  const joined = texts.join(' ')
  let best: Script | null = null
  let bestScore = 0
  let anyChar = false
  for (const s of Object.keys(SCRIPT_RANGES) as Script[]) {
    const n = (joined.match(SCRIPT_RANGES[s]) ?? []).length
    if (n > 0) anyChar = true
    const score = n * SCRIPT_WEIGHT[s]
    if (score > bestScore) { bestScore = score; best = s }
  }
  return anyChar ? best : null
}

const SCRIPT_LABEL: Readonly<Record<Script, string>> = {
  han: '中文', hangul: '韩文', kana: '日文', latin: '英文',
}

/** 这个广告组里各条创意分别是什么文字（去掉判不出文字的）。 */
function scriptsInAdSet(creatives: CreativeReadback[]): Map<Script, string[]> {
  const out = new Map<Script, string[]>()
  for (const c of creatives) {
    const s = dominantScript(c.buyerFacingText)
    if (!s) continue
    out.set(s, [...(out.get(s) ?? []), c.adName])
  }
  return out
}

/**
 * 撞一遍已知的坑。纯函数 —— 传什么进来判什么，不猜、不查库。
 */
export function checkLaunch(input: LaunchReadbackInput): LaunchReadbackReport {
  const { adSet } = input
  const findings: LaunchFinding[] = []
  const t = adSet.targeting

  // ── 坑 1：私信广告里混着多种语言的创意 ────────────────────────────
  // Meta 的问候语照抄**该创意自身**的语言，不是可单独编辑的字段。所以同一个
  // 私信广告组里放中英两种创意 = 必然有一批人收到看不懂的问候语。
  // 这就是把「记得去查聊天模板」翻译成一条可计算的约束。
  if (isMessagingAdSet(adSet)) {
    const scripts = scriptsInAdSet(adSet.creatives)
    if (scripts.size > 1) {
      const detail = Array.from(scripts.entries())
        .map(([s, names]) => `${SCRIPT_LABEL[s]}（${names.join('、')}）`)
        .join(' + ')
      findings.push({
        code: 'mixed_script_messaging_adset',
        severity: 'blocker',
        message:
          `这个广告组是私信目标，但里面有 ${scripts.size} 种语言的创意：${detail}。` +
          'Meta 的问候语会照抄每条创意自己的语言 —— 看不懂那种语言的买家会收到看不懂的问候语。' +
          '要么按语言拆成多个广告组，要么统一语言。',
        learnedFrom: '2026-08-04 Roman：Boris「piss off」/ Richard「wtf」/ Jude「delete my contact」，一次得罪 5 人',
      })
    }
  } else if (adSet.destinationType === undefined && scriptsInAdSet(adSet.creatives).size > 1) {
    // 目标不是私信，落点又没回读到 —— 不能因此断定「不是私信」。
    // 只在真有多语言创意时才提醒：没有多语言就算是私信也不会出那次事故。
    findings.push({
      code: 'messaging_destination_unknown',
      severity: 'warn',
      message:
        '这个组里有多种语言的创意，但没拿到它的落点（是不是把人带进私信查不出来）。' +
        '如果落点是 Messenger / WhatsApp，买家会收到跟创意同语言的自动问候语。',
      learnedFrom: '2026-08-05 子牙复审：只看优化目标会漏掉「目标写点击、落点是私信」的组',
    })
  }

  // ── 坑 2：名字说重定向，设置却被放宽 ──────────────────────────────
  if (input.claimsRetargeting) {
    if (t.customAudienceRelaxed) {
      findings.push({
        code: 'retargeting_relaxed',
        severity: 'blocker',
        message: '这个组名字写着重定向，但「允许投给名单以外的人」是开着的 —— 它实际上想投给谁投给谁。',
        learnedFrom: '2026-08-04 Roman「私约看房·暖池重定向」花 $5.88 零结果，实测根本没在投暖池',
      })
    }
    if (t.advantageAudience) {
      findings.push({
        code: 'retargeting_advantage_audience',
        severity: 'blocker',
        message: '这个组名字写着重定向，但「优势受众」是开着的 —— Meta 会自行扩量，名单形同虚设。',
        learnedFrom: '2026-08-04 Roman 同一个广告组',
      })
    }
    if (!t.customAudienceIds || t.customAudienceIds.length === 0) {
      findings.push({
        code: 'retargeting_without_audience',
        severity: 'blocker',
        message: '这个组名字写着重定向，但根本没挂任何受众名单。',
        learnedFrom: '2026-08-04 巡检发现三条在跑的广告组一个名单都没挂',
      })
    }
    // 缺失 ≠ 关闭。Meta 不返回这两个字段时到底是什么行为，官方没写死；
    // 而它们恰好是「名字说重定向、实际投给谁都行」那次事故的开关。
    // 所以读不到就说读不到，不替它假设成安全。
    if (t.customAudienceRelaxed === undefined) {
      findings.push({
        code: 'retargeting_relaxation_unknown',
        severity: 'warn',
        message: '读不到「是否允许投给名单外的人」这项设置 —— 缺失不等于关闭，重定向组要人工确认一次。',
        learnedFrom: '2026-08-04：Meta 不返回该字段时行为未文档化，当成关闭是猜',
      })
    }
    if (t.advantageAudience === undefined) {
      findings.push({
        code: 'retargeting_advantage_unknown',
        severity: 'warn',
        message: '读不到「优势受众」这项设置 —— 缺失不等于关闭，重定向组要人工确认一次。',
        learnedFrom: '2026-08-04：同上',
      })
    }
  }

  // ── 坑 3：Meta 自动补挂了相似人群 ────────────────────────────────
  if (t.implicitLookalikeIds && t.implicitLookalikeIds.length > 0) {
    findings.push({
      code: 'implicit_lookalike_attached',
      severity: 'warn',
      message:
        `Meta 自动挂了 ${t.implicitLookalikeIds.length} 个「相似人群」，创建时传参里没有这个。` +
        '如果本意是只投既有名单，这会把冷人群混进来。',
      learnedFrom: '2026-08-04 Roman：创建接口回显不含它，回读才现形',
    })
  }

  // ── 坑 4：投放地区跟房源所在地对不上 ──────────────────────────────
  if (input.expectedGeo && t.geoNames && t.geoNames.length > 0) {
    const want = input.expectedGeo.toLowerCase()
    const hit = t.geoNames.some(g => g.toLowerCase().includes(want) || want.includes(g.toLowerCase()))
    if (!hit) {
      findings.push({
        code: 'geo_mismatch',
        severity: 'blocker',
        message: `投放地区是「${t.geoNames.join(' / ')}」，房源在「${input.expectedGeo}」—— 对不上。`,
        learnedFrom: '2026-08-04 Roman「IG 专投测试」把奥克兰北岸 $1.25M 的房投给了整个新西兰',
      })
    }
  }

  // ── 坑 5：私信广告没有任何买家可见文案 ───────────────────────────
  const emptyCreatives = adSet.creatives.filter(c => c.buyerFacingText.every(l => !l.trim()))
  if (emptyCreatives.length > 0) {
    findings.push({
      code: 'creative_without_buyer_text',
      severity: 'warn',
      message: `有 ${emptyCreatives.length} 条创意回读不到任何买家可见文字 —— 要么真的空，要么回读没取全，两种都得看一眼。`,
      learnedFrom: '2026-08-04：回读取不到的东西 ≠ 不存在，静默假设是最贵的假设',
    })
  }

  return {
    findings,
    safeToActivate: !findings.some(f => f.severity === 'blocker'),
    buyerWillSee: adSet.creatives.map(c => ({
      adName: c.adName,
      lines: c.buyerFacingText.filter(l => l.trim()),
    })),
  }
}

/**
 * 把报告渲染成一段可以直接贴给人看的文本。
 *
 * 刻意把「买家会看到什么」放在最前面 —— 今天那句中文问候语，只要有人**看见过
 * 它长什么样**就不会放它出去。所有规则加起来，都不如把原文摆出来管用。
 */
export function renderReadback(report: LaunchReadbackReport): string {
  const out: string[] = []

  out.push('【买家实际会看到的内容】')
  if (report.buyerWillSee.length === 0) {
    out.push('  （回读不到任何创意 —— 这本身就该停下来查）')
  }
  for (const c of report.buyerWillSee) {
    out.push(`  · ${c.adName}`)
    if (c.lines.length === 0) out.push('      （空）')
    for (const l of c.lines) out.push(`      ${l}`)
  }

  if (report.findings.length === 0) {
    out.push('', '【检查】没撞上已知的坑。')
    return out.join('\n')
  }

  out.push('', '【撞上的坑】')
  for (const f of report.findings) {
    out.push(`  ${f.severity === 'blocker' ? '🔴' : '⚠️'} ${f.message}`)
    out.push(`     （来自：${f.learnedFrom}）`)
  }
  out.push('', report.safeToActivate ? '结论：可以开，但上面的提醒看一眼。' : '结论：🔴 不要开，先修。')
  return out.join('\n')
}
