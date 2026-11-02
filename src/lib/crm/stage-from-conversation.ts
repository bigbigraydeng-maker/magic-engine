/**
 * 从**已经存在系统里**的往来内容里读出「这个人跟进到哪一步」。
 *
 * ## 为什么需要它（PM 2026-08-16 拍板「读」）
 *
 * CTS 583 个人里 **556 个的「跟进到哪步」是空的**。原因不是判得不准，是
 * **根本没读**：整套判断只看了 295 条电话记录，而库里还躺着
 *
 *   · 523 条邮件正文（`conversation_messages`，`mail-ingest` 早就同步进来了）
 *   · 2099 条 Messenger 私信原文
 *
 * 也就是说系统只看了约 10% 的对话，就去回答「这个人到哪一步了」。Sue Mason
 * 被归到「号码是坏的」而不是「跟进中」，根子在这 —— 我们和她的沟通全在邮件里，
 * 那 90% 没人看。
 *
 * 这里**不引入任何新数据**：不连客人的邮箱，不抓任何外部内容。读的全是我们
 * 自己的号收发的、两个月前就同步进来的东西。
 *
 * ## 三条不许破的线
 *
 * 1. **只填空的，绝不覆盖人**（同 `qualified-buyer-autotag` 的「绝不覆盖人工判断」）。
 *    销售手标过的阶段是这套系统里最硬的信号，模型不许动。所以候选人只从
 *    `stage IS NULL` 里挑 —— 结构上就没有覆盖的可能，不靠 prompt 自觉。
 *
 * 2. **说不出原话就不算数**（铁律 8：绝不凭空注入客户业务数据）。模型必须
 *    交回一句**逐字**来自对话的证据，我们回原文里核对；对不上就整条丢掉，
 *    宁可继续空着。空着只是没帮上忙，编一句「他说想订十月的团」是伤害客户。
 *
 * 3. **拒联/终结类阶段模型不许自己下**。「不感兴趣」在 CTS 的配置里是终结档
 *    （`is_terminal`），落进去这个人就从所有名单上消失。让模型从一段模棱两可的
 *    邮件里下这种判决，方向和 `lib/crm/dnc` 里说的一样是反的 —— 漏判只是多跟
 *    一次，误判是把一个还能成的客人永久埋掉。所以模型只允许落在**还会继续跟**
 *    的那几档，终结档一律不接（见 `SAFE_STAGES`）。
 *
 * 本文件只有判断，不碰数据库 —— 取数和落库在 `stage-infer.ts`。
 */

import { z } from 'zod'

/**
 * 允许模型落的阶段 —— **全是「还会继续跟」的档**。
 *
 * 对照 CTS 那 9 档（`20260728000001_leads_pipeline_stages.sql`）：
 *
 *   contacted      已联系      —— 聊上了，还在谈
 *   quoted         已报价      —— 我们给过价/行程了
 *   deferred       短期内不考虑 —— PM 说的第一种：暂时不感兴趣，还得继续营销
 *   no_response    无下文      —— 我们发过，对方一直没回
 *   traveling_soon 即将出行    —— 已经定了，进服务期
 *
 * **故意不给的**：
 *   not_interested 不感兴趣（终结）· deposit_paid 已付定金 · paid_full 已付全款
 *
 * 前者是上面第 3 条线；后两个牵扯钱 —— 一封写着「I'll transfer tomorrow」的邮件
 * 不等于钱到账了，那得看账不看话。
 *
 * PM 说的三种结局在这里的落点：
 *   「暂时不感兴趣、还需要继续营销」 → `deferred`
 *   「明确表达不感兴趣」             → **不给模型**，留给人或电话记录的判词
 *   「愿意了解更多、继续跟进」（最好的） → `contacted` / `quoted`
 */
export const SAFE_STAGES = ['contacted', 'quoted', 'deferred', 'no_response', 'traveling_soon'] as const

export type SafeStage = (typeof SAFE_STAGES)[number]

/**
 * 读不出来时的落点 —— **潜在客户池**（CTS 那 9 档里的「新线索」）。
 *
 * 🔴 这是 PM 2026-08-16 拍的，也是这套东西最重要的一条简化。
 *
 * 原先读不出来就**什么都不写**，于是这个人第二天、第三天……每天都被重新读一遍，
 * 每次都读不出来（对话太薄的人永远读不出来）。为了不重复烧钱，我一度打算加一列
 * 记「上次什么时候试过」—— PM 一句话点破：**读不出来本来就该进潜在客户池**，
 * 那才是他现在真实的位置。
 *
 * 这么一改，三个问题一起没了：
 *   · 不用记「试过没有」—— 他已经不在候选里了
 *   · 不用轮转候选窗口 —— 每读一个少一个，队列自己就往前走
 *   · 界面上也更诚实：「新线索」比一片空白说得清楚
 *
 * 安全性：`new` 是整条漏斗里**最不下结论**的一档 —— 不终结、不停止营销、
 * 照常跟进，而且只填在本来就空着的人身上。销售随时可以改。
 */
export const POOL_STAGE = 'new' as const

/** 真正会被写进档案的阶段：模型判出来的那几档，加上兜底的潜在客户池。 */
export type AppliedStage = SafeStage | typeof POOL_STAGE

/** 模型什么都读不出来时给的答案 —— 空着比猜一个强。 */
export const NO_VERDICT = 'unclear' as const

export const StageVerdictSchema = z.object({
  /** 落在哪一档，或者 `unclear`。 */
  stage: z.enum([...SAFE_STAGES, NO_VERDICT]),
  /**
   * **逐字**来自对话的一句证据（客人或我们说的都行）。
   *
   * 这不是给人看的说明文，是**给机器核对用的**：下面 `quoteIsGrounded()` 会
   * 回原文里找。找不到 = 这条判断是编的，整条丢掉。
   */
  evidence: z.string(),
  /** 一句中文，说给销售听：为什么是这一档。 */
  reason: z.string(),
})

export type StageVerdict = z.infer<typeof StageVerdictSchema>

export interface TranscriptLine {
  at: string
  /** 客人说的还是我们说的。 */
  direction: 'inbound' | 'outbound'
  /** 邮件正文 / 私信原文 / 销售手打的电话记录。 */
  body: string
  /** 'email' | 'messenger' | 'phone'… 原样带过去，模型据此知道这句话是怎么发生的。 */
  channel: string
  /** 写入方明确标了「机器发的」。缺省 = 不知道，不当成机器。 */
  automated?: boolean
}

/**
 * 一段对话最多喂这么多字符。
 *
 * 太长有两个害处：账单按 token 走；更要紧的是话痨客户的**最近**几句会被埋在
 * 中间。所以超长时**留最后那些**（下面 `renderTranscript` 从尾巴往回装）——
 * 「他现在到哪一步」这个问题，最近的话永远比两个月前的重要。
 */
const MAX_TRANSCRIPT_CHARS = 12_000

/** 单条消息截断长度 —— 一封带着整段签名和引用历史的邮件不该吃掉整个预算。 */
const MAX_LINE_CHARS = 1_200

const WHO: Record<string, string> = { inbound: 'CUSTOMER', outbound: 'CTS' }

/**
 * 把邮件 / 私信 / 电话记录拼成一段模型读得懂的对话。
 *
 * **从旧到新排，但超长时砍掉最老的** —— 顺序对了模型才看得出「先犹豫、后来
 * 又问了价格」这种转折；砍尾巴则会把最新状态砍掉，正好砍掉我们要的那个答案。
 */
export function renderTranscript(lines: TranscriptLine[]): string {
  const ordered = [...lines]
    .filter((l) => l.body.trim().length > 0)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  const rendered = ordered.map((l) => {
    const body = l.body.trim().slice(0, MAX_LINE_CHARS)
    return `[${l.at.slice(0, 10)}] ${WHO[l.direction] ?? l.direction} (${l.channel}): ${body}`
  })

  const kept: string[] = []
  let size = 0
  for (let i = rendered.length - 1; i >= 0; i--) {
    const next = size + rendered[i].length + 1
    if (next > MAX_TRANSCRIPT_CHARS && kept.length > 0) break
    kept.unshift(rendered[i])
    size = next
  }
  return kept.join('\n')
}

/** 核对证据用的归一化：大小写、空白、引号的差异不算「编的」。 */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 模型交回的那句证据，**真的在对话里吗**。
 *
 * 🔴 这是铁律 8 在代码里的样子。模型说「他说想订十月的团」很好听，但只要这句
 * 话不在原文里，它就是编的 —— 而销售会照着它去打电话。核对不过就整条丢掉。
 *
 * 太短的证据一律不认：一个「ok」在任何一段对话里都找得到，等于没核对。
 */
export function quoteIsGrounded(evidence: string, transcript: string): boolean {
  const q = normalise(evidence)
  if (q.length < 8) return false
  return normalise(transcript).includes(q)
}

/**
 * 这条判断能不能用。
 *
 * @param verdict     模型给的
 * @param transcript  喂给它的原文
 * @param configured  这个客户配置里**真的有**的阶段（`client_pipeline_stages`）
 *
 * 返回落哪一档，或者 null（= 继续空着）。四道闸，任何一道不过就 null：
 *   1. 模型自己说读不出来
 *   2. 落点不在「还会继续跟」的白名单里（终结档 / 涉及钱的档不接）
 *   3. 这个客户压根没配这一档 —— 写进去会变成界面上一个认不出的 stage_key
 *   4. 证据在原文里找不到 = 编的
 */
export function usableStage(
  verdict: StageVerdict,
  transcript: string,
  configured: ReadonlySet<string>,
): SafeStage | null {
  if (verdict.stage === NO_VERDICT) return null
  if (!(SAFE_STAGES as readonly string[]).includes(verdict.stage)) return null
  if (!configured.has(verdict.stage)) return null
  if (!quoteIsGrounded(verdict.evidence, transcript)) return null
  return verdict.stage
}

/**
 * 🔴 **填表不是「他回话了」**（Codex 复审 2026-08-16）。
 *
 * FB 客资表单和官网表单在触点表里也是 `inbound`（见
 * `scripts/import-cts-fb-leads.ts`）—— 那是他**留下线索的那一刻**，不是
 * 一次往来。把它当成回话，会让一整批「只填过表、我们追了几次、他一个字
 * 没说过」的人每小时都去花一次模型调用，而且永远落不进「无下文」。
 *
 * 表单内容仍然进对话（团意向、出行时间都在里面，模型该看见），
 * 只是不算「他说过话」。
 */
const FORM_CHANNELS: ReadonlySet<string> = new Set(['meta_lead_form', 'web_form'])

/**
 * 🔴 **表单的回声也不是「他回话了」**（2026-11-03，生产 CTS 实测）。
 *
 * Facebook 表单提交后，平台会在私信里生成一句「我填了表单，想了解更多」，它进的是
 * 私信通道、方向是入站 —— 上面按通道排除表单的规则拦不住它。结果 297 位只填过表的人
 * 被判成「已联系」，模型引用的「原话」就是这句系统生成的话。
 * 按句式认：这类话不是客人自己开口说的。
 */
const FORM_ECHO = /(?:filled (?:out|in) (?:your|the) form|would like to know more about your business)/i

function isFormLine(l: TranscriptLine): boolean {
  return FORM_CHANNELS.has(l.channel) || (l.direction === 'inbound' && FORM_ECHO.test(l.body))
}

/**
 * 我们发出的这一句，是不是机器自动回的。
 *
 * 判据与行业无关：私信里紧跟在客人那条消息之后两分钟内发出的，是自动回复（真人打字回不了这么快）。
 * 触点写入方明确标了 automated 的也算。
 */
const AUTO_REPLY_WINDOW_MS = 120_000

/**
 * 这段往来里有没有**真人**联系过他（电话 / 邮件 / 私信里人手发的）。
 *
 * 「已联系」「已报价」必须有这个；没有的话，模型读出来的只是「客人表达了兴趣」，
 * 不是「我们联系了他」（见 docs/specs/2026-09-27-crm-contacted-means-a-human-did-it.md）。
 * 库里查不到真人联系 ≠ 没人联系过（电话可能没入库），所以这里只拦「写入已联系」，
 * 他会落进潜在客户池，一旦有真人联系记录进来再重判。
 */
export function hasHumanOutbound(lines: TranscriptLine[]): boolean {
  const ordered = [...lines]
    .filter((l) => l.body.trim().length > 0)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  let lastInboundAt = Number.NEGATIVE_INFINITY
  for (const l of ordered) {
    const t = new Date(l.at).getTime()
    if (l.direction === 'inbound') {
      lastInboundAt = t
      continue
    }
    if (l.automated === true) continue
    // 只对私信通道按时间认自动回复：电话 / 邮件触点的时间戳可能就是导入线索的那一刻（表单跟进电话），不能按时间判。
    if (l.channel === 'message' && t - lastInboundAt <= AUTO_REPLY_WINDOW_MS) continue
    return true
  }
  return false
}

/**
 * 值不值得为这个人花一次模型调用。
 *
 * 只有我们单方面发过东西、对方一个字都没回过的，读了也读不出什么 ——
 * 那种情况交给下面 `ruleOnlyStage()` 判，不必花钱问模型。
 */
export function worthReading(lines: TranscriptLine[]): boolean {
  return lines.some(
    (l) => l.direction === 'inbound' && !isFormLine(l) && l.body.trim().length > 0,
  )
}

/**
 * 我们发过、对方多久没回，就算「无下文」。
 *
 * 两周：短于这个数会把「昨天刚发的邮件」写成无下文 —— 人家可能今天就回。
 */
const NO_RESPONSE_AFTER_MS = 14 * 86_400_000

/**
 * 不用问模型就定得下来的那一档。
 *
 * 🔴 **只判「无下文」这一种**（Codex 复审 2026-08-16）。原先这里只是 `continue`，
 * 于是注释里写着「规则自己就能定」的那一档**其实从来没有人写**：这些人永远
 * 停在空阶段、每小时被重新捞一遍，还占着候选窗口挡住后面的人。
 *
 * 判据窄到不可能出错：**一条入站都没有**（客人一个字没说过，没有任何可误读的
 * 语义）+ 我们确实发过 + 最后一次发出去已经过了两周。任何一条不成立就返回 null，
 * 继续空着。
 */
export function ruleOnlyStage(lines: TranscriptLine[], now: Date): 'no_response' | null {
  if (worthReading(lines)) return null

  const at = (l: TranscriptLine): number => {
    const t = new Date(l.at).getTime()
    return Number.isNaN(t) ? 0 : t
  }
  const latest = (pick: (l: TranscriptLine) => boolean): number =>
    Math.max(0, ...lines.filter((l) => pick(l) && l.body.trim().length > 0).map(at))

  const lastOutbound = latest((l) => l.direction === 'outbound')
  if (lastOutbound === 0) return null
  if (now.getTime() - lastOutbound < NO_RESPONSE_AFTER_MS) return null

  /**
   * 🔴 **他又填了一次表 = 他又来了**（Codex 复审 2026-08-16）。
   *
   * 表单不算「回复我们的跟进」（上面 `FORM_CHANNELS` 那段），但一份**比我们
   * 最后一次联系还新**的表单是另一回事：这个人今天又主动留了一次资料。
   * 照旧写「无下文」，等于把一个刚刚举手的活客人标成没反应的。
   *
   * 这种情况不归规则管，交给模型去读那份表单里写了什么。
   */
  if (latest((l) => isFormLine(l)) > lastOutbound) return null

  return 'no_response'
}

export const STAGE_SYSTEM_PROMPT = `You read the full conversation between CTS Tours New Zealand and one prospective customer, then say which stage of the sales pipeline that person is at.

The conversation may mix email bodies, Facebook Messenger chat, and a salesperson's own note about a phone call. Lines marked CUSTOMER are the customer; lines marked CTS are us.

Answer with exactly one stage:
- "contacted" — we and the customer have actually talked; they are still engaged, asking questions, or open to hearing more.
- "quoted" — we have sent them a price, an itinerary, or a specific tour proposal.
- "deferred" — they are interested in principle but not now ("maybe next year", "after my surgery", "too early to book"). They still want to hear from us later.
- "no_response" — we reached out one or more times and they never replied.
- "traveling_soon" — they are booked and about to travel, or already travelling.
- "unclear" — anything else, including a conversation too thin to judge.

Rules that matter more than being decisive:
- Prefer "unclear". Leaving the stage blank costs nothing; a wrong stage sends a salesperson down the wrong path.
- Never answer "not_interested" — it is not an option here. A customer who declines is handled elsewhere. If they sound negative but might still travel later, that is "deferred".
- A price WE quoted makes it "quoted". A price the customer mentioned paying to a competitor does not.
- An automated reply, out-of-office, or delivery notice is not the customer talking.

evidence: copy ONE sentence VERBATIM from the conversation that shows the stage. Copy it character for character — it is checked against the transcript and the whole answer is discarded if it does not match. Never paraphrase, translate, or shorten it.

reason: one short sentence in SIMPLIFIED CHINESE explaining the call to a CTS salesperson.`
