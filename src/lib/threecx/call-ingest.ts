/**
 * 把判断好的通话落进 CRM —— 认人、写触点。
 *
 * 分层见 `call-plan.ts` 的头注释：那边决定「一通电话意味着什么」（纯判断，
 * 不碰数据库），这边只负责把结论写下去。**这个文件同样不依赖 3CX 怎么给数据**
 * —— 它收的是 `PlannedCall[]`，谁把电话记录翻译成那个形状都行。
 *
 * 所以取数层还卡在对方（要开分机、要配推送）的时候，这一层照样能先做完、
 * 先审完。等落地库一通，中间接上翻译就跑起来了。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 落库时的三条判断，和它们各自在防什么
 * ─────────────────────────────────────────────────────────────────────────
 *
 * **① 客人打进来才建人；纯外呼只挂到已有的人身上。**
 * 跟邮件那条线同一条护栏（`mail-ingest` 判断②）：我们主动打给供应商、
 * 打给同行、打错号 —— 这些不配在 CRM 里变成一张「今天该联系谁」的卡。
 * 未接来电则**必须**建人，那是「有人想订、我们错过了」的唯一证据。
 *
 * **② 没接通 / 秒挂的外呼，写成「不算有人跟过他」。**
 * 读路径（今天该联系谁）认的是 `metadata.automated` 这个标记。名字听起来
 * 像是「机器发的」，但 `lib/crm/automated-touch` 的头注释写得很清楚，它真正
 * 回答的问题是「**这一笔算不算有人跟过他**」—— 群发不算、自动回执不算，
 * 拨过去没人接同样不算：客人那头**什么都没收到**。
 *
 * 不这么标的话，销售早上会看到一片灰卡、以为活做完了，而那些人一个电话
 * 都没接到 —— 那正是这套系统在群发和自动回执上已经踩过两次的坑。
 *
 * **③ 录音只存编号，绝不存能直接打开的链接。**
 * 那是客人的通话内容。链接落库等于把它复制到一个没人管权限的地方，
 * 而且 3CX 那边只留 3 个月，存下来的链接过期之后还会变成一个骗人的按钮。
 *
 * 一通电话 = 一条触点，幂等键是话机那边的通话编号 —— 同一批重复读回来
 * 不会重复记。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { resolveContact } from '@/lib/crm/identity'
import { describeCall, TRIVIAL_TALK_SECONDS, type PlannedCall } from './call-plan'

/** 触点的 `source`，同时是幂等键的一半。 */
export const THREECX_SOURCE = 'threecx'

export interface CallStoreTarget {
  clientId: string
  clientName: string | null
}

export interface CallStoreResult {
  clientId: string
  clientName: string | null
  /** 这次一共处理了几通。 */
  calls: number
  /** 新建了几个联系人 —— PM 真正会问的那个数。 */
  newContacts: number
  /** 新写了几条触点（重复的不算）。 */
  touchpoints: number
  /** 打出去但接不上已有的人、也不允许建人 —— 这几通只能丢掉，如实报。 */
  unmatchedOutbound: number
  /**
   * 中途失败停下了，后面更新的一通都没落。
   *
   * 跟邮件那边同一个道理（`mail-ingest` 的 `stoppedEarly`）：水位线按已落库的
   * 最新一条算，跳过失败的继续处理更新的，下一轮的水位线就会**永久越过**
   * 失败那条，那几通电话再也不会进 CRM，而定时任务还记这次成功。
   */
  stoppedEarly?: string
  error?: string
}

/** 这个号码在系统里已经是谁了。找不到返回 null —— **绝不新建**。 */
async function findContactByPhone(clientId: string, phone: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('contact_identities')
    .select('contact_id')
    .eq('client_id', clientId)
    .eq('kind', 'phone')
    .eq('value', phone)
    .maybeSingle()
  return (data?.contact_id as string | undefined) ?? null
}

/**
 * 一通电话写成一条触点。
 *
 * 幂等键 `(client_id, source, source_ref)` —— `source_ref` 是话机的通话编号。
 * 重复读回来只会命中冲突、不会重复插。
 */
async function writeCallTouchpoint(
  clientId: string,
  contactId: string,
  call: PlannedCall,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('contact_touchpoints')
    .upsert(
      {
        client_id: clientId,
        contact_id: contactId,
        channel: 'phone',
        direction: call.direction,
        occurred_at: call.occurredAt,
        // 「未接来电」/「拨出，通话 4 分 12 秒」—— 销售扫一眼就知道发生了什么。
        summary: describeCall(call),
        raw: null,
        metadata: {
          // 见文件头判断②：这个标记回答的是「算不算有人跟过他」，
          // 不是「是不是机器发的」。拨过去没人接，客人那头什么都没收到。
          automated: !call.countsAsReached,
          answered: call.answered,
          talk_seconds: call.talkSeconds,
          /** 谁接的 / 谁打的。销售早上要分清「昨天是不是我跟的」。 */
          extension: call.extension,
          extension_name: call.extensionName,
          /**
           * 录音在话机那边的编号。**只存编号，不存链接**（见文件头判断③）。
           * 要听的时候拿它带凭证去换。
           */
          recording_ref: call.recordingRef,
          // 电话是话机自己记的，不知道是哪位同事按的键 —— 留空，不假装。
          // （`extension_name` 是话机给的分机名，跟登录邮箱不是一回事。）
          logged_by: null,
        },
        source: THREECX_SOURCE,
        source_ref: call.id,
      },
      { onConflict: 'client_id,source,source_ref', ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`写通话触点失败: ${error.message}`)
  // 命中幂等键时 upsert 什么都不返回 —— 那不是失败，是这通已经记过了。
  return data != null
}

/**
 * 把一批已经判断好的通话落库。
 *
 * **永不抛异常** —— 一个客户挂掉不能让整个定时任务停下（别的客户的电话
 * 照样要进来）。跟 `syncMailbox` 同一条约定。
 */
export async function storeCalls(
  target: CallStoreTarget,
  calls: PlannedCall[],
): Promise<CallStoreResult> {
  const base: CallStoreResult = {
    clientId: target.clientId,
    clientName: target.clientName,
    calls: 0,
    newContacts: 0,
    touchpoints: 0,
    unmatchedOutbound: 0,
  }

  // **从旧到新**，配合下面「一通失败就停」—— 理由见 `stoppedEarly` 的注释。
  const ordered = [...calls].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))

  let newContacts = 0
  let touchpoints = 0
  let unmatchedOutbound = 0
  let done = 0
  let stoppedEarly: string | undefined

  for (const call of ordered) {
    try {
      let contactId: string | null

      if (call.customerInitiated) {
        // 客人自己打进来了 —— 认人，认不到就按号码新建（判断①）。
        // 只带**一个**身份，所以结构上不可能触发两个真人的不可逆合并。
        const res = await resolveContact({
          clientId: target.clientId,
          identities: [{ kind: 'phone', value: call.phone }],
          displayName: call.name,
          source: 'phone',
          seenAt: call.occurredAt,
        })
        contactId = res.contactId
        if (res.created) newContacts += 1
      } else {
        // 纯外呼：能接上已有的人就接，接不上就丢掉，绝不建人。
        contactId = await findContactByPhone(target.clientId, call.phone)
        if (!contactId) {
          unmatchedOutbound += 1
          done += 1
          continue
        }
      }

      if (await writeCallTouchpoint(target.clientId, contactId, call)) {
        touchpoints += 1
      }
      done += 1
    } catch (err) {
      // 停在这里。已经处理完的都落了库，水位线也停在这通之前 ——
      // 下一轮从这通重新读，不会留下一个永远补不回来的洞。
      stoppedEarly = `通话 ${call.id} 失败：${err instanceof Error ? err.message : String(err)}`
      console.error('[call-ingest]', stoppedEarly)
      break
    }
  }

  return { ...base, calls: done, newContacts, touchpoints, unmatchedOutbound, stoppedEarly }
}

/**
 * 一批电话跑完之后，一句人话的小结。
 *
 * 给定时任务的运行记录用 —— 一串数字没人看得懂，而这一句话决定了
 * 出问题时有没有人发现。
 */
export function summariseCalls(r: CallStoreResult): string {
  if (r.error) return `没跑成：${r.error}`
  const bits = [`${r.calls} 通`]
  if (r.newContacts > 0) bits.push(`新客人 ${r.newContacts}`)
  if (r.touchpoints > 0) bits.push(`记了 ${r.touchpoints} 条`)
  if (r.unmatchedOutbound > 0) bits.push(`${r.unmatchedOutbound} 通打出去的对不上人`)
  if (r.stoppedEarly) bits.push('中途停了，下一轮接着来')
  return bits.join(' · ')
}

/** 判断层那个「多久算一次真对话」的门槛，落库层也要引用到，透传一次。 */
export { TRIVIAL_TALK_SECONDS }
