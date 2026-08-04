/**
 * 一通电话在 CRM 里意味着什么。
 *
 * 跟邮件那边同一个分法（见 microsoft/mail-ingest 开头）：取数据的那一半跟
 * 判断的这一半分开。判断错了会安静地毁掉销售的名单，所以它必须能被单测
 * 一条条钉住，不能跟网络调用绑在一起。
 *
 * 这个文件里**没有一行依赖 3CX 的接口长什么样** —— 上游把话机记录翻译成
 * 下面这个 `CallRecord` 就行。电话这条线还卡在对方（要开分机、要等回话），
 * 但「电话进来之后系统怎么处理」不该跟着一起停在原地。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 六条判断，和它们各自在防什么
 * ─────────────────────────────────────────────────────────────────────────
 *
 * **① 内部通话整条丢。**
 * 同事之间打分机，跟客人没有半点关系。不丢的话，一个五人办公室每天互相
 * 打的十几通电话会全变成 CRM 里的触点，而且**会互相"建人"** ——
 * 这正是客户 8/4 反馈的那件事（「contact 里面怎么还有工作人员」）换个渠道
 * 重演一次。
 *
 * **② 号码认不出来就丢，绝不猜。**
 * 隐藏号码、总机内部号、读不出来的脏数据 —— 存一个错号码比不存更糟：
 * 将来销售照着它打过去，打给的是陌生人。跟 identity.normalisePhone 开头
 * 写的是同一条原则，这里直接复用它，不另起一套。
 *
 * **③ 未接来电是这整件事最值钱的一条，必须建人。**
 * 客人主动打进来、没人接 —— 这是「有人想订，而我们错过了」的直接证据，
 * 而它今天**在系统里完全不存在**。判据上等同于邮件那边的「客人自己开过口」
 * （mail-ingest 判断②），所以一视同仁：允许新建联系人。
 *
 * **④ 纯外呼不建人。**
 * 我们主动打给供应商、打给同行、打错号 —— 这些不配在 CRM 里变成一张
 * 「今天该联系谁」的卡。挂到**已经存在**的人身上，接不上就留白。
 * 跟邮件那边同一条护栏。
 *
 * **⑤ 没接通 / 秒挂的外呼，不算「有人跟过他」。**
 * 这是 automated-touch.ts 反复踩到的那个不对称：把「拨过号」算成「跟过了」，
 * 销售早上会看到一片灰卡、以为活做完了，而那些人一个电话都没接到。
 * 拨过去响了没人接 = 我们试过，不等于联系上了。三秒的接通同理
 * （拨错、对方接起就挂）—— 那不是一次对话。
 *
 * **⑥ 一通电话只算一次，哪怕它被转接过好几手。**
 * 客人打进来先到前台、再转给销售，话机那边会给出好几段。逐段记的话，
 * 一通电话会在时间线上变成三次联系，通话时长也会被重复计算。
 *
 * 通话记录本身**一条都不丢**（除了内部通话和号码不可用的）—— 丢掉的只是
 * 「要不要因为它在名单上多出一个人 / 少一张要跟的卡」。
 */

import { normalisePhone } from '@/lib/crm/identity'

/**
 * 一条已经翻译成我们自己说法的通话记录。
 *
 * 刻意不照抄 3CX 的字段名：接口版本一变，脏活只发生在翻译那一层，
 * 这里的判断和它的测试一行都不用动。
 */
export interface CallRecord {
  /** 话机那边的通话编号。**幂等键就是它** —— 同一通电话重复读回来不会重复记。 */
  id: string
  /** 通话开始时间（ISO）。 */
  startedAt: string
  direction: 'inbound' | 'outbound' | 'internal'
  /** 客人那一头的号码，原始格式（这里负责把它规整成 E.164）。 */
  counterpartyNumber: string | null
  /** 话机报的来电显示名，多半是空的。 */
  counterpartyName: string | null
  /** 我们这一头是哪个分机 —— 谁打的 / 谁接的。 */
  extension: string | null
  extensionName: string | null
  /** 真的接通了。 */
  answered: boolean
  /** 接通之后说了多久（秒）。没接通是 0。 */
  talkSeconds: number
  /**
   * 录音在话机那边的编号；没录音是 null。
   *
   * **只存编号，绝不存能直接打开的链接** —— 那是客人的通话内容，
   * 链接一旦落库就等于把它复制到了一个没人管权限的地方。要听的时候
   * 拿编号带着凭证去换。
   */
  recordingRef: string | null
}

/**
 * 接通多久以内不算一次对话。
 *
 * 拨错号、对方接起来就挂、语音信箱响一声 —— 这些在数据上跟一次真通话
 * 长得一模一样。10 秒是保守的：一次真的「你好，我想问一下行程」也说不完
 * 10 秒，所以卡在这里几乎不会误伤真对话，而它挡掉的那一类恰恰会让
 * 一张该跟的卡在早上变灰。
 */
export const TRIVIAL_TALK_SECONDS = 10

export interface PlannedCall {
  /** 幂等键。 */
  id: string
  occurredAt: string
  direction: 'inbound' | 'outbound'
  /** 已经规整成 E.164 的对方号码 —— 认人和回拨都靠它。 */
  phone: string
  name: string | null
  extension: string | null
  extensionName: string | null
  answered: boolean
  talkSeconds: number
  recordingRef: string | null
  /**
   * 这一笔算不算「有人真的联系上他了」（判断⑤）。
   *
   * 只对外呼有意义：来电本来就不是我们在跟进。
   */
  countsAsReached: boolean
  /**
   * 客人自己打进来过 —— 只有 true 才允许新建联系人（判断③④）。
   *
   * 放在每一通上而不是算在人头上：一个号码可能既有我们打出去的、
   * 也有他打进来的，只要有一通是他打进来的，这个人就该建。
   */
  customerInitiated: boolean
}

export interface DroppedCall {
  /** 分组用的说法，不是原始号码 —— 隐藏号码本来就没有号码可言。 */
  number: string
  why: string
  /** 因为这条理由丢掉了几通 —— 判错了能从这个数看出规模。 */
  calls: number
}

export interface CallPlan {
  calls: PlannedCall[]
  dropped: DroppedCall[]
}

/** 话机在「没有来电显示」时会塞进来的各种说法。 */
const WITHHELD = ['anonymous', 'withheld', 'private', 'restricted', 'unavailable', 'unknown']

/** 这通电话读不出一个能回拨的号码。 */
function withheldNumber(raw: string | null): boolean {
  const s = (raw ?? '').trim().toLowerCase()
  if (!s) return true
  return WITHHELD.some((w) => s.includes(w))
}

export interface PlanCallsOptions {
  /**
   * 本地号码按哪个国家补国码。CTS 在 NZ、Oztop 在 AU ——
   * 调用方按客户的市场传进来，这里不写死。
   */
  defaultCountry?: 'NZ' | 'AU'
}

/**
 * 把一批通话记录排成「该记哪些 + 丢了哪些」。
 *
 * 纯函数：同样的输入永远同样的输出，不碰数据库、不碰网络。
 */
export function planCallIngest(records: CallRecord[], opts: PlanCallsOptions = {}): CallPlan {
  const country = opts.defaultCountry ?? 'NZ'

  const dropped = new Map<string, DroppedCall>()
  const drop = (number: string, why: string) => {
    const cur = dropped.get(`${number}|${why}`)
    if (cur) cur.calls += 1
    else dropped.set(`${number}|${why}`, { number, why, calls: 1 })
  }

  // 从旧到新 —— 合并转接段时要按顺序取「第一段的开始时间」当这通电话的时间。
  const ordered = [...records].sort((a, b) => a.startedAt.localeCompare(b.startedAt))

  const merged = new Map<string, PlannedCall>()

  for (const r of ordered) {
    // 判断①：同事之间打分机。整条丢，连它可能带的录音一起。
    if (r.direction === 'internal') {
      drop('(内部分机)', '同事之间的内部通话')
      continue
    }

    // 判断②：没有一个能回拨的号码 —— 不猜。
    if (withheldNumber(r.counterpartyNumber)) {
      drop('(隐藏号码)', '来电没有号码，回拨不了')
      continue
    }
    const phone = normalisePhone(r.counterpartyNumber, country)
    if (!phone) {
      drop(r.counterpartyNumber!.trim(), '号码认不出来，存了会打给陌生人')
      continue
    }

    const trivial = !r.answered || r.talkSeconds < TRIVIAL_TALK_SECONDS

    const existing = merged.get(r.id)
    if (!existing) {
      merged.set(r.id, {
        id: r.id,
        occurredAt: r.startedAt,
        direction: r.direction,
        phone,
        name: r.counterpartyName?.trim() || null,
        extension: r.extension,
        extensionName: r.extensionName,
        answered: r.answered,
        talkSeconds: r.talkSeconds,
        recordingRef: r.recordingRef,
        // 判断⑤：来电不是我们在跟进，这个标记对它没有意义，固定 false。
        countsAsReached: r.direction === 'outbound' && !trivial,
        customerInitiated: r.direction === 'inbound',
      })
      continue
    }

    // 判断⑥：同一通电话的后续转接段。合，不新增一条。
    //
    // 通话时长要**加起来**：客人先跟前台说了 20 秒、又跟销售说了 5 分钟，
    // 这通电话就是 5 分 20 秒。取最大值会把前面那段白扔掉。
    existing.talkSeconds += r.talkSeconds
    // 任何一段接通了，这通电话就是接通了。
    existing.answered = existing.answered || r.answered
    // 谁真的接起来了，这通电话就算谁的 —— 前台转接时第一段挂在前台名下，
    // 记成前台跟进了等于把功劳和责任都记错人。
    if (r.answered && r.talkSeconds >= TRIVIAL_TALK_SECONDS) {
      existing.extension = r.extension
      existing.extensionName = r.extensionName
    }
    // 录音可能出现在任意一段上，先到的那个留着。
    existing.recordingRef = existing.recordingRef ?? r.recordingRef
    existing.name = existing.name ?? (r.counterpartyName?.trim() || null)
    // 合并后要按**合并后的总时长**重判，不能沿用第一段那次的结论：
    // 一通转接电话的第一段往往只有几秒（前台接起就转），照第一段判会把
    // 一次真的五分钟通话记成「没聊上」。
    existing.countsAsReached =
      existing.direction === 'outbound' &&
      existing.answered &&
      existing.talkSeconds >= TRIVIAL_TALK_SECONDS
  }

  return { calls: Array.from(merged.values()), dropped: Array.from(dropped.values()) }
}

/**
 * 这通电话在时间线上显示成什么。
 *
 * 销售扫一眼就要知道发生了什么，所以说人话、带上时长：
 * 「未接来电」和「通话 4 分 12 秒」是两件完全不同的事。
 */
export function describeCall(call: PlannedCall): string {
  if (call.direction === 'inbound') {
    return call.answered && call.talkSeconds >= TRIVIAL_TALK_SECONDS
      ? `来电，通话 ${formatDuration(call.talkSeconds)}`
      : '未接来电'
  }
  if (!call.answered) return '拨出，没人接'
  return call.talkSeconds < TRIVIAL_TALK_SECONDS
    ? '拨出，接通几秒就断了'
    : `拨出，通话 ${formatDuration(call.talkSeconds)}`
}

/** 秒数说成人话。 */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  const rest = s % 60
  return rest === 0 ? `${m} 分钟` : `${m} 分 ${rest} 秒`
}
