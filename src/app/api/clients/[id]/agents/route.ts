import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { clientHasIndustryFeature } from '@/lib/clients/industry-guard'
import { supabaseAdmin } from '@/lib/supabase'
import {
  contactKindOf,
  EMPTY_RULES,
  readDomainRules,
  type DomainRules,
} from '@/lib/crm/contact-kind'

type Context = { params: Promise<{ id: string }> }

interface AgentCustomerRow {
  id: string
  agent_contact_id: string
  customer_name: string | null
  pax: number | null
  trip_type: string | null
  travel_dates: string | null
  specific_needs: string | null
  stage: string
  last_contact_at: string | null
  last_contact_summary: string | null
  conversation_id: string | null
  notes: string | null
  updated_at: string
}

interface ContactRow {
  id: string
  display_name: string | null
}

interface IdentityRow {
  contact_id: string
  value: string | null
}

interface AgentCustomerPayload {
  id: string
  customerName: string | null
  pax: number | null
  tripType: string | null
  travelDates: string | null
  specificNeeds: string | null
  stage: string
  lastContactAt: string | null
  lastContactSummary: string | null
  conversationId: string | null
  notes: string | null
  updatedAt: string
}

interface AgentPayload {
  contactId: string
  displayName: string | null
  primaryEmail: string | null
  lastContactAt: string | null
  customerCount: number
  customers: AgentCustomerPayload[]
}

/** 读这个客户的域名规则。读不到就当没配 —— 一个坏配置不该让整页打不开。 */
async function loadDomainRules(id: string): Promise<DomainRules> {
  try {
    const { data: clientRow } = await supabaseAdmin
      .from('clients')
      .select('leads_config')
      .eq('id', id)
      .maybeSingle()
    return readDomainRules(clientRow?.leads_config ?? null)
  } catch {
    return EMPTY_RULES
  }
}

/**
 * 这个客户名下所有邮箱身份，按 contact_id 归堆。
 *
 * 一次查全量、不按 id 过滤：要先知道谁是谁，才能判谁是同行。
 * 保持插入顺序（created_at 升序），所以每组第一个就是主邮箱。
 */
async function loadEmailsByContact(id: string): Promise<Map<string, string[]>> {
  const byContact = new Map<string, string[]>()
  const { data: identityRows } = await supabaseAdmin
    .from('contact_identities')
    .select('contact_id, value')
    .eq('client_id', id)
    .eq('kind', 'email')
    .order('created_at', { ascending: true })

  for (const row of (identityRows ?? []) as IdentityRow[]) {
    const value = row.value?.trim()
    if (!value) continue
    const list = byContact.get(row.contact_id)
    if (list) list.push(value)
    else byContact.set(row.contact_id, [value])
  }
  return byContact
}

/** 按 agent_contact_id 把客户行归堆。 */
function groupCustomers(rows: AgentCustomerRow[]): Map<string, AgentCustomerRow[]> {
  const grouped = new Map<string, AgentCustomerRow[]>()
  for (const row of rows) {
    const list = grouped.get(row.agent_contact_id)
    if (list) list.push(row)
    else grouped.set(row.agent_contact_id, [row])
  }
  return grouped
}

/** 把一行 agent_customers 映射成前端用的 camelCase 形状。 */
function toCustomerPayload(row: AgentCustomerRow): AgentCustomerPayload {
  return {
    id: row.id,
    customerName: row.customer_name,
    pax: row.pax,
    tripType: row.trip_type,
    travelDates: row.travel_dates,
    specificNeeds: row.specific_needs,
    stage: row.stage,
    lastContactAt: row.last_contact_at,
    lastContactSummary: row.last_contact_summary,
    conversationId: row.conversation_id,
    notes: row.notes,
    updatedAt: row.updated_at,
  }
}

/** 组装一个 agent：最后联系时间取名下客户里最新的那条。 */
function buildAgent(
  contactId: string,
  rows: AgentCustomerRow[],
  displayName: string | null,
  primaryEmail: string | null,
): AgentPayload {
  const lastContactAt = rows.reduce<string | null>((acc, row) => {
    if (!row.last_contact_at) return acc
    if (!acc) return row.last_contact_at
    return row.last_contact_at > acc ? row.last_contact_at : acc
  }, null)
  return {
    contactId,
    displayName,
    primaryEmail,
    lastContactAt,
    customerCount: rows.length,
    customers: rows.map(toCustomerPayload),
  }
}

/** 一次查全量联系人名字，按 id 归堆。 */
async function loadDisplayNames(
  id: string,
  agentIds: string[],
): Promise<Map<string, string | null>> {
  const { data: contactRows } = await supabaseAdmin
    .from('contacts')
    .select('id, display_name')
    .eq('client_id', id)
    .in('id', agentIds)

  const contacts = (contactRows ?? []) as ContactRow[]
  return new Map(contacts.map((row) => [row.id, row.display_name]))
}

/** 有客户的排前面（按最后联系倒序），没客户的按名字排，没名字的垫底。 */
function sortAgents(agents: AgentPayload[]): AgentPayload[] {
  return agents.sort((a, b) => {
    const aHas = a.customerCount > 0
    const bHas = b.customerCount > 0
    if (aHas !== bHas) return aHas ? -1 : 1
    if (aHas && bHas) {
      if (!a.lastContactAt) return 1
      if (!b.lastContactAt) return -1
      return a.lastContactAt < b.lastContactAt ? 1 : -1
    }
    if (!a.displayName) return 1
    if (!b.displayName) return -1
    return a.displayName.localeCompare(b.displayName)
  })
}

export async function GET(_req: Request, { params }: Context) {
  const { id } = await params
  const access = await requirePaidClientAccess(id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  // 纵深防御：页面已经有服务端闸，这里再挡一次直接敲 API 的情况 —— 只藏页面不够。
  if (!(await clientHasIndustryFeature(id, 'agents'))) {
    return NextResponse.json({ error: '这个功能不适用于你的业务' }, { status: 403 })
  }

  try {
    const rules = await loadDomainRules(id)
    const emailsByContact = await loadEmailsByContact(id)

    // 同行 = 邮箱域名命中同行清单的联系人。这是这一页的主干 ——
    // 以前从 agent_customers 出发，没客户行就整页空白（生产事故）。
    const tradeContactIds = Array.from(emailsByContact.entries())
      .filter(([, emails]) => contactKindOf(emails, rules) === 'trade')
      .map(([contactId]) => contactId)

    const { data: customerRows, error: customerError } = await supabaseAdmin
      .from('agent_customers')
      .select(
        'id, agent_contact_id, customer_name, pax, trip_type, travel_dates, specific_needs, stage, last_contact_at, last_contact_summary, conversation_id, notes, updated_at',
      )
      .eq('client_id', id)
      .order('last_contact_at', { ascending: false, nullsFirst: false })

    if (customerError) {
      return NextResponse.json({ error: 'Could not load agent customers.' }, { status: 500 })
    }

    const grouped = groupCustomers((customerRows ?? []) as AgentCustomerRow[])

    // 并集：同行联系人 + 已有客户行的 agent。域名清单后来被删掉时，
    // 已经落库的客户不会跟着消失。
    const agentIds = Array.from(new Set([...tradeContactIds, ...grouped.keys()]))

    if (agentIds.length === 0) {
      return NextResponse.json({ agents: [] })
    }

    const displayNameById = await loadDisplayNames(id, agentIds)

    const agents: AgentPayload[] = agentIds.map((contactId) =>
      buildAgent(
        contactId,
        grouped.get(contactId) ?? [],
        displayNameById.get(contactId) ?? null,
        emailsByContact.get(contactId)?.[0] ?? null,
      ),
    )

    return NextResponse.json({ agents: sortAgents(agents) })
  } catch {
    return NextResponse.json({ error: 'Could not load agents. Try again.' }, { status: 500 })
  }
}
