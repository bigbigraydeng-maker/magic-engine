'use client'

/**
 * 一个人的全渠道往来记录。
 *
 * 看板上点开一个人时展示：他填过的表单、我们打过的每通电话、双方发过的每条
 * 私信（以后是邮件、外呼录音），按时间**从旧到新**合成一条线（最新在最下面）。
 * 顺序由接口给定，这里原样渲染 —— 聊天记录倒着排会把回答排在提问前面，读不通。
 *
 * 「以后会接更多沟通渠道进来」这件事在这里是**零改动**的：渲染按 `kind` 分派，
 * 触点只认 `channel` 字段取一个图标 —— 新渠道进来自动出现在同一条线上，
 * 认不出的渠道退回一个中性图标，不会漏掉也不会炸。
 *
 * 数据来自 GET /crm/contacts/[cid]/timeline（CRM 页面线建的读模型，直接复用）。
 */

import { useEffect, useRef, useState } from 'react'
import { CallAnalysisCard, type CallAnalysisData } from './CallAnalysisCard'
import {
  describeStageActor,
  isAutomatedActor,
  stageReasonForDisplay,
  STAGE_INFER_ACTOR,
} from '@/lib/crm/actors'

/**
 * 「谁改的」的显示名。系统自动打标写的是一个英文标记（审计要机器可读），
 * 中介看到的必须是人话 —— 而且必须看得出这一档不是同事标的。
 */
/**
 * 原来这里自己实现了一份翻译，只认 `AUTO_TAG_ACTOR`，其余一律 `raw.split('@')[0]`
 * —— 于是 `ai:conversation-read`（生产上 971 次，占了 96%）被**原样丢给销售看**。
 * 翻译现在只留一份，在 `lib/crm/actors.ts`，两个时间线渲染器共用。
 */

export interface TimelineEntry {
  kind: 'touch' | 'stage' | 'message'
  at: string
  // touch
  channel?: string | null
  direction?: 'inbound' | 'outbound'
  summary?: string | null
  /**
   * 销售真正敲进去的那句话 —— **跟 `summary` 不是一回事**，后者是 AI 摘要。
   * 只在判决行旁边展示，理由见 `VERDICT_ROW`。
   */
  raw?: string | null
  /**
   * `metadata.do_not_contact === true` —— **跟 `outcome` 不是一回事**。
   * 外呼那条路写的是 `outcome: 'not_interested'` 加上这个 true，
   * 而系统据这个 true 全渠道停联。只看 `outcome` 会漏掉整条外呼渠道。
   */
  dncFlag?: boolean
  /**
   * `raw` 里装的是逐字原话还是 AI 摘要。外呼那条路写的是模型生成的通话摘要，
   * 标成「原话」会让销售以为自己在看客人说的话。
   */
  rawKind?: 'verbatim' | 'ai_summary'
  tour?: string | null
  outcome?: string | null
  travelWindow?: string | null
  callbackAt?: string | null
  competitor?: string | null
  /** 这通电话的 AI 分析（只读展示 + 人工复核）。 */
  callAnalysis?: CallAnalysisData
  /** 刚拨出、还没整理成正式记录的电话。 */
  pendingCall?: 'ringing' | 'ended'
  // stage
  fromLabel?: string | null
  toLabel?: string | null
  changedBy?: string | null
  note?: string | null
  // message
  senderName?: string | null
  body?: string
}

/** AI 概况卡的数据。全部来自 conversation_briefs，**AI 生成、未经人工核实**。 */
export interface TimelineAiBrief {
  summary: string
  customerNeeds: string[]
  objections: string[]
  promisesMade: string[]
  nextAction: string | null
  intentLevel: string | null
  channel: string | null
  generatedAt: string | null
}

interface Payload {
  contact: { name: string; phone: string | null; email: string | null; stageLabel: string | null }
  timeline: TimelineEntry[]
  omittedMessages?: number
  /** 官网表单里「预计出发时间 / 每人预算」的一行人话；缺失 null（不显示）。 */
  formFactsLine?: string | null
  error?: string
}

/** 渠道 → 一眼能认的图标。认不出的新渠道给中性圆点，绝不空白。 */
const CHANNEL_ICON: Record<string, string> = {
  phone: '📞',
  meta_lead_form: '📝',
  web_form: '📝',
  messenger: '💬',
  email: '✉️',
  whatsapp: '💬',
}

const CHANNEL_NAME: Record<string, string> = {
  phone: '电话',
  meta_lead_form: 'Facebook 表单',
  web_form: '网站表单',
  messenger: '私信',
  email: '邮件',
  whatsapp: 'WhatsApp',
}

/**
 * 「系统给他上了闸」这一类判决 —— 必须一眼认出来，不能混在普通往来里。
 *
 * ## 为什么单独一档（PM 2026-08-17）
 *
 * 这两个结论跟别的结论**不是一回事**：其它结论只是记录「这次聊得怎么样」，
 * 这两个直接决定**还能不能联系这个人**。`do_not_contact` 一旦成立，
 * 电话、邮件、私信全停；解闸只能靠人明确说「判错了」。
 *
 * 而在这之前，它们在时间线上跟一条普通电话记录长得一模一样 —— 销售翻记录
 * 只看得到一句话，看不到「就是这一句让系统把他全渠道停了」。于是最该被复核的
 * 那一刻，恰恰是最看不见的。
 *
 * 🔴 **原话一定要留在旁边**：判断「是不是判错了」全靠原话（早前的词表把
 * 「我不打算去」当成过「别再联系」）。所以这里只给卡片加一条头和一道红边，
 * **不替换卡片内容**。
 *
 * 🔴 而且必须是 `raw`、不能是 `summary`（Codex 复审 PR #1038，2026-08-17）：
 * `summary` 是 **AI 生成的摘要**，「暂时不去」和「别再联系我」摘要之后可能
 * 长得一样 —— 判决却天差地别。拿摘要去复核一个全渠道封锁，等于没复核。
 */
const VERDICT_ROW: Record<string, { icon: string; text: string; tone: 'stop' | 'clear' }> = {
  do_not_contact: {
    icon: '🔒',
    // 说后果，不说结论名。销售要知道的是「所以现在怎么样」。
    text: '就是这一句让系统停了他 —— 从这天起电话 / 邮件 / 私信全都不再发给他',
    tone: 'stop',
  },
  dnc_cleared: {
    icon: '🔓',
    text: '有人判断上面那次是误判，把他放回了名单 —— 现在可以正常联系',
    tone: 'clear',
  },
}

/**
 * 其余结论 → 人话。
 *
 * 只挑**会影响销售下一步动作**的那几种；`spoke` / `unknown` 是兜底值
 * （任何没命中规则的备注都会落成 `spoke`），标出来只会变成满屏噪音。
 */
const OUTCOME_CHIP: Record<string, string> = {
  bad_number: '这个号打不通',
  no_answer: '打了没人接',
  missed_inbound: '他打来我们没接到',
  not_interested: '他说不买了',
  not_interested_now: '这次先不去',
}

/**
 * 记录一多就把这块框起来、并停在**最新**那一条。
 *
 * ## 为什么（CTS 销售视角，PM 2026-08-17）
 *
 * 这条线是**从旧到新**排的（聊天倒着排会把回答排在提问前面，读不通），
 * 但整个抽屉是一路往下滚的：点开一个熟客，看到的是他三个月前的第一条记录，
 * 要知道他上次说了什么得一路滚到底。微信、WhatsApp 打开都停在最新一句，
 * 我们停在最早一句 —— 每天每个销售白滚几十次。
 *
 * 记录少的时候不框：一屏就看完了，框起来反而多一层滚动条。
 */
const LONG_TIMELINE = 6

/**
 * 「他上次说了什么、想去哪、什么时候走」——给抽屉最上面那张摘要卡用。
 *
 * 这些字段**本来就在这条线里**，只是散在十几条记录的小标签里。销售开口前
 * 要的就是这三样，不该为了看它们把整条历史翻一遍。
 */
export type StageSource = 'human' | 'ai_conversation' | 'order_system'

export interface TimelineSummary {
  /** 最后一句有内容的话（客人说的或我们记的）。 */
  lastText: string | null
  lastWho: string | null
  lastAt: string | null
  /** 最新一次提到的团意向 / 出行时间 —— 越新的越算数。 */
  tour: string | null
  travelWindow: string | null
  /**
   * 「到哪一步了」是谁判的 —— 从最新一条阶段变更的 changedBy 推断。
   * null = 这个人没有任何阶段变更记录（例如导入时直接带了阶段）→ 抽屉不显示来源，不许瞎标「人工标的」。
   * 'order_system' 是给将来订单系统留的口子，今天没有任何代码会产生它。
   */
  stageSource: StageSource | null
  /** 官网表单里「预计出发时间 · 每人预算」一行人话；只是事实，不参与冷热/阶段判断。 */
  formFactsLine: string | null
}

/** changedBy → 来源。只认得出的才说；认不出的机器身份返回 null（宁可不显示，不许说错）。 */
export function stageSourceOf(changedBy: string | null | undefined): StageSource | null {
  if (!changedBy || !changedBy.trim()) return null
  const a = changedBy.trim().toLowerCase()
  if (a === STAGE_INFER_ACTOR) return 'ai_conversation'
  if (a === 'order-system' || a.startsWith('system:order')) return 'order_system'
  if (isAutomatedActor(a)) return null
  return a.includes('@') ? 'human' : null
}

/** 从整条线里提炼摘要。线是从旧到新的，所以后面的覆盖前面的。 */
function summarise(timeline: TimelineEntry[], formFactsLine: string | null = null): TimelineSummary | null {
  if (timeline.length === 0 && !formFactsLine) return null
  const s: TimelineSummary = {
    lastText: null,
    lastWho: null,
    lastAt: null,
    tour: null,
    travelWindow: null,
    stageSource: null,
    formFactsLine,
  }
  for (const e of timeline) {
    if (e.tour) s.tour = e.tour
    if (e.travelWindow) s.travelWindow = e.travelWindow
    if (e.kind === 'stage') s.stageSource = stageSourceOf(e.changedBy)
    const text = e.kind === 'message' ? e.body : e.kind === 'touch' ? e.summary : null
    if (text && text.trim()) {
      s.lastText = text.trim()
      s.lastWho = e.direction === 'inbound' ? (e.senderName || '客人') : '我们'
      s.lastAt = e.at
    }
  }
  return s.lastText || s.tour || s.travelWindow || s.stageSource || s.formFactsLine ? s : null
}

/**
 * 这条记录到底有没有给他上闸 —— **两个来源都要认**。
 *
 * 🔴 只看 `outcome === 'do_not_contact'` 会漏掉整条外呼渠道
 * （Codex 复审 PR #1048，2026-08-17）：`lib/voice/crm-bridge.ts` 写的是
 * `outcome: 'not_interested'` **加上** `metadata.do_not_contact: true`，
 * 而 `isDoNotContact` 认后者 —— 这个人是**全渠道被停**的。漏掉的话，
 * 销售看到的只有一句「他说不买了」，完全不知道系统已经把所有渠道关了。
 *
 * 判据只有一份（`lib/crm/dnc`），它两个都认，这里跟着它。
 * 「人纠正过判错了」优先 —— 那是对上一次判决的推翻，不是又一次上闸。
 */
function verdictOf(e: TimelineEntry): (typeof VERDICT_ROW)[string] | undefined {
  if (e.outcome === 'dnc_cleared') return VERDICT_ROW.dnc_cleared
  if (e.outcome === 'do_not_contact' || e.dncFlag) return VERDICT_ROW.do_not_contact
  return undefined
}

function when(iso: string): string {
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  const date = d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  if (days <= 0) return `今天 ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`
  if (days === 1) return '昨天'
  if (days < 30) return `${date}（${days} 天前）`
  return date
}

/**
 * 「他是从哪来的」—— 时间线**从旧到新**，所以第一条就是他第一次出现在我们面前。
 *
 * 单独提一行的理由（CTS 销售视角）：接手一个陌生人，第一个要判断的是「这人
 * 值不值得马上打」，而来源就是最强的那个信号 —— 填过表单的人跟一句
 * 「洗牙多少钱」进来的人，开场白根本不该一样。
 *
 * 🔴 **两道闸，缺一条就不说**（Codex 复审 PR #1038，2026-08-17）：
 *
 *   1. 必须是**客人来的**（`inbound`）。第一条是我们打出去的电话时，说明的是
 *      「我们怎么找到他的」，不是「他从哪来的」—— 初版会照样写「他是从电话来的」。
 *   2. 渠道必须**认得出**。原先把所有 `message` 硬编码成「私信」，
 *      而对话表里还有 email / whatsapp / voice。
 *
 * 认不出就整行不显示 —— 这一行的价值全在「可信」，说错还不如不说。
 */
function originOf(timeline: TimelineEntry[]): { name: string; at: string } | null {
  const first = timeline[0]
  if (!first || (first.kind !== 'touch' && first.kind !== 'message')) return null
  if (first.direction !== 'inbound') return null
  const name = CHANNEL_NAME[first.channel ?? '']
  return name ? { name, at: first.at } : null
}

/** 客人说的话 —— 白底靠左；我们说的 —— 灰底靠右缩进。一眼分得出谁在说。 */
function MessageRow({ e }: { e: TimelineEntry }) {
  const inbound = e.direction === 'inbound'
  return (
    <div className={inbound ? '' : 'pl-8'}>
      <div className={`rounded-xl px-3 py-2 ${inbound ? 'bg-white border border-me-charcoal/10' : 'bg-me-ivory'}`}>
        <p className="mb-0.5 text-[10px] font-bold text-me-charcoal/40">
          {inbound ? (e.senderName || '客人') : '我们'} · {when(e.at)}
        </p>
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-me-charcoal/85">{e.body}</p>
      </div>
    </div>
  )
}

function StageRow({ e }: { e: TimelineEntry }) {
  return (
    <div className="flex items-baseline gap-2 px-1 text-[11px] text-me-charcoal/45">
      <span>🔀</span>
      <span>
        {e.fromLabel ?? '还没标'} → <span className="font-bold text-me-charcoal/70">{e.toLabel}</span>
        {` · ${describeStageActor(e.changedBy)}`} · {when(e.at)}
      </span>
      {/*
        凭什么判的 —— 原来这一行把 note 整个丢掉了，而 AI 每一次判断都写了理由
        和客人原话（生产 971/971）。看不到凭据，销售就不会信这个判断。
        真人改的那 12 条没有 note，这里自然不显示。
      */}
      {stageReasonForDisplay(e.note) && (
        <span className="text-me-charcoal/40">· {stageReasonForDisplay(e.note)}</span>
      )}
    </div>
  )
}

/**
 * 判决那两块：原话 + 后果。
 *
 * 🔴 原话必须是 `raw` 不是 `summary`（后者是 AI 摘要）—— 复核一个全渠道封锁
 * 靠的是「暂时不去」和「别再联系我」的字面差别，摘要一压缩两句可能长得一样。
 * 摆在摘要**下面**：先读他说了什么，再看系统据此做了什么。
 */
function Verdict({ e }: { e: TimelineEntry }) {
  const verdict = verdictOf(e)
  if (!verdict) return null
  const stop = verdict.tone === 'stop'
  return (
    <>
      {e.raw && e.raw !== e.summary && (
        <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-me-charcoal/[0.04] px-2 py-1.5 text-[12px] leading-relaxed text-me-charcoal/70">
          {/* 🔴 外呼那条路的 raw 是**模型生成**的通话摘要，不是逐字原话 —— 标错了，
              销售会以为自己在看客人说的话，然后据此决定要不要解除全渠道停联。 */}
          {e.rawKind === 'ai_summary' ? '通话摘要（AI 整理，非逐字原话）：' : '原话：'}
          {e.raw}
        </p>
      )}
      <p
        className={`mt-1.5 rounded-lg px-2 py-1.5 text-[11px] font-bold leading-relaxed ${
          stop ? 'bg-[#C2453A]/8 text-[#C2453A]' : 'bg-me-ochre/12 text-me-ochre'
        }`}
      >
        {verdict.icon} {verdict.text}
      </p>
    </>
  )
}

function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {items.map((c) => (
        <span key={c} className="rounded-full bg-me-ochre/12 px-2 py-0.5 text-[10px] font-bold text-me-ochre">
          {c}
        </span>
      ))}
    </div>
  )
}

/** 触点：电话 / 表单 / 以后的任何新渠道。判决那一档在这里加边加话。 */
function TouchRow({ e, clientId }: { e: TimelineEntry; clientId: string }) {
  const icon = CHANNEL_ICON[e.channel ?? ''] ?? '•'
  const name = CHANNEL_NAME[e.channel ?? ''] ?? e.channel ?? '接触'
  const chips = [
    e.tour && `想去：${e.tour}`,
    e.travelWindow && `${e.travelWindow} 走`,
    e.competitor && `提到 ${e.competitor}`,
    e.callbackAt && '约了回电',
    e.outcome ? OUTCOME_CHIP[e.outcome] : null,
  ].filter(Boolean) as string[]

  const verdict = verdictOf(e)
  const stop = verdict?.tone === 'stop'

  if (e.pendingCall) {
    return (
      <div data-testid="pending-call" className="rounded-xl border border-dashed border-me-ochre/60 bg-me-ochre/[0.06] px-3 py-2">
        <p className="text-[10px] font-bold text-me-ochre">
          📞 电话 · 我们打出去的 · {when(e.at)} · {e.pendingCall === 'ringing' ? '通话中' : '已挂断，整理中'}
        </p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-me-charcoal/85">{e.summary}</p>
      </div>
    )
  }

  return (
    <div
      className={`rounded-xl border bg-white px-3 py-2 ${
        verdict
          ? `border-l-4 ${stop ? 'border-l-[#C2453A] border-[#C2453A]/25' : 'border-l-me-ochre border-me-ochre/30'}`
          : 'border-me-charcoal/10'
      }`}
    >
      <p className="text-[10px] font-bold text-me-charcoal/40">
        {icon} {name}
        {e.direction === 'inbound' ? ' · 客人来的' : ''} · {when(e.at)}
      </p>
      {e.summary && (
        <p className="mt-0.5 text-[13px] leading-relaxed text-me-charcoal/85">{e.summary}</p>
      )}
      <Verdict e={e} />
      <Chips items={chips} />
      {e.callAnalysis && <CallAnalysisCard clientId={clientId} analysis={e.callAnalysis} />}
    </div>
  )
}

function Row({ e, clientId }: { e: TimelineEntry; clientId: string }) {
  if (e.kind === 'message') return <MessageRow e={e} />
  if (e.kind === 'stage') return <StageRow e={e} />
  return <TouchRow e={e} clientId={clientId} />
}

/**
 * 拉时间线，并把摘要交给抽屉。
 *
 * 🔴 **旧请求的结果一律丢掉**（Codex 复审 PR #1038 第三轮，2026-08-17）。
 *
 * 抽屉刚打开、第一次 GET 还没回来时，销售可以立刻点「没打通」。写成功之后
 * 抽屉会换掉 `key` —— **整个组件被换掉，不是重新拉一次**。于是旧实例那次
 * 请求仍在路上，回来得晚的话，它会通过父级回调把**写入之前**的摘要盖回去：
 * 顶上那张卡说的是记这一笔之前的话，下面的记录却是新的。两边打架，
 * 而销售没有任何办法看出哪边是真的。
 *
 * 光在实例内部记一个「第几次请求」不够 —— 旧实例是**另一个实例**，
 * 它有自己的计数器。所以闸必须是「这个实例还活着吗」：卸载时置死，
 * 死了之后一律不碰任何状态、也不回调。
 *
 * 顺带 abort 掉在途请求（省一次白跑），但 abort 抛出的错**不能**当成加载失败 ——
 * 那会把摘要清成空，等于换个方式说假话。
 */
function useTimeline(
  clientId: string,
  contactId: string,
  onSummary?: (s: TimelineSummary | null) => void,
  dialedAt?: number | null,
) {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const alive = useRef(true)
  const [attempt, setAttempt] = useState(0)
  // 自动刷新那几次不要把列表换成「加载中…」，不然刚拨出的电话一闪一闪。
  const silent = useRef(false)
  const dataRef = useRef<Payload | null>(null)
  const hasPending = !!data?.timeline.some((e) => e.pendingCall)

  // 点了拨打之后：先等回调到达（头 90 秒一直刷），之后只要还有「整理中」的电话就继续刷（挂断约 2 分钟后变成正式记录）。
  useEffect(() => {
    if (!hasPending && !(dialedAt && Date.now() - dialedAt < 90_000)) return
    const t = setInterval(() => {
      const fresh = !!dialedAt && Date.now() - dialedAt < 90_000
      if (!hasPending && !fresh) return
      silent.current = true
      setAttempt((n) => n + 1)
    }, 8_000)
    return () => clearInterval(t)
  }, [hasPending, dialedAt])

  useEffect(() => {
    alive.current = true
    const ctrl = new AbortController()
    const run = async () => {
      if (!silent.current) setLoading(true)
      silent.current = false
      setErr(null)
      try {
        const res = await fetch(
          `/api/clients/${clientId}/crm/contacts/${contactId}/timeline`,
          { signal: ctrl.signal },
        )
        const json = (await res.json()) as Payload
        if (!res.ok) throw new Error(json.error ?? '加载失败')
        if (!alive.current) return
        dataRef.current = json
        setData(json)
        onSummary?.(summarise(json.timeline ?? [], json.formFactsLine ?? null))
      } catch (e) {
        // 被自己 abort 掉的不是失败，什么都别改 —— 改了就是替一个已经作废的
        // 请求说话，而它说的正好是旧的。
        if (!alive.current || (e instanceof Error && e.name === 'AbortError')) return
        // 自动刷新那次失败不打断已经显示的内容，下一轮再试。
        if (dataRef.current) return
        setErr(e instanceof Error ? e.message : '加载失败')
        // 拉失败时把摘要清掉 —— 顶上那张卡留着上一个人的话，比空着危险得多。
        onSummary?.(null)
      } finally {
        if (alive.current) setLoading(false)
      }
    }
    void run()
    return () => {
      alive.current = false
      ctrl.abort()
    }
  }, [clientId, contactId, onSummary, attempt])

  return { data, loading, err, retry: () => setAttempt((n) => n + 1) }
}

/**
 * 记录多的时候停在**最新**那一条。
 *
 * 用容器自己的 `scrollTop`，不用 `scrollIntoView` —— 后者会把**抽屉整体**
 * 一起滚下去，把上面的联系方式和摘要卡顶出屏幕，正好抵消这次改动的目的。
 */
function useStickToLatest(data: Payload | null) {
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = listRef.current
    if (!el || !data || data.timeline.length <= LONG_TIMELINE) return
    el.scrollTop = el.scrollHeight
  }, [data])
  return listRef
}

/** 加载中 / 出错 / 还没有记录 —— 三种「没内容可看」的样子。 */
function Placeholder({
  loading,
  err,
  onRetry,
}: {
  loading: boolean
  err: string | null
  onRetry: () => void
}) {
  if (loading) return <p className="py-6 text-center text-xs text-me-charcoal/40">加载往来记录…</p>
  if (err) {
    return (
      <div className="py-4 text-center">
        <p className="text-xs text-[#C2453A]">{err}</p>
        <button onClick={onRetry} className="mt-1 text-xs font-bold underline">重试</button>
      </div>
    )
  }
  return <p className="py-6 text-center text-xs text-me-charcoal/40">还没有往来记录。</p>
}

export function ContactTimeline({
  clientId,
  contactId,
  onSummary,
  dialedAt,
  collapsible = false,
}: {
  clientId: string
  contactId: string
  /** 员工刚点了拨打的时间（毫秒）；有它就自动刷新，直到这通电话变成正式记录。 */
  dialedAt?: number | null
  /**
   * 把摘要交给抽屉，让它渲染在**最上面**那张卡里。
   *
   * 为什么由这里算而不是抽屉再拉一次：同一份数据只该取一次，两次取意味着
   * 两处判据、以后必然走散。这里是唯一拉时间线的地方。
   */
  onSummary?: (s: TimelineSummary | null) => void
  /**
   * 可折叠：默认只显示「看完整往来原文（N 条）」一行，点开才铺原文。
   * CTS 员工日常看顶部 AI 概况就够，要查证再展开。无论折叠与否都照常拉数据、
   * 照常回传概况 —— 折叠只影响这段原文渲不渲染。
   */
  collapsible?: boolean
}) {
  const { data, loading, err, retry } = useTimeline(clientId, contactId, onSummary, dialedAt)
  const listRef = useStickToLatest(data)
  // 折叠模式下默认收起；换人（contactId 变）时重新收起，不把上一个人的展开状态带过来。
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    setExpanded(false)
  }, [contactId])

  if (loading || err || !data || data.timeline.length === 0) {
    return <Placeholder loading={loading} err={err} onRetry={retry} />
  }

  if (collapsible && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-me-charcoal/15 px-3 py-2 text-[13px] font-bold text-me-charcoal/70 hover:bg-me-ivory"
      >
        看完整往来原文（{data.timeline.length} 条）
        <span aria-hidden>▾</span>
      </button>
    )
  }

  const origin = originOf(data.timeline)
  const long = data.timeline.length > LONG_TIMELINE

  return (
    <div className="space-y-2.5">
      {/*
        🔴 来源这一行必须在滚动区**外面**（Codex 复审 PR #1038，2026-08-17）。
        它原先是滚动容器的第一个子元素，而下面那个 effect 会把容器直接滚到底 ——
        记录多的人一打开这行就被顶出可视区，而那批人恰恰最需要知道来源。
      */}
      {origin && (
        <p className="px-1 text-[11px] text-me-charcoal/45">
          👋 他是从<span className="font-bold text-me-charcoal/70">{origin.name}</span>来的 ·{' '}
          {when(origin.at)}
        </p>
      )}
      <div
        ref={listRef}
        data-testid="timeline-list"
        className={`space-y-2.5 ${long ? 'max-h-[52vh] overflow-y-auto pr-1' : ''}`}
      >
        {data.timeline.map((e, i) => (
          <Row key={i} e={e} clientId={clientId} />
        ))}
        {!!data.omittedMessages && (
          <p className="pt-1 text-center text-[10px] text-me-charcoal/30">
            另有 {data.omittedMessages} 条图片 / 表情，没有文字
          </p>
        )}
      </div>
    </div>
  )
}
