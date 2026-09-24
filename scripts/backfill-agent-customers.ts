/**
 * 回填 agent_customers —— 从已入库的历史邮件里用 AI 提取同行代理的终端客户信息。
 *
 * mail-ingest 的 runAgentCustomerHook 只对**新进来的**邮件跑 AI 提取，
 * 历史邮件没被处理过。这个脚本一次性补上。
 *
 * 默认 dry-run，只显示会提取多少条，不写库。加 --live 才真写。
 *
 *   npx esbuild scripts/backfill-agent-customers.ts --bundle --platform=node \
 *     --format=esm --packages=external --outfile=/tmp/backfill-agent-customers.mjs
 *   node --env-file=.env.local /tmp/backfill-agent-customers.mjs <client_id> [--live]
 */

import { supabaseAdmin } from '../src/lib/supabase'
import { contactKindOf, readDomainRules } from '../src/lib/crm/contact-kind'
import { extractAgentCustomers } from '../src/lib/crm/travel-agent-customer-extract'

const CTS_ID = 'c0000000-0000-0000-0000-000000000000'
const BATCH_DELAY_MS = 500

interface ConvRow {
  id: string
  conversation_id: string
  contact_id: string | null
  subject: string | null
}

interface MsgRow {
  direction: string
  body: string | null
  sent_at: string
  sender_name: string | null
}

async function main(): Promise<void> {
  const clientId = process.argv[2] ?? CTS_ID
  const live = process.argv.includes('--live')

  console.log(`\n=== 回填 agent_customers ===`)
  console.log(`客户 ID: ${clientId}`)
  console.log(`模式: ${live ? '🔴 LIVE（会写库）' : '🟢 DRY-RUN（只看不写）'}\n`)

  // 1. 读域名规则
  const { data: clientRow } = await supabaseAdmin
    .from('clients')
    .select('leads_config')
    .eq('id', clientId)
    .maybeSingle()

  if (!clientRow) {
    console.error('找不到这个客户')
    process.exit(1)
  }
  const rules = readDomainRules(clientRow.leads_config ?? null)
  console.log(`同行域名: ${rules.trade.length} 个`)
  console.log(`自有域名: ${rules.own.length} 个\n`)

  // 2. 读全量联系人邮箱，按 contact_id 归堆
  const emailsByContact = new Map<string, string[]>()
  const { data: identities } = await supabaseAdmin
    .from('contact_identities')
    .select('contact_id, value')
    .eq('client_id', clientId)
    .eq('kind', 'email')
    .order('created_at', { ascending: true })

  for (const row of identities ?? []) {
    const email = (row.value as string | null)?.trim()
    if (!email) continue
    const cid = row.contact_id as string
    const list = emailsByContact.get(cid)
    if (list) list.push(email)
    else emailsByContact.set(cid, [email])
  }

  // 3. 找出同行联系人
  const tradeContactIds = new Set<string>()
  for (const [contactId, emails] of emailsByContact) {
    if (contactKindOf(emails, rules) === 'trade') {
      tradeContactIds.add(contactId)
    }
  }
  console.log(`同行联系人: ${tradeContactIds.size} 个\n`)

  if (tradeContactIds.size === 0) {
    console.log('没有同行联系人，无需回填。')
    return
  }

  // 4. 找这些联系人的所有邮件对话
  const { data: convRows } = await supabaseAdmin
    .from('conversations')
    .select('id, conversation_id, contact_id, subject')
    .eq('client_id', clientId)
    .eq('channel', 'email')
    .in('contact_id', Array.from(tradeContactIds))

  const conversations = (convRows ?? []) as ConvRow[]
  console.log(`邮件对话: ${conversations.length} 个\n`)

  let totalExtracted = 0
  let totalConversationsProcessed = 0
  let totalSkipped = 0

  // 5. 逐条对话处理
  for (const conv of conversations) {
    if (!conv.contact_id) {
      totalSkipped++
      continue
    }

    // 读这条对话的所有消息
    const { data: msgRows } = await supabaseAdmin
      .from('conversation_messages')
      .select('direction, body, sent_at, sender_name')
      .eq('conversation_id', conv.id)
      .order('sent_at', { ascending: true })

    const messages = (msgRows ?? []) as MsgRow[]
    const inbound = messages
      .filter((m) => m.direction === 'inbound')
      .slice(-20) // 跟 runAgentCustomerHook 一样只取最近 20 封

    if (inbound.length === 0) {
      totalSkipped++
      continue
    }

    const latestInbound = inbound[inbound.length - 1]
    const latestInboundAt = latestInbound.sent_at
    const latestInboundSummary =
      conv.subject ?? (latestInbound.body ?? '').slice(0, 120) ?? null

    // AI 提取 — conversation_id 用 conversations.id（UUID 主键），
    // 不是 conversations.conversation_id（线程文本标识如 mail:AAQ…）。
    // 跟 runAgentCustomerHook 里 stored.conversationId 一致。
    const result = await extractAgentCustomers({
      clientId,
      agentContactId: conv.contact_id,
      conversationId: conv.id,
      emails: inbound.map((m) => ({
        subject: conv.subject,
        bodyPreview: m.body,
        direction: m.direction as 'inbound' | 'outbound',
        occurredAt: m.sent_at,
      })),
    })

    totalConversationsProcessed++

    if (result.customers.length === 0) {
      if (result.reason) {
        console.log(
          `  [跳过] ${conv.subject ?? '(无主题)'} → ${result.reason}`,
        )
      }
      continue
    }

    const agentEmail = emailsByContact.get(conv.contact_id)?.[0] ?? '?'
    console.log(
      `  [提取] ${agentEmail} | ${conv.subject ?? '(无主题)'} → ${result.customers.length} 个客户`,
    )

    for (const customer of result.customers) {
      if (!customer.customerName) continue

      console.log(
        `         - ${customer.customerName}` +
          (customer.pax != null ? ` (${customer.pax}人)` : '') +
          (customer.tripType ? ` ${customer.tripType}` : '') +
          (customer.travelDates ? ` ${customer.travelDates}` : '') +
          (customer.suspicious ? ' ⚠️ suspicious' : ''),
      )

      if (live) {
        const payload: Record<string, unknown> = {
          client_id: clientId,
          agent_contact_id: conv.contact_id,
          conversation_id: conv.id,
          customer_name: customer.customerName,
          last_contact_at: latestInboundAt,
          last_contact_summary: latestInboundSummary,
          updated_at: new Date().toISOString(),
        }
        if (customer.pax != null) payload.pax = customer.pax
        if (customer.tripType != null) payload.trip_type = customer.tripType
        if (customer.travelDates != null)
          payload.travel_dates = customer.travelDates
        if (customer.specificNeeds != null)
          payload.specific_needs = customer.specificNeeds
        if (customer.suspicious === true) payload.needs_review = true

        const { error } = await supabaseAdmin
          .from('agent_customers')
          .upsert(payload, {
            onConflict:
              'client_id,agent_contact_id,conversation_id,customer_name',
          })

        if (error) {
          console.error(`         ❌ UPSERT 失败: ${error.message}`)
        }
      }
      totalExtracted++
    }

    // 每条对话之间等一下，别打爆 OpenAI rate limit
    await new Promise((r) => setTimeout(r, BATCH_DELAY_MS))
  }

  console.log(`\n=== 回填完成 ===`)
  console.log(`处理对话: ${totalConversationsProcessed}`)
  console.log(`跳过: ${totalSkipped}`)
  console.log(`提取客户: ${totalExtracted}`)
  if (!live) {
    console.log(`\n以上是 dry-run 结果。加 --live 参数真正写库。`)
  }
}

main().catch((err) => {
  console.error('脚本失败:', err)
  process.exit(1)
})
