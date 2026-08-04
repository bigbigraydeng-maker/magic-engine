/**
 * 把读回来的邮件变成 CRM 里的人、对话和触点。
 *
 * mail-graph.ts 负责「把信取回来」，这里负责「这些信在 CRM 里意味着什么」。
 * 分成两半是因为后一半全是判断，而每一条判断错了都会安静地毁掉销售的名单 ——
 * 判断必须能被单测一条条钉住，不能跟网络调用绑在一起。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 四条判断，和它们各自在防什么
 * ─────────────────────────────────────────────────────────────────────────
 *
 * **① 一整条线程共用一个「对方」，由第一封定，不逐封重算。**
 * 一封信被转发给同事、或者客人换了个邮箱回，逐封重算会把同一串来回拆成两个人。
 * 线程的身份取「第一封客人来信的发件人」（没有来信才退回第一封出站的收件人）。
 *
 * **② 客人自己开过口，才建人。**
 * 跟 Messenger 那边同一条护栏（见 lib/messenger/link-contacts 的开头）：纯出站
 * 的线程 —— 我们主动发给供应商、发给同行、发一封询价 —— 不配在 CRM 里变成一张
 * 「今天该联系谁」的卡。这种线程照存、照挂到**已经存在**的人身上，但绝不新建。
 *
 * **③ 判成机器人的线程整条丢掉，连出站那几封一起。**
 * 只丢入站不丢出站，会留下一条挂着 `noreply@shopify.com` 的对话，而且因为它有
 * 出站消息，看起来像「我们跟他聊过」。要么整条不要，要么整条要。
 *
 * **④ 自动回复不算「有人跟过他」。**
 * 「Automatic reply / 我不在办公室」会躺在已发送里，长得跟一封真回信一模一样。
 * 不挡的话，一个刚发来询价的热线索会因为收到一封自动回执而在早上的看板上变灰
 * —— 这正是 8/2 已经修过一次的那个错（Mailchimp 群发把整页标成已跟进），换了
 * 一件衣服又来一次。这里把它标进 `metadata.automated`，读路径据此忽略。
 *
 * 信本身**一封都不丢**（除了判成机器人的整条线程）—— 邮箱是完整的。这里丢掉的
 * 只是「要不要因为它在名单上多出一个人 / 少一张要跟的卡」。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getValidTokenForConnection } from '@/lib/platform-oauth/token-manager'
import { fetchMailSince, type MailFolder, type MailMessage } from '@/lib/microsoft/mail-graph'
import { classifySender } from '@/lib/microsoft/mail-sender'
import { resolveContact } from '@/lib/crm/identity'

// ─── 计划（纯函数，不碰数据库） ──────────────────────────────────────────────

export interface PlannedMessage {
  /** Graph 的消息 id —— 幂等键就是它。 */
  id: string
  direction: 'inbound' | 'outbound'
  subject: string | null
  preview: string
  receivedAt: string
  /** 这封是自动回复（不算「有人跟过他」）。 */
  automated: boolean
}

export interface PlannedThread {
  /** conversations.conversation_id 用它。 */
  key: string
  subject: string | null
  /** 这条线程对面的那个人。整条线程共用一个，不逐封重算。 */
  counterparty: { address: string; name: string | null }
  messages: PlannedMessage[]
  /** 客人自己来过信 —— 只有 true 才允许新建联系人。 */
  hasInbound: boolean
  lastAt: string
  lastFrom: 'customer' | 'page'
}

export interface SkippedSender {
  address: string
  why: string
  /** 因为他被丢掉的邮件数 —— 判错了能从这个数看出规模。 */
  messages: number
}

export interface MailPlan {
  threads: PlannedThread[]
  skipped: SkippedSender[]
}

/**
 * 自动回复的主题前缀。
 *
 * 只看主题、只看开头，跟 mail-sender 里同一套保守做法：一封真回信的主题几乎
 * 不可能以这些词开头，而「包含」会把「Re: 关于 out of office 期间的行程」误伤。
 * 认不出来就当成真回信 —— 漏判一封自动回复只是让一张卡早一天变灰，
 * 误判一封真回信却会让销售以为自己没跟过、重复联系客人。
 */
const AUTO_REPLY_SUBJECTS = [
  'automatic reply',
  'auto reply',
  'auto-reply',
  'automatic response',
  'out of office',
  'out-of-office',
  'ooo:',
  'undeliverable',
  'delivery status notification',
  '自动回复',
  '自動回覆',
]

/** 这封出站邮件是机器发的自动回执，不是人写的回信。 */
export function isAutoReply(subject: string | null): boolean {
  const s = (subject ?? '').trim().toLowerCase()
  if (!s) return false
  // 去掉转发/回复前缀再判 —— 「Re: Automatic reply: …」仍然是自动回执。
  const stripped = s.replace(/^((re|fw|fwd|回复|轉寄)\s*:\s*)+/i, '')
  return AUTO_REPLY_SUBJECTS.some((p) => stripped.startsWith(p))
}

/**
 * 线程编号。Graph 一般会给 `conversationId`，给不出时退回「这封信自成一条线程」
 * —— 用 `mail:` 前缀跟 Messenger 的 `t_…` 彻底分开，两边共用同一张
 * conversations 表和同一个 (client_id, conversation_id) 唯一键。
 */
export function threadKey(m: MailMessage): string {
  return m.conversationId ? `mail:${m.conversationId}` : `mail-msg:${m.id}`
}

export interface PlanOptions {
  /** 客户自己的邮件域名 —— 同域来信是同事，不建人（见 mail-sender）。 */
  ownDomains: string[]
}

/**
 * 把一堆信排成「若干条线程 + 一份丢掉了谁的清单」。
 *
 * 纯函数：同样的输入永远同样的输出，不碰数据库、不碰网络。
 */
export function planMailIngest(messages: MailMessage[], opts: PlanOptions): MailPlan {
  // 从旧到新 —— 线程的身份由**第一封**定，顺序错了身份就错了。
  const ordered = [...messages].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))

  const threads = new Map<string, PlannedThread>()
  const skipped = new Map<string, SkippedSender>()
  /** 已经判成机器人的线程 —— 整条丢，连它的出站消息一起。 */
  const droppedThreads = new Map<string, string>()

  const drop = (address: string, why: string) => {
    const cur = skipped.get(address)
    if (cur) cur.messages += 1
    else skipped.set(address, { address, why, messages: 1 })
  }

  for (const m of ordered) {
    const key = threadKey(m)

    const alreadyDropped = droppedThreads.get(key)
    if (alreadyDropped) {
      drop(m.counterparty?.address ?? '(未知)', alreadyDropped)
      continue
    }

    if (!m.counterparty) {
      // 一封连对方是谁都读不出来的信。不猜 —— 猜错会把信挂到别人名下。
      drop('(读不出对方)', '这封信读不出对方是谁')
      continue
    }

    const existing = threads.get(key)
    if (!existing) {
      const verdict = classifySender({
        address: m.counterparty.address,
        ownDomains: opts.ownDomains,
      })
      if (verdict.kind === 'skip') {
        // 整条线程作废，后面同一条线程的信直接跟着丢（判断①③）。
        droppedThreads.set(key, verdict.why)
        drop(m.counterparty.address, verdict.why)
        continue
      }
      threads.set(key, {
        key,
        subject: m.subject,
        counterparty: m.counterparty,
        messages: [],
        hasInbound: false,
        lastAt: m.receivedAt,
        lastFrom: m.direction === 'inbound' ? 'customer' : 'page',
      })
    }

    const thread = threads.get(key)!
    thread.messages.push({
      id: m.id,
      direction: m.direction,
      subject: m.subject,
      preview: m.preview,
      receivedAt: m.receivedAt,
      // 只有出站才可能是自动回执；客人那边发来的自动回复不归我们管，
      // 而且把它标成 automated 会让一条真的来信从「他回话了」里消失。
      automated: m.direction === 'outbound' && isAutoReply(m.subject),
    })
    if (m.direction === 'inbound') thread.hasInbound = true
    // 主题以**最新一封**为准 —— 线程标题跟着最后一次来回走，跟邮箱里看到的一致。
    if (m.subject) thread.subject = m.subject
    thread.lastAt = m.receivedAt
    thread.lastFrom = m.direction === 'inbound' ? 'customer' : 'page'
  }

  return { threads: Array.from(threads.values()), skipped: Array.from(skipped.values()) }
}

// ─── 落库 ────────────────────────────────────────────────────────────────────

/**
 * 第一次同步往回捞多久。
 *
 * 30 天：够把「上个月发来询价、还没人回」的人捞回来，又不至于把三年的历史
 * 一次灌进看板（几千个早就没戏的人会把「今天该联系谁」直接淹掉）。
 */
const FIRST_RUN_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000

/**
 * 每次都往回多读 6 小时。
 *
 * 水位线不留重叠的话，一次失败的同步就会在时间线上留一个**永久**的洞 ——
 * 下一次从更新的时间开始读，中间那段永远读不到，而且不会报错。
 */
const WATERMARK_LOOKBACK_MS = 6 * 60 * 60 * 1000

/**
 * 要同步的**一个邮箱**，不是一个客户。
 *
 * 一个客户可以连不止一个邮箱（设置页上就有「再连一个邮箱」）。按客户同步会
 * 永远只读到最新连的那一个，较早连的那个一封信都读不到、而且不会报错 ——
 * 所以这里的单位是连接，不是客户。
 */
export interface MailboxTarget {
  clientId: string
  clientName: string | null
  /** clients.domain —— 判「同域来信是同事」用。 */
  domain: string | null
  /** platform_oauth_connections.id —— 令牌按这条连接取，不按「客户最新那条」。 */
  connectionId: string
  /** 这个邮箱的地址。同时是线程归属标记（写进 conversations.page_id）。 */
  mailbox: string
  /**
   * 设置页上填的「客户自己的邮件域名」（关联公司等）。
   *
   * 官网域名和收信域名覆盖不到关联公司 —— `pa@chinatravel.co.nz` 就是这么
   * 变成客人的。这份清单只有 FDE 知道，所以要能填、且在建人这一步就生效。
   */
  ownDomains?: string[]
}

export interface MailSyncResult {
  clientId: string
  clientName: string | null
  mailbox: string
  /** 这次从邮箱读回来几封。 */
  fetched: number
  /** 这次落了几条对话（含更新已有的）。 */
  threads: number
  /** 这次新存了几条消息。 */
  messages: number
  /** 这次新建了几个联系人 —— PM 真正会问的那个数。 */
  newContacts: number
  /** 这次写了几条触点。 */
  touchpoints: number
  /** 按发件人分组，这次丢掉了谁。 */
  skipped: SkippedSender[]
  /** 邮箱太忙，一次没读完 —— 如实说，别让人以为读全了。 */
  truncated: boolean
  /**
   * 有线程处理失败，这次**提前停了**，后面更新的线程一条都没落。
   *
   * 这是刻意的：水位线是「已存对话里最新那封信的时间」，如果跳过失败的线程
   * 继续处理更新的，下一次的水位线就会**永久越过**失败那条，那些人再也不会
   * 进 CRM，而 cron 还记这次成功。宁可这一轮少读一点，下一轮重来。
   */
  stoppedEarly?: string
  error?: string
}

/**
 * 这个**邮箱**已经读到哪儿了。没有记录就是第一次同步。
 *
 * 按邮箱算、不按客户算：一个客户连了两个邮箱时，忙的那个会把水位线一路推到
 * 今天，安静的那个再也读不到自己那些更早的信。归属靠 `page_id` ——
 * 私信那边它存的是「哪个 Facebook 主页收到的」，邮件这边存「哪个邮箱收到的」，
 * 是同一件事。
 */
async function getMailWatermark(clientId: string, mailbox: string): Promise<Date> {
  const { data } = await supabaseAdmin
    .from('conversations')
    .select('last_message_at')
    .eq('client_id', clientId)
    .eq('channel', 'email')
    .eq('page_id', mailbox)
    .not('last_message_at', 'is', null)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const newest = data?.last_message_at as string | undefined
  if (!newest) return new Date(Date.now() - FIRST_RUN_LOOKBACK_MS)
  return new Date(new Date(newest).getTime() - WATERMARK_LOOKBACK_MS)
}

/**
 * 客户自己的邮件域名。
 *
 * 三个来源都要：
 *   · 连进来的那个邮箱的域名（info@ctstours.co.nz → ctstours.co.nz）
 *   · clients.domain（官网域名可能跟收信域名不同，比如官网 .com、邮箱 .co.nz）
 *   · **设置页上填的那份清单**（`extra`）
 *
 * 第三条是 2026-08-04 补的，起因是 `pa@chinatravel.co.nz` —— CTS 的关联公司，
 * 员工却进了客人名单，客户当场反馈。前两条都覆盖不到关联公司的域名，
 * 而这种域名只有 FDE 知道，所以必须能填、且填了要在**这里**生效：
 * 只在归类那一侧认它的话，同事的邮件照样会建出一个新联系人来，
 * 只是建完之后被藏起来 —— 数据还是脏的。
 */
export function ownDomainsOf(
  mailbox: string | null,
  clientDomain: string | null,
  extra: readonly string[] = [],
): string[] {
  const out = new Set<string>()
  for (const d of extra) {
    const v = d.trim().toLowerCase()
    if (v) out.add(v)
  }
  const at = (mailbox ?? '').lastIndexOf('@')
  if (at > 0) out.add(mailbox!.slice(at + 1).trim().toLowerCase())
  const d = (clientDomain ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
  if (d) out.add(d)
  return Array.from(out).filter(Boolean)
}

/** 这个邮箱在系统里已经是谁了。找不到返回 null —— **绝不新建**。 */
async function findContactByEmail(clientId: string, email: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('contact_identities')
    .select('contact_id')
    .eq('client_id', clientId)
    .eq('kind', 'email')
    .eq('value', email)
    .maybeSingle()
  return (data?.contact_id as string | undefined) ?? null
}

interface StoredThread {
  conversationId: string
  contactId: string | null
  newMessages: number
}

/** 存一条邮件线程和它的信。抛异常一路上抛 —— 调用方要靠它决定停不停。 */
async function storeThread(
  clientId: string,
  mailbox: string,
  thread: PlannedThread,
): Promise<StoredThread> {
  const { data: row, error } = await supabaseAdmin
    .from('conversations')
    .upsert(
      {
        client_id: clientId,
        channel: 'email',
        // 「这条线程是从我们哪个信箱看到的」。私信那边这一列存 Facebook 主页 id，
        // 是同一个角色。水位线按它分邮箱算，不然两个邮箱会互相推。
        page_id: mailbox,
        conversation_id: thread.key,
        subject: thread.subject,
        participant_name: thread.counterparty.name,
        last_message_at: thread.lastAt,
        last_message_from: thread.lastFrom,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'client_id,conversation_id' },
    )
    // contact_id 要带回来：upsert 不会送它，所以已经挂上的人不会被覆盖，
    // 但下面要靠它判断「这条线程挂过人没有」。
    .select('id, contact_id')
    .single()

  if (error || !row) {
    throw new Error(`存邮件对话失败: ${error?.message}`)
  }

  const { data: inserted, error: msgErr } = await supabaseAdmin
    .from('conversation_messages')
    .upsert(
      thread.messages.map((m) => ({
        conversation_id: row.id,
        message_id: m.id,
        direction: m.direction,
        sender_name: m.direction === 'inbound' ? thread.counterparty.name : null,
        body: m.preview,
        sent_at: m.receivedAt,
      })),
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
    )
    .select('id')

  if (msgErr) {
    // 信没存下是可惜，但线程行已经在了、人还能接上 —— 不为此放弃整条线程。
    console.error('[mail-ingest] 存邮件正文失败:', msgErr)
  }

  // 消息数用**库里实际有多少条**，不能用这一批的条数。
  //
  // 第一次之后，每批只带水位线回看窗口里的几封 —— 拿它当总数，一条已经有十封
  // 来回的线程会在下一轮倒退成 2。列表上的计数会失真，而且靠「消息数变了没」
  // 判断要不要重出 AI 卡的逻辑会长期以为旧卡还是最新的。
  const { count } = await supabaseAdmin
    .from('conversation_messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', row.id)

  await supabaseAdmin
    .from('conversations')
    .update({ message_count: count ?? thread.messages.length })
    .eq('id', row.id)

  return {
    conversationId: row.id as string,
    contactId: (row.contact_id as string | null) ?? null,
    newMessages: inserted?.length ?? 0,
  }
}

/** 一封信 = 一条触点。幂等键是 Graph 的消息 id。 */
async function writeTouchpoints(
  clientId: string,
  contactId: string,
  thread: PlannedThread,
): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('contact_touchpoints')
    .upsert(
      thread.messages.map((m) => ({
        client_id: clientId,
        contact_id: contactId,
        channel: 'email',
        direction: m.direction,
        occurred_at: m.receivedAt,
        summary: m.subject ?? m.preview.slice(0, 120) ?? null,
        raw: m.preview,
        metadata: {
          subject: m.subject,
          counterparty: thread.counterparty.address,
          // 自动回执不算「有人跟过他」。读路径（今天该联系谁）据此忽略。
          automated: m.automated,
          // 邮件同步不知道是哪位同事按的发送 —— 留空，不假装。
          logged_by: null,
        },
        source: 'microsoft_mail',
        source_ref: m.id,
      })),
      { onConflict: 'client_id,source,source_ref', ignoreDuplicates: true },
    )
    .select('id')

  if (error) {
    throw new Error(`写邮件触点失败: ${error.message}`)
  }
  return data?.length ?? 0
}

/**
 * 同步**一个邮箱**。
 *
 * **永不抛异常** —— 一个邮箱挂掉不能让整个 cron 停下（别的客户的信照样要进来）。
 */
export async function syncMailbox(target: MailboxTarget): Promise<MailSyncResult> {
  const base: MailSyncResult = {
    clientId: target.clientId,
    clientName: target.clientName,
    mailbox: target.mailbox,
    fetched: 0,
    threads: 0,
    messages: 0,
    newContacts: 0,
    touchpoints: 0,
    skipped: [],
    truncated: false,
  }

  let token: string
  try {
    // 按**这条连接**取令牌，不是按「这个客户最新的那条」—— 客户连了两个邮箱时，
    // 后者永远只会拿到最新那个的令牌，较早那个一封信都读不到且不报错。
    token = await getValidTokenForConnection(target.connectionId)
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) }
  }

  const since = await getMailWatermark(target.clientId, target.mailbox)

  // 收件箱和已发送分开读 —— 方向由文件夹决定，不靠比对发件人猜（见 mail-graph）。
  const folders: MailFolder[] = ['inbox', 'sentitems']
  const all: MailMessage[] = []
  let truncated = false
  for (const folder of folders) {
    const res = await fetchMailSince(token, folder, since)
    if (!res.ok) {
      // 一个文件夹读失败就整次失败：只拿到一半（比如只有已发送）会让方向判断
      // 失衡 —— 线程看起来全是我们在说话，热线索被当成「已经跟过」。
      return {
        ...base,
        error: `读${folder === 'inbox' ? '收件箱' : '已发送'}失败: ${res.error}`,
      }
    }
    all.push(...res.messages)
    truncated = truncated || res.truncated
  }

  const plan = planMailIngest(all, {
    ownDomains: ownDomainsOf(target.mailbox, target.domain, target.ownDomains ?? []),
  })

  // **从旧到新处理**，配合下面「一条失败就停」。
  //
  // 水位线是「已存对话里最新那封信的时间」。跳过失败的线程继续处理更新的，
  // 下一次的水位线就会永久越过失败那条 —— 那几个人再也不会进 CRM，而 cron
  // 还把这次记成成功。宁可这一轮少读一点，下一轮从原地重来。
  const ordered = [...plan.threads].sort((a, b) => a.lastAt.localeCompare(b.lastAt))

  let messages = 0
  let newContacts = 0
  let touchpoints = 0
  let done = 0
  let stoppedEarly: string | undefined

  for (const thread of ordered) {
    try {
      const stored = await storeThread(target.clientId, target.mailbox, thread)
      messages += stored.newMessages

      let contactId = stored.contactId
      if (!contactId) {
        if (thread.hasInbound) {
          // 客人自己开过口 —— 认人，认不到就按邮箱新建（判断②）。
          // 只带**一个**身份，所以结构上不可能触发两个真人的不可逆合并。
          const res = await resolveContact({
            clientId: target.clientId,
            identities: [{ kind: 'email', value: thread.counterparty.address }],
            displayName: thread.counterparty.name,
            source: 'email',
            seenAt: thread.lastAt,
          })
          contactId = res.contactId
          if (res.created) newContacts += 1
        } else {
          // 纯出站线程：能接上已有的人就接，接不上就留白，绝不建人。
          contactId = await findContactByEmail(target.clientId, thread.counterparty.address)
        }

        if (contactId) {
          await supabaseAdmin
            .from('conversations')
            .update({ contact_id: contactId, updated_at: new Date().toISOString() })
            .eq('id', stored.conversationId)
            // 只补空，不抢别人已经挂好的人。
            .is('contact_id', null)
        }
      }

      if (contactId) {
        touchpoints += await writeTouchpoints(target.clientId, contactId, thread)
      }
      done += 1
    } catch (err) {
      // 停在这里。已经处理完的都落了库，水位线也就停在这条之前 ——
      // 下一轮会从这条重新读，不会留下一个永远补不回来的洞。
      stoppedEarly = `线程 ${thread.key} 失败：${err instanceof Error ? err.message : String(err)}`
      console.error('[mail-ingest]', stoppedEarly)
      break
    }
  }

  return {
    ...base,
    fetched: all.length,
    threads: done,
    messages,
    newContacts,
    touchpoints,
    skipped: plan.skipped,
    truncated,
    stoppedEarly,
  }
}
