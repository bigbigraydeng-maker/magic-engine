/**
 * Meta 即时表单 lead → 统一联系人 + 一条带归因的触点。
 *
 * 跟 `src/lib/crm/web-form-lead.ts` 是同一类东西（渠道适配器），写法刻意保持一致：
 * 建人走 `resolveContact`，触点按 `(client_id, source, source_ref)` 幂等 upsert。
 *
 * 幂等键跟人手导入脚本**完全对齐**：两边的 `source_ref` 都是 Meta 的 lead id
 * （`scripts/import-cts-fb-leads.ts` 用 CSV 的 `id` 列，就是同一个值）。所以自动
 * 管道第一次回补时，7/26 已经手动导进去的 335 人不会被写成第二份。
 *
 * 合并策略用 'auto'（不是官网表单那个 'reject'），依据是 identity.ts 里已经写死的
 * 判断：「Meta 表单里的电话和邮箱天然来自同一次提交，是同一个人的两个身份，合并
 * 才对」。这条是渠道适配器的既定设计，人手导入脚本也是这么走的 —— 这里不另立规矩。
 *
 * 永不抛异常：一条脏 lead 不能弄停整批同步（防护 C）。失败如实计数并回报。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { buildIdentities, resolveContact } from '@/lib/crm/identity'
import { attributionColumns, attributionFromMetaLeadRow } from '@/lib/crm/attribution'
import { lookupCreativeRefByAdId } from '@/lib/ads/creative-link'
import { type SubscribeMemberResult } from '@/lib/mailchimp/client'
import { subscribeMemberEnsuringTag } from '@/lib/mailchimp/tags'
import {
  isUndefinedColumn,
  readAudienceId,
  readLeadSourceTag,
} from '@/lib/mailchimp/audience-config'
import { isDoNotContact, type DncTouch } from '@/lib/crm/dnc'
import type { MetaLead, MetaLeadAnswer } from '@/lib/meta/lead-forms'

/**
 * Meta 的标准字段名（表单里的「联系信息」那类问题）。除这些之外的都是客户自己
 * 加的自定义问题，原样存进 metadata.custom_answers。
 */
const STANDARD_FIELDS = new Set([
  'full_name',
  'first_name',
  'last_name',
  'email',
  'phone_number',
  'phone',
])

export interface ParsedLeadAnswers {
  name: string | null
  /**
   * 拆开的名/姓。Meta 表单交上来的形式两种都有（full_name 一整段 / first+last
   * 两个字段），Mailchimp 的 FNAME/LNAME merge field 只吃拆开的。full_name 用
   * 第一个空格拆一次，剩下的都算 LNAME —— 这是共识做法，别为了处理 "Van der
   * Berg" 这种边角自己造 heuristic。
   */
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  /**
   * 「感兴趣的团」。**只认问题名里带 tour 的自定义问题** —— 不是「取第一个自定义
   * 答案」。CRM 横表那一列的表头写死是「感兴趣的团」（table-columns.ts），拿别的
   * 客户随便一个自定义问题去填，列名就成了假的。宁可空着。
   */
  tourInterest: string | null
  /**
   * marketing 同意证据。**只有当客户答案完全命中一份「明确肯定」白名单**时，
   * 才把找到的问题名放这里；未知值 / 长句 / 否定句 / 未识别问题 一律 null ——
   * fail-closed（Issue #1188 remediation P1 `PRRT_kwDOSTHiF86cIG3N`）。
   *
   * 找不到肯定证据就 null。存的是「找到的问题名」，不是 boolean —— 方便回查
   * 具体是哪个字段做的判断，将来审计不会两眼一抹黑。
   */
  consentEvidence: string | null
  /**
   * 明确的**拒收**证据。命中 opt-out / unsubscribe / do-not-contact 类问题且
   * 答案是白名单里的「明确肯定」值时，视为客人主动拒绝营销 —— 出口一律 skip，
   * 不管别处是否也有一个 consent 字段（refuse 优先）。
   *
   * 找不到就 null。
   */
  optOutEvidence: string | null
  /** 全部自定义问答，原样保留，将来加列不用重跑历史。 */
  custom: Record<string, string>
}

/**
 * **明确的营销邮件订阅字段名** —— 只有这几个名字命中且答案在
 * AFFIRMATIVE_ANSWERS 白名单里，才算 provable marketing-email consent。
 *
 * ⚠️ 这是**完整名等值匹配**（trim + lowercase 后），不是 token 匹配。
 *    上一版用正则匹配 "consent / marketing" 等 token 会把
 *    `consent_to_terms_and_conditions=Yes`、`consent_to_privacy_policy=Yes`、
 *    `have_you_received_our_marketing_before=Yes` 这些无关问题当成订阅同意，
 *    直接违反 provable consent 语义（Issue #1188 合同 5425312107 第 1 条）。
 *
 * 表单如果需要新的字段名，先在这里加进去。**宁可漏发一批人**，也不能把没
 * 明确同意营销的人拉进 Welcome journey。
 *
 * 命名归一化：为了扛表单里 `-`/`_`/空格/大小写的写法差异，只把这三种分隔符
 * 归一成 `_`；除此之外一律**精确等值匹配**。
 */
const EMAIL_MARKETING_CONSENT_FIELDS: ReadonlySet<string> = new Set([
  // 显式「同意接收营销邮件」
  'consent_to_marketing_emails',
  'consent_to_receive_marketing_emails',
  'agree_to_marketing_emails',
  'agree_to_receive_marketing_emails',
  // 显式「订阅营销邮件 / newsletter」
  'subscribe_to_marketing_emails',
  'subscribe_to_newsletter',
  'subscribe_to_email_updates',
  'subscribe_to_our_newsletter',
  'newsletter_signup',
  'newsletter_subscription',
  'email_newsletter_signup',
  'receive_marketing_emails',
  'receive_email_updates',
  // 显式 opt-in 类（opt-out 由 OPT_OUT_QUESTION_PATTERN 单独反面拦）
  'opt_in_to_marketing_emails',
  'opt_in_to_newsletter',
  'marketing_email_opt_in',
  'email_marketing_opt_in',
])

/** `Some Field-Name` → `some_field_name`。只归一分隔符 + 大小写，不做别的。 */
function normalizeConsentFieldName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

/**
 * 「拒收 / 退订」类问题名。命中这里 + 答案在 AFFIRMATIVE_ANSWERS 白名单里
 * = 明确拒绝，出口一律 skip（不管别处是否有 consent）。
 *
 * 这条独立存在是因为 Meta 表单允许用**反面提问**（"opt out of marketing"）——
 * 上一版按「不是短否定就当同意」会把 `marketing_opt_out=Yes` 认成同意，
 * 直接违反 provable consent 语义。
 */
const OPT_OUT_QUESTION_PATTERN = /opt.?out|unsubscribe|do.?not.?contact|no.?marketing/i

/**
 * 「明确肯定」白名单 —— **完整值匹配**（trim + lowercase 后）。
 *
 * 有意保守：只放**语义无歧义**的短肯定值。任何长句（例如 "No, I do not
 * consent"）、任何未见过的写法（例如 "OK maybe" 或空字符串）都 fail-closed
 * 落到 no_consent_evidence，Mailchimp 出口 skip。
 *
 * 中文那几个是给未来同一套代码接手 CN 表单留的入口，跟英文一样只认完整值。
 */
const AFFIRMATIVE_ANSWERS: ReadonlySet<string> = new Set([
  'yes',
  'y',
  'true',
  '1',
  'checked',
  'on',
  'agree',
  'agreed',
  'i agree',
  'i accept',
  'accept',
  'accepted',
  'confirm',
  'confirmed',
  'subscribe',
  'subscribe me',
  'sign me up',
  'sign up',
  'opt in',
  'opt-in',
  'opt_in',
  'yes please',
  'yes, please',
  '是',
  '同意',
  '订阅',
  '我同意',
  '愿意',
])

function isAffirmative(value: string): boolean {
  return AFFIRMATIVE_ANSWERS.has(value.trim().toLowerCase())
}

/** 一次提交的问答 → 结构化字段。纯函数，不碰数据库。 */
export function parseLeadAnswers(answers: MetaLeadAnswer[]): ParsedLeadAnswers {
  const std = new Map<string, string>()
  const custom: Record<string, string> = {}

  for (const a of answers) {
    const key = a.name.trim().toLowerCase()
    const value = a.value.trim()
    if (!key || !value) continue
    if (STANDARD_FIELDS.has(key)) std.set(key, value)
    else custom[a.name.trim()] = value
  }

  const fullName = std.get('full_name')
  const composed = [std.get('first_name'), std.get('last_name')].filter(Boolean).join(' ').trim()

  let tourInterest: string | null = null
  let consentEvidence: string | null = null
  let optOutEvidence: string | null = null
  for (const [question, value] of Object.entries(custom)) {
    if (tourInterest === null && /tour/i.test(question)) {
      tourInterest = value
    }
    // opt-out 先判 —— 反面提问优先级最高，压过任何看起来像同意的字段。
    if (optOutEvidence === null && OPT_OUT_QUESTION_PATTERN.test(question) && isAffirmative(value)) {
      optOutEvidence = question
    }
    // 正向：问题名**完整匹配**白名单 + 答案在肯定值白名单里 —— 缺一即 fail-closed。
    // 通用 consent / 条款同意 / 历史营销问题一律不算 marketing-email consent。
    if (
      consentEvidence === null &&
      EMAIL_MARKETING_CONSENT_FIELDS.has(normalizeConsentFieldName(question)) &&
      !OPT_OUT_QUESTION_PATTERN.test(question) &&
      isAffirmative(value)
    ) {
      consentEvidence = question
    }
  }

  let firstName = std.get('first_name') ?? null
  let lastName = std.get('last_name') ?? null
  if ((!firstName || !lastName) && fullName) {
    const spaceIdx = fullName.indexOf(' ')
    if (spaceIdx > 0) {
      firstName = firstName ?? fullName.slice(0, spaceIdx)
      lastName = lastName ?? (fullName.slice(spaceIdx + 1).trim() || null)
    } else {
      firstName = firstName ?? fullName
    }
  }

  return {
    name: fullName ?? (composed || null),
    firstName: firstName?.trim() || null,
    lastName: lastName?.trim() || null,
    email: std.get('email') ?? null,
    phone: std.get('phone_number') ?? std.get('phone') ?? null,
    tourInterest,
    consentEvidence,
    optOutEvidence,
    custom,
  }
}

export interface IngestMetaLeadInput {
  clientId: string
  /** 本地号码补哪个国码。按客户市场传（NZ 021… / AU 04…）。 */
  defaultCountry: 'NZ' | 'AU'
  lead: MetaLead
}

export interface IngestMetaLeadResult {
  contactId: string | null
  /** true = 这条 lead 让系统里多了一个新人。 */
  createdContact: boolean
  /** 没接进来的原因；接进来了就是 null。 */
  skipped: 'no_identity' | 'error' | null
  /**
   * Mailchimp 出口的结果（如果这一步跑了的话）。null = 没跑（例如 no_identity
   * 直接返回）。观测和测试用；主管道的成败**不受它影响** —— provider 失败不会
   * 让 Meta lead 接入回滚（Issue #1188 硬约束）。
   */
  mailchimp: SubscribeMemberResult | null
}

/**
 * 一条 Meta lead → contact + inbound 触点。
 *
 * 电话和邮箱都不成形就不建人 —— contacts 表被垃圾提交灌脏，比漏一条 lead 贵得多
 * （板桥的「护栏 · 一等公民」：只有真实触点才升级成客户）。
 */
export async function ingestMetaLead(input: IngestMetaLeadInput): Promise<IngestMetaLeadResult> {
  const { clientId, lead } = input

  try {
    const parsed = parseLeadAnswers(lead.answers)

    const identities = buildIdentities({
      phone: parsed.phone,
      email: parsed.email,
      defaultCountry: input.defaultCountry,
    })
    if (identities.length === 0) {
      return { contactId: null, createdContact: false, skipped: 'no_identity', mailchimp: null }
    }

    // 这条记录来自 Meta lead 表单 → platform 一定是 'meta'（事实，不是猜的）。
    // ad / adset / campaign 有就写、没有就 null（自然贴文的表单本来就没有）。
    const attribution = attributionFromMetaLeadRow({
      ad_id: lead.adId,
      ad_name: lead.adName,
      adset_id: lead.adsetId,
      campaign_id: lead.campaignId,
      // creative id：Meta 的 lead 接口不给。只能拿 ad_id 回查 ME 自己在建广告那一刻
      // 记下的对应关系（ad_creative_links）。那条广告不是 ME 建的、或者当时就没认出
      // 是哪条片子 → 这里照样是 null，如实留白（见 lib/ads/creative-link.ts）。
      creative_ref: await lookupCreativeRefByAdId(clientId, lead.adId),
    })

    const { contactId, created } = await resolveContact({
      clientId,
      identities,
      displayName: parsed.name,
      source: 'meta_lead_form',
      seenAt: lead.createdTime,
      attribution,
      autoAssign: true,
    })

    // ── 触点 Phase A：**在任何 Mailchimp 调用之前**先 create-if-not-exists 一条
    //    contact + source touchpoint。用 upsert(ignoreDuplicates=true) 保幂等：
    //    历史 CSV 导入过的同一 lead 不会被这里再写第二条。
    //
    //    metadata 里先写 `mailchimp_result: { status: 'pending' }` 占位 —— 便于
    //    Phase B/D 用同一份 metadata 结构直接替换；也让「provider 打完但回执
    //    UPDATE 失败」的情况有可观测证据（pending 会一直挂在那儿）。
    const baseMetadata = {
      tour_interest_raw: parsed.tourInterest,
      ad_name: lead.adName,
      form_id: lead.formId,
      meta_platform: lead.platform,
      is_organic: lead.isOrganic,
      custom_answers: parsed.custom,
      ingested_by: 'meta-leads-sync',
      /**
       * Consent 依据。PM 决定（2026-08-27）：CTS 已批准的 Meta Lead Form 在
       * Submit 之前展示了 form-level disclosure，提交本身就是 consent 事件；
       * 这条路径不再要求自定义 consent 问答字段。
       * 值恒为 `'form_disclosure_attested'` —— 让下游审计一眼看到「依据是什么」。
       */
      consent_basis: 'form_disclosure_attested' as const,
      /**
       * 如果表单**碰巧**带了明确的营销订阅字段（例如 CTS 未来改版加了
       * 'consent_to_marketing_emails'），这里如实记下问题名；否则 null。
       * **不**用来门禁 Mailchimp 调用 —— 门禁在 `consent_basis` 层。
       * 也**绝不**把 `form_disclosure_attested` 冒充成一个不存在的 checkbox 答案。
       */
      consent_evidence: parsed.consentEvidence,
      opt_out_evidence: parsed.optOutEvidence,
      /**
       * ⚠️ Persistent opt-out（合同 5426843158）：这条 lead 明确 opt-out 时，
       * 把统一 DNC 判据能读到的 `do_not_contact: true` 也写进 metadata。
       * `evaluateDnc()` 已经在读 `metadata.do_not_contact`（见 dnc.ts 的
       * `flagged` 字段），所以这一位一亮 → 同一联系人**未来任何** lead 都会
       * 被同一 DNC 判据拦下来，即使那条 lead 本身没有再勾 opt-out。
       * `opt_out_evidence` 继续保留作审计事实；这里只补一位「判据读得懂」的
       * 布尔，不加 schema、不加表、不动 DNC framework。
       * dnc_cleared 的既有解除路径保持不变 —— isDoNotContact() 看最后一次判决，
       * 后写的 dnc_cleared 触点仍然可以推翻这里的 true。
       */
      ...(parsed.optOutEvidence ? { do_not_contact: true } : {}),
    }

    const { error } = await supabaseAdmin.from('contact_touchpoints').upsert(
      {
        client_id: clientId,
        contact_id: contactId,
        channel: 'meta_lead_form',
        // 客户自己填的表 —— 方向是进来的。
        direction: 'inbound',
        occurred_at: lead.createdTime,
        // 跟人手导入写出来的那 347 条保持同一句式，时间线上看不出两条管道。
        summary: `填了 Facebook 表单${parsed.tourInterest ? ` · ${parsed.tourInterest}` : ''}`,
        raw: null,
        metadata: {
          ...baseMetadata,
          // Phase A 占位：还没打 provider。Phase B/D 会替换成真实结果。
          mailchimp_result: { status: 'pending' },
        },
        // 触点也存一份归因：同一个人可能被两条不同的广告分别捞到过，只看 contacts
        // 上那份 first-touch 会让第二条广告的贡献永远看不见。
        ...attributionColumns(attribution),
        source: 'meta_lead_form',
        source_ref: lead.leadId,
      },
      { onConflict: 'client_id,source,source_ref', ignoreDuplicates: true },
    )
    if (error) throw new Error(error.message)

    // ── 触点 Phase B：**pre-provider evidence UPDATE**。哪怕 Phase A 因幂等键
    //    冲突没写（比如这条 lead 已经被 CSV 导过），也强制把**本次**判据得到的
    //    consent_evidence / opt_out_evidence / pending receipt 写回同一条触点。
    //    若这一步失败 → **零 provider 调用**：宁可漏发一次，也不能在没有耐用
    //    consent 证据的情况下产生邮件副作用（合同 5425312107 第 2/3 条）。
    const evidenceMetadata = {
      ...baseMetadata,
      mailchimp_result: { status: 'pending' },
    }
    const preErr = await updateTouchpointMetadata({
      clientId,
      leadId: lead.leadId,
      metadata: evidenceMetadata,
    })
    if (preErr) {
      console.warn(
        `[meta-lead] lead ${lead.leadId} pre-provider evidence UPDATE failed (${sanitizeErr(preErr)}); zero Mailchimp call`,
      )
      const skipped: SubscribeMemberResult = { status: 'skipped', reason: 'evidence_persist_failed' }
      return { contactId, createdContact: created, skipped: null, mailchimp: skipped }
    }

    // ── 触点 Phase C：现在（且仅在触点 + 本次 consent 证据均已落盘之后）调
    //    Mailchimp。provider 自己吞异常，永远返回 `SubscribeMemberResult`；有
    //    AbortSignal 硬超时兜底。
    const mailchimp = await syncMailchimp({
      clientId,
      contactId,
      parsed,
      leadId: lead.leadId,
    })

    // ── 触点 Phase D：把**同一条**（client_id + source + source_ref 唯一）触点的
    //    metadata.mailchimp_result 从 pending 替换成本轮 provider 的真实结果。
    //    **用 UPDATE 而不是二次 upsert** —— upsert 走 ignoreDuplicates=true 会
    //    保留旧 metadata，正是当初 Phase B 也要修的病根。
    //
    // ⚠️ 2026-09-24 起这个字段**有下游判据在读**：`lib/meta/leads-sync.ts` 的
    //    `readSettledLeadIds()` 拿它判「这条上轮办完没有、本轮还要不要打 Mailchimp」
    //    （判据本体在 `lib/mailchimp/outlet-tally.ts` 的 `isMailchimpSettled`）。
    //    改这里的回执形状、或做 metadata 清理之前，先去看那两处 —— 不然那道闸会
    //    悄悄失效（表现是「又开始每轮重打了」）或者误判（表现是「再也不重试了」）。
    const receiptMetadata = {
      ...baseMetadata,
      mailchimp_result: mailchimp,
    }
    const receiptErr = await updateTouchpointMetadata({
      clientId,
      leadId: lead.leadId,
      metadata: receiptMetadata,
    })

    if (receiptErr) {
      // provider 结果没能写回本地。**不**声称邮件已投递，**不**动
      // mailchimp_synced_at；主管道（Phase A + Phase B evidence）已经成。
      console.warn(
        `[meta-lead] lead ${lead.leadId} receipt update failed (${sanitizeErr(receiptErr)}); mailchimp_synced_at withheld`,
      )
      return { contactId, createdContact: created, skipped: null, mailchimp }
    }

    // 只在明确成功或安全确认已存在**且**回执写回成功时，才动
    // contacts.mailchimp_synced_at。该列的语义是「audience 会员关系已确认」，
    // 不承担「Welcome 邮件已投递」；与 receipt 语义永远保持一致。
    if (mailchimp.status === 'subscribed' || mailchimp.status === 'already_member') {
      const { error: syncErr } = await supabaseAdmin
        .from('contacts')
        .update({ mailchimp_synced_at: new Date().toISOString() })
        .eq('id', contactId)
      if (syncErr) {
        // 观测列没写上不影响主管道；如实 warn，不 throw。会员关系的权威回执是
        // 上面刚写成功的触点 metadata.mailchimp_result，不靠这一列。
        //
        // 生产上这里目前**必然**失败：`contacts.mailchimp_synced_at` 跟
        // `clients.mailchimp_audience_id` 是同一条没 apply 的 migration
        // (20260826010000) 加的。分开措辞，免得下一个人把结构性缺列当成偶发抖动。
        console.warn(
          isUndefinedColumn(syncErr)
            ? `[meta-lead] contact ${contactId} mailchimp_synced_at 这一列在库里不存在（migration 20260826010000 未 apply）；回执已落触点 metadata，不影响同步`
            : `[meta-lead] contact ${contactId} mailchimp_synced_at 更新失败: ${sanitizeErr(syncErr.message)}`,
        )
      }
    }

    return { contactId, createdContact: created, skipped: null, mailchimp }
  } catch (err) {
    console.error(`[meta-lead] lead ${lead.leadId} 接入失败:`, err)
    return { contactId: null, createdContact: false, skipped: 'error', mailchimp: null }
  }
}

/** 把 DB / provider 错误里可能带的邮箱、URL 截断，落日志只留骨架。 */
function sanitizeErr(msg: string): string {
  if (!msg) return ''
  return msg
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '<email>')
    .replace(/(https?:\/\/[^\s]+)/g, '<url>')
    .slice(0, 200)
}

/**
 * 用 (client_id, source='meta_lead_form', source_ref) 精确定位同一条触点，覆盖
 * 它的 `metadata`。返回错误消息（成功 = null）。**不 upsert**，只 UPDATE —— 上
 * 游用 Phase A 的 upsert 负责 create-if-not-exists，本函数只负责 overwrite。
 */
async function updateTouchpointMetadata(args: {
  clientId: string
  leadId: string
  metadata: Record<string, unknown>
}): Promise<string | null> {
  const { error } = await supabaseAdmin
    .from('contact_touchpoints')
    .update({ metadata: args.metadata })
    .eq('client_id', args.clientId)
    .eq('source', 'meta_lead_form')
    .eq('source_ref', args.leadId)
  return error ? error.message : null
}

// ── Mailchimp 出口 ──────────────────────────────────────────────────────────

interface SyncMailchimpInput {
  clientId: string
  contactId: string
  parsed: ParsedLeadAnswers
  leadId: string
}

/**
 * 把一个 lead → Mailchimp audience。**永远返回结果对象**，绝不 throw。
 *
 * gate 顺序（Issue #1188 硬约束 + PM override 5425996255）：
 *   1. 客户是否配置了 audience id（走 `mailchimp/audience-config` 的容错读法：
 *      专列优先、42703 降级到 `leads_config`）—— 读不到 → skipped:
 *      client_config_read_failed **并 console.error**；查得到但没配 → skipped:
 *      no_audience_config
 *   2. 是否有邮箱 —— 没有 → skipped: no_email
 *   3. 是否拿到 API key —— 没有 → skipped: no_api_key
 *   4. 表单里是否明确 opt-out —— 是 → skipped: explicit_opt_out
 *   5. **统一 DNC 判据**（复用 `@/lib/crm/dnc`，读镜像列 + 不可变触点）——
 *      拒联或查询失败 → skipped: contact_dnc / dnc_check_failed
 *   6. 满足以上，才调 subscribeMember
 *
 * ⚠️ 已批准的 CTS Meta Lead Form 的 form-level disclosure 就是 consent 事件；
 *    这条路径不再要求自定义 consent 字段（PM 决定 2026-08-27，合同 5425996255）。
 *    真相通过 `consent_basis: 'form_disclosure_attested'` 记进触点 metadata。
 *
 * ⚠️ 新 lead consent 不能自动覆盖历史拒联 —— `isDoNotContact` 已经保证「只有
 *    明确的 dnc_cleared 触点晚于最后一条拒联证据」才认为解除；本函数不会写
 *    任何 dnc_cleared 触点（那是「人明确纠正」的强信号，跟表单勾选是两回事）。
 */
async function syncMailchimp(input: SyncMailchimpInput): Promise<SubscribeMemberResult> {
  // 1. 客户配置。走共享读法 —— **绝不直接 select('mailchimp_audience_id')**：
  //    那一列的 migration 至今没 apply 到生产，直接选它整条查询 42703 报错，
  //    这里就每小时静默走 client_config_read_failed。见 audience-config.ts 的
  //    注释和 2026-09-03 的生产实测。
  const configRead = await readAudienceId(input.clientId)
  if (!configRead.ok) {
    // 查配置失败 = 不该猜「有」也不该猜「没有」。**必须吼出来** —— 这条分支
    // 以前只有一个 return，没有一行日志、没有一个计数，于是「从来没同步过」
    // 这件事在生产上藏了一整个月没人看得见。拿不到数据 ≠ 真没有。
    console.error(
      `[meta-lead] client ${input.clientId} Mailchimp 出口读配置失败，本条没进邮件名单: ${sanitizeErr(configRead.message)}`,
    )
    return { status: 'skipped', reason: 'client_config_read_failed' }
  }
  const audienceId = configRead.audienceId
  if (!audienceId) {
    return { status: 'skipped', reason: 'no_audience_config' }
  }

  // 2. 邮箱
  const email = input.parsed.email?.trim().toLowerCase() ?? ''
  if (!email) {
    return { status: 'skipped', reason: 'no_email' }
  }

  // 3. API key（跑时读，不放模块顶层 —— CLAUDE.md 规矩）
  const apiKey = process.env.MAILCHIMP_API_KEY ?? ''
  if (!apiKey.trim()) {
    return { status: 'skipped', reason: 'no_api_key' }
  }

  // 4. 明确 opt-out 优先级最高 —— 反面提问 / 退订选项不能被 form-level
  //    disclosure 覆盖。
  if (input.parsed.optOutEvidence) {
    return { status: 'skipped', reason: 'explicit_opt_out' }
  }

  // 5. 统一 DNC 判据 —— 拉镜像列 + 不可变触点，交给 dnc.ts 判。任何一处查询
  //    失败都 fail-closed（宁可少发一次，也不能发给明确说过别联系的人）。
  const dnc = await evaluateDnc(input.contactId)
  if (dnc === 'unknown') {
    return { status: 'skipped', reason: 'dnc_check_failed' }
  }
  if (dnc === 'blocked') {
    return { status: 'skipped', reason: 'contact_dnc' }
  }

  // 7. 来源标签名 —— 从客户配置读，不写死在共享代码里（平台化红线 2）。
  //    读失败不拿默认值糊过去：那等于把「读不到」伪装成「客户就要默认」。
  const tagRead = await readLeadSourceTag(input.clientId)
  if (!tagRead.ok) {
    console.error(
      `[meta-lead] client ${input.clientId} 来源标签配置读取失败，本条不发: ${tagRead.message}`,
    )
    return { status: 'skipped', reason: 'source_tag_read_failed' }
  }

  // 8. 打出去
  try {
    return await subscribeMemberEnsuringTag({
      apiKey,
      audienceId,
      email,
      firstName: input.parsed.firstName,
      lastName: input.parsed.lastName,
      // SOURCE merge field 保持 `facebook_leadgen` 不动 —— 它是 Mailchimp 里
      // 一个 text 字段的值，跟 #1188 合同措辞绑着，且确实写进去了。
      source: 'facebook_leadgen',
      // 标签则相反：原来写死的 `facebook_leadgen` 在 CTS 名单里**从来没出现
      // 过**（2026-09-06 实测，分段根本不存在）—— 因为人已在名单里时那次请求
      // 整个不生效。既然没有任何自动化能绑在一个不存在的标签上，就改成从配置
      // 读，CTS 沿用他们真正在用的 `fb_lead`。
      tag: tagRead.tag,
    })
  } catch {
    // subscribeMember 应该永远不 throw，兜底防御。
    return { status: 'failed', reason: 'unexpected_exception' }
  }
}

/**
 * 拉出 `isDoNotContact` 需要的两份原料，返回三态：
 *
 * - `'blocked'` = 拒联成立
 * - `'ok'`      = 明确没拒联
 * - `'unknown'` = 任一读取失败 —— fail-closed，出口按拒联处理
 *
 * 触点 select 跟 `messenger-stop-signal.ts` 那份保持同款字段
 * (`metadata`, `occurred_at`)，判据入口是全仓唯一的 `isDoNotContact`。
 *
 * 导出给一次性回填脚本复用（例如 `scripts/backfills/tag-historical-meta-leads.ts`）——
 * 任何要在写 Mailchimp 之前判断「这个人能不能联系」的地方，都必须走这一份，
 * 不许各自拼一份查询。
 */
export type DncCheck = 'blocked' | 'ok' | 'unknown'

export async function evaluateDnc(contactId: string): Promise<DncCheck> {
  const [contactRes, touchesRes] = await Promise.all([
    supabaseAdmin.from('contacts').select('do_not_contact').eq('id', contactId).maybeSingle(),
    supabaseAdmin
      .from('contact_touchpoints')
      .select('metadata, occurred_at')
      .eq('contact_id', contactId),
  ])

  if (contactRes.error || touchesRes.error) return 'unknown'
  // 联系人主记录消失（例如竞态被合并）—— 保守 unknown。
  if (!contactRes.data) return 'unknown'

  const flag = contactRes.data.do_not_contact === true

  const rawTouches = (touchesRes.data ?? []) as Array<{
    metadata: Record<string, unknown> | null
    occurred_at: string
  }>
  const touches: DncTouch[] = rawTouches.map((t) => {
    const meta = t.metadata ?? {}
    const outcome = typeof meta.outcome === 'string' ? (meta.outcome as string) : null
    return {
      outcome,
      flagged: meta.do_not_contact === true,
      occurredAt: t.occurred_at,
    }
  })

  return isDoNotContact(flag, touches) ? 'blocked' : 'ok'
}
