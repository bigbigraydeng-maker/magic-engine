/**
 * 读已有的邮件 / 私信 / 电话记录，把空着的「跟进到哪一步」填上。
 *
 * 判断在 `stage-from-conversation.ts`（含为什么这么设计），这里只负责
 * **取数 → 问模型 → 落库 + 留痕**。分工照 `qualified-buyer.ts` /
 * `qualified-buyer-autotag.ts` 那一对。
 *
 * ## 挂在哪
 *
 * 挂在**已经在跑**的 `messenger-brief-hourly` 上，不新注册 cron ——
 * 理由与 `qualified-buyer-autotag` 同一条：新 cron 要手工 link 密钥的环境变量组，
 * 漏了就每天 401 静默失败（daily-cron-digest 哑了 51 天那次就是这么来的）。
 *
 * ## 为什么不会每小时重复烧钱
 *
 * 候选人只从 `stage IS NULL` 里挑，填上一个就少一个。556 个人分几轮跑完之后，
 * 后面每小时捞到的就是 0 个，一次模型调用都不会发生。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { isAutomatedTouch } from './automated-touch'
import { STAGE_INFER_ACTOR, STAGE_REASON_PREFIX } from './actors'
import {
  STAGE_SYSTEM_PROMPT,
  StageVerdictSchema,
  SAFE_STAGES,
  POOL_STAGE,
  renderTranscript,
  ruleOnlyStage,
  usableStage,
  worthReading,
  type AppliedStage,
  type StageVerdict,
  type TranscriptLine,
} from './stage-from-conversation'

/**
 * 改阶段的人写在审计里的名字。
 *
 * 人工改阶段写的是操作者邮箱，两者永远分得开 —— 以后才答得出「AI 填错了多少」，
 * 也才有可能一键回滚这一批。跟 `AUTO_TAG_ACTOR` 是两个不同的名字：那是「自动标
 * 真买家」，这是「读对话填阶段」，出了问题要分得清是哪一套干的。
 */
export { STAGE_INFER_ACTOR } from './actors'

/** 一轮最多问模型这么多次 —— 某天数据暴涨也不会变成一张失控的账单。 */
const MAX_CONTACTS_PER_RUN = 60

/** PostgREST 的 .in() 一次塞太多会把 URL 撑爆。 */
const IN_CHUNK = 100

export interface StageInferResult {
  /** 捞出来的空阶段联系人。 */
  candidates: number
  /** 真的问了模型的。 */
  asked: number
  /** 填上阶段的。 */
  filled: number
  /** 其中没问模型、规则自己定下来的（「无下文」）。 */
  byRule: number
  /** 其中读不出来、放进潜在客户池的。 */
  toPool: number
  /** 模型有答案、但没过验证（证据编的 / 阶段不许落）而丢掉的。 */
  rejected: number
  /** 写库失败的。 */
  failed: number
}

const EMPTY: StageInferResult = {
  candidates: 0,
  asked: 0,
  filled: 0,
  byRule: 0,
  toPool: 0,
  rejected: 0,
  failed: 0,
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function modelName(): string {
  return process.env.CRM_STAGE_INFER_MODEL ?? 'gpt-4o-mini'
}

/**
 * 问模型这个人到哪一步了。没配 API key 就直接不判（返回 null）——
 * dev / 测试永远不依赖一次网络调用，也绝不假装读出了什么。
 */
export async function askStage(transcript: string): Promise<StageVerdict | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  // 走统一封装（而不是自己 new）—— 账户级失效（余额耗尽 / 钥匙失效）
  // 的识别与落库都装在那一层，是全站唯一能一次盖住所有调用点的位置。
  // bypassGateway：这条链路用的是 responses API，从没经过 CF 网关验证过，
  // 只拿拦截、不换路由（见 openai-client.ts 的 OpenAIClientOptions）。
  const { getOpenAIClient } = await import('@/lib/ai/openai-client')
  const client = getOpenAIClient({ apiKey, bypassGateway: true })
  const res = await client.responses.create({
    model: modelName(),
    input: [
      { role: 'system', content: STAGE_SYSTEM_PROMPT },
      { role: 'user', content: `Conversation:\n${transcript}` },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'stage_verdict',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['stage', 'evidence', 'reason'],
          properties: {
            stage: {
              type: 'string',
              enum: ['contacted', 'quoted', 'deferred', 'no_response', 'traveling_soon', 'unclear'],
            },
            evidence: { type: 'string' },
            reason: { type: 'string' },
          },
        },
      },
    },
  } as Parameters<typeof client.responses.create>[0])

  const text = (res as { output_text?: string }).output_text ?? '{}'
  const parsed = StageVerdictSchema.safeParse(JSON.parse(text))
  // 模型答歪了就当没答 —— 空着比写一个残缺的判断强。
  return parsed.success ? parsed.data : null
}

/**
 * 哪些客户跑这套东西 —— **必须把那几档全配齐**。
 *
 * 🔴 「配了其中任意一档」是不够的（Codex 复审 2026-08-16）：地产那套漏斗
 * （`20260730145441_real_estate_pipeline_seed.sql`）也有 `contacted` 和
 * `no_response`，于是三个地产客户会被这条 cron 一并扫进来 —— 而
 * `STAGE_SYSTEM_PROMPT` 从头到尾讲的是 CTS 的旅游生意（团、行程、出行月份）。
 * 拿旅游漏斗去判一个看房的人，写进去的是**错的客户数据**。
 *
 * 配齐 = 这个客户的漏斗**就是**那条漏斗（`traveling_soon` 即将出行是旅游独有的）。
 * 以后哪个行业要用，得先给它写自己的阶段定义和提示词，而不是共用这一份。
 */
export async function loadClientsWithSafeStages(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('client_pipeline_stages')
    .select('client_id, stage_key')
    .in('stage_key', [...SAFE_STAGES])
  if (error) throw new Error(`读阶段配置失败: ${error.message}`)

  const byClient = new Map<string, Set<string>>()
  for (const row of (data ?? []) as { client_id: string; stage_key: string }[]) {
    const set = byClient.get(row.client_id) ?? new Set<string>()
    set.add(row.stage_key)
    byClient.set(row.client_id, set)
  }
  return Array.from(byClient.entries())
    .filter(([, set]) => SAFE_STAGES.every((k) => set.has(k)))
    .map(([clientId]) => clientId)
}

/** 这个客户配置里真的有哪些阶段。没配的不许写进去。 */
export async function loadConfiguredStages(clientId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from('client_pipeline_stages')
    .select('stage_key')
    .eq('client_id', clientId)
  return new Set(((data ?? []) as { stage_key: string }[]).map((s) => s.stage_key))
}

/**
 * 一个人的全部往来内容 —— 邮件正文、私信原文、销售手打的电话记录。
 *
 * 三样都要：只读其中一样，正是这套系统原来的毛病（只看了 295 条电话记录、
 * 漏掉 523 封邮件和 2099 条私信，于是 556 个人的阶段一直空着）。
 */
export async function loadTranscriptLines(
  clientId: string,
  contactId: string,
): Promise<TranscriptLine[]> {
  const [{ data: convs, error: cErr }, { data: touches, error: tErr }] = await Promise.all([
    supabaseAdmin.from('conversations').select('id').eq('client_id', clientId).eq('contact_id', contactId),
    supabaseAdmin
      .from('contact_touchpoints')
      .select('channel, direction, occurred_at, raw, summary, source, metadata')
      .eq('client_id', clientId)
      .eq('contact_id', contactId)
      .neq('channel', 'messenger')
      .order('occurred_at', { ascending: false })
      .limit(200),
  ])

  /**
   * 🔴 **少读了一路，就不许再判**（Codex 复审 2026-08-16）。
   *
   * Supabase 出瞬时错误时返回的是 `data: null` + `error`。把它当成「这个人
   * 没有邮件」，拼出来的就是一段**残缺**的对话 —— 而模型据此落下的阶段是
   * **永久**写进档案的。最典型的坏法：邮件那一路挂了，只剩两个月前的电话手记，
   * 于是一个正在邮件里谈价的人被写成「无下文」。
   *
   * 宁可这一轮跳过他（外层记一笔 failed，下一轮再来），也不要一个错的结论。
   */
  if (cErr) throw new Error(`读对话失败: ${cErr.message}`)
  if (tErr) throw new Error(`读触点失败: ${tErr.message}`)

  const lines: TranscriptLine[] = []

  for (const t of (touches ?? []) as {
    channel: string
    direction: 'inbound' | 'outbound'
    occurred_at: string
    raw: string | null
    summary: string | null
    source: string | null
    metadata: Record<string, unknown> | null
  }[]) {
    // 机器发的出站（Mailchimp 欢迎信 / 群发）不是「我们跟他聊过」——喂给模型，
    // 「对方一句没回 + 我们发过 + 已过两周」会把只收过欢迎信的人永久写成「无下文」。
    // 只针对邮件：AI 外呼的触点也标了 automated，但它的 raw 是通话摘要（客人在电话里说的话都在里面），必须留给模型。
    if (t.channel === 'email' && t.direction === 'outbound' && isAutomatedTouch(t.source, t.metadata)) continue
    // 电话触点的原话在 raw；raw 空的（FB 表单之类）退回 summary。
    const body = (t.raw ?? t.summary ?? '').trim()
    if (body) lines.push({ at: t.occurred_at, direction: t.direction, body, channel: t.channel })
  }

  const convIds = ((convs ?? []) as { id: string }[]).map((c) => c.id)
  if (convIds.length > 0) {
    const { data: msgs, error: mErr } = await supabaseAdmin
      .from('conversation_messages')
      .select('direction, body, sent_at')
      .in('conversation_id', convIds)
      .order('sent_at', { ascending: false })
      .limit(500)
    // 同上：邮件 / 私信原文正是这套东西存在的理由，读不到就别判。
    if (mErr) throw new Error(`读往来原文失败: ${mErr.message}`)
    for (const m of (msgs ?? []) as {
      direction: 'inbound' | 'outbound'
      body: string | null
      sent_at: string
    }[]) {
      const body = (m.body ?? '').trim()
      if (body) lines.push({ at: m.sent_at, direction: m.direction, body, channel: 'message' })
    }
  }

  return lines
}

/**
 * 落一个人的阶段 + 审计。
 *
 * 🔴 UPDATE 的 WHERE 里**再判一次 stage 仍为空**：取数和写库之间，销售完全
 * 可能已经在手机上把这个人标好了。只靠内存里那份快照会把他刚做的判断盖掉 ——
 * 而「绝不覆盖人工判断」是这套自动化能存在的前提。人一旦动过，这条 UPDATE
 * 命中 0 行、什么都不发生，返回 false（被抢先了，不算失败）。
 */
async function applyStage(
  clientId: string,
  contactId: string,
  stage: AppliedStage,
  // 只用得到这两样：为什么这么判、依据哪句原话。不收整个 verdict，
  // 兜底进池子那条路本来就没有 verdict 可给。
  verdict: { reason: string; evidence: string },
  now: Date,
): Promise<boolean> {
  const nowIso = now.toISOString()
  const { data, error } = await supabaseAdmin
    .from('contacts')
    .update({ stage, stage_updated_at: nowIso, updated_at: nowIso })
    .eq('id', contactId)
    .eq('client_id', clientId)
    .is('stage', null)
    .select('id')

  if (error) throw new Error(`填阶段失败: ${error.message}`)
  if (!data || data.length === 0) return false

  // 留痕：为什么这么判 + 依据的原话。销售在时间线上看得到，不服可以直接改。
  const { error: aErr } = await supabaseAdmin.from('contact_stage_events').insert({
    client_id: clientId,
    contact_id: contactId,
    from_stage: null,
    to_stage: stage,
    changed_by: STAGE_INFER_ACTOR,
    // 规则那一档（无下文）本来就没有原话可引 —— 别在时间线上留一个空引号。
    note: verdict.evidence
      ? `${STAGE_REASON_PREFIX.inferred}${verdict.reason}｜原话：「${verdict.evidence.slice(0, 200)}」`
      : `${STAGE_REASON_PREFIX.inferred}${verdict.reason}`,
  })

  /**
   * 🔴 **留痕写不上，这一条就不算数**（Codex 复审 2026-08-16）。
   *
   * Supabase 的 `insert()` 失败是返回 `{ error }`，不抛。不管它的话，会留下
   * 一个**没有任何来历**的自动阶段：销售看不到理由、看不到原话、也看不出是
   * 机器填的，而这个人从此不在候选里、再也不会被重填。这套东西敢动 556 个人
   * 的档案，靠的就是「每一条都说得出为什么」。
   *
   * 所以把刚写的阶段退回去 —— 条件卡死在**我们这一次**写的那两个值上，
   * 中间若有人手工改过就命中 0 行，不会误伤他。退不掉也只能报失败，
   * 下一轮不会重来（stage 已经不空了），但至少 cron 摘要里看得见。
   */
  if (aErr) {
    const { error: rErr, data: rolled } = await supabaseAdmin
      .from('contacts')
      .update({ stage: null, stage_updated_at: null })
      .eq('id', contactId)
      .eq('client_id', clientId)
      .eq('stage', stage)
      .eq('stage_updated_at', nowIso)
      .select('id')

    /**
     * 退不掉的话别嘴上说「已经退回」（Codex 复审 2026-08-16）—— 留痕失败往往
     * 是数据库正在抽风，紧跟着的这条 UPDATE 大概率也失败。这时这个人身上
     * 挂着一个**没有来历**的阶段、而且再不会被重填，必须在错误里说清楚，
     * 才能从 cron 摘要里认出他、手工清掉。
     */
    if (rErr || !rolled || rolled.length === 0) {
      throw new Error(
        `留痕失败且阶段没退回（contact=${contactId} stage=${stage}）: ${aErr.message}` +
          (rErr ? ` / 退回也失败: ${rErr.message}` : ''),
      )
    }
    throw new Error(`留痕失败，已把阶段退回: ${aErr.message}`)
  }

  await noteQualifiedLead(clientId, contactId, stage, now)
  return true
}

/** The stage is already saved. A send failure must not undo it or fail the run. */
async function noteQualifiedLead(clientId: string, contactId: string, stage: string, now: Date): Promise<void> {
  try {
    const { recordQualifiedStageLead } = await import('@/lib/conversions/crm-qualified-lead')
    await recordQualifiedStageLead(
      supabaseAdmin,
      { clientId, contactId, stageKey: stage, actor: STAGE_INFER_ACTOR },
      now,
    )
  } catch (error) {
    // The stage stays. This run does not retry it; the conversions page does.
    console.info(JSON.stringify({
      receipt: 'qualified_lead_unsent',
      client_id: clientId,
      contact_id: contactId,
      stage,
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    }))
  }
}

/**
 * 跑一轮。
 *
 * @param now 用于 `stage_updated_at`
 * @param ask 问模型那一步。留成参数是为了**把「模型说了什么」和「我们据此做了
 *            什么」分开测** —— 那几道闸（证据是不是编的、终结档接不接、有没有
 *            覆盖人工判断）才是这套东西的全部价值，它们必须能在没有网络的情况下
 *            逐条验证。默认就是真的去问。
 */
export async function inferStagesFromConversations(
  now: Date,
  ask: (transcript: string) => Promise<StageVerdict | null> = askStage,
): Promise<StageInferResult> {
  // 没配 key 就一步都不走：绝不假装读出了什么。
  if (!process.env.OPENAI_API_KEY) return { ...EMPTY }

  const clientIds = await loadClientsWithSafeStages()
  if (clientIds.length === 0) return { ...EMPTY }

  const result: StageInferResult = { ...EMPTY }

  /**
   * 空阶段的人 —— 结构上就够不着已经标过的人。
   *
   * **永远从队头取，不需要任何轮转**（PM 2026-08-16 定的简化）。因为
   * 每个看过的人都会拿到一个阶段：判得出来就落判出来那一档，判不出来就进
   * 潜在客户池（见 `POOL_STAGE`）。看一个少一个，队列自己就往前走。
   *
   * 之前为了绕开「填不上的人堵在队头」，这里做过按小时滚动窗口 —— 那是在
   * 「读不出来就什么都不写」的前提下才需要的补丁。前提没了，补丁也就该删掉：
   * 留着反而会跳过人（队列每轮都在变短，固定的起点会滑过去）。
   */
  const candidates: { id: string; client_id: string }[] = []
  for (const ids of chunk(clientIds, IN_CHUNK)) {
    const { data, error } = await supabaseAdmin
      .from('contacts')
      .select('id, client_id')
      .in('client_id', ids)
      .is('stage', null)
      .eq('do_not_contact', false)
      .order('id', { ascending: true })
      .limit(MAX_CONTACTS_PER_RUN * 4)
    if (error) throw new Error(`捞空阶段联系人失败: ${error.message}`)
    candidates.push(...((data ?? []) as { id: string; client_id: string }[]))
  }
  result.candidates = candidates.length
  if (candidates.length === 0) return result

  const configuredByClient = new Map<string, Set<string>>()
  for (const clientId of Array.from(new Set(candidates.map((c) => c.client_id)))) {
    configuredByClient.set(clientId, await loadConfiguredStages(clientId))
  }

  for (const c of candidates) {
    if (result.asked >= MAX_CONTACTS_PER_RUN) break
    try {
      const configured = configuredByClient.get(c.client_id) ?? new Set<string>()
      const lines = await loadTranscriptLines(c.client_id, c.id)

      /**
       * 读不出来时的落点 —— 潜在客户池（PM 2026-08-16）。
       *
       * 「看过了，还看不出他到哪一步」本身就是一个答案，而且是**真的**答案：
       * 他现在就是个还没聊开的潜在客户。写下来，他就不在候选里了 ——
       * 不必再记「上次什么时候试过」，也不必轮转队列。
       */
      const toPool = async (why: string): Promise<void> => {
        if (!configured.has(POOL_STAGE)) return
        const ok = await applyStage(
          c.client_id,
          c.id,
          POOL_STAGE,
          { evidence: '', reason: why },
          now,
        )
        if (ok) {
          result.filled++
          result.toPool++
        }
      }

      /**
       * 对方一个字都没回过 —— 不问模型，规则自己定。
       *
       * 判据窄到不可能出错（见 `ruleOnlyStage`）：一条入站都没有 + 我们确实
       * 发过 + 最后一次发出去已经两周。规则也定不下来（比如我们压根没发过、
       * 或者才刚发出去）就进池子。
       */
      if (!worthReading(lines)) {
        const byRule = ruleOnlyStage(lines, now)
        if (byRule && configured.has(byRule)) {
          const verdict: StageVerdict = {
            stage: byRule,
            evidence: '',
            reason: '我们发过消息，两周多了对方一直没回',
          }
          if (await applyStage(c.client_id, c.id, byRule, verdict, now)) {
            result.filled++
            result.byRule++
          }
        } else {
          await toPool('他还没跟我们说过话')
        }
        continue
      }

      const transcript = renderTranscript(lines)
      if (!transcript) {
        await toPool('还没有任何往来记录')
        continue
      }

      result.asked++
      const verdict = await ask(transcript)
      // 模型答不上来 / 答歪了 / 证据是编的 / 落点不许用 —— 都不算数，进池子。
      // 「读不出来」不等于「不知道该拿他怎么办」：他就是个潜在客户。
      const stage = verdict
        ? usableStage(verdict, transcript, configured)
        : null
      if (!stage || !verdict) {
        result.rejected++
        await toPool('看过往来记录，还看不出他到哪一步')
        continue
      }

      if (await applyStage(c.client_id, c.id, stage, verdict, now)) result.filled++
    } catch (err) {
      result.failed++
      console.warn(`[stage-infer] ${c.id} 读失败：`, err instanceof Error ? err.message : err)
    }
  }

  return result
}
