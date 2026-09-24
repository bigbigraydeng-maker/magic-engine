import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { isValidStage } from '@/lib/crm/agent-customer-stages'
import { contactKindOf, readDomainRules } from '@/lib/crm/contact-kind'

type Context = { params: Promise<{ id: string }> }

const createSchema = z.object({
  agentContactId: z.string().uuid(),
  customerName: z.string().min(1).max(200),
  pax: z.number().int().positive().nullable().optional(),
  tripType: z.string().nullable().optional(),
  travelDates: z.string().nullable().optional(),
  specificNeeds: z.string().nullable().optional(),
  stage: z.string().optional(),
  notes: z.string().nullable().optional(),
  conversationId: z.string().uuid().nullable().optional(),
})

const updateSchema = z.object({
  stage: z.string().optional(),
  notes: z.string().nullable().optional(),
  customerName: z.string().min(1).max(200).optional(),
  pax: z.number().int().positive().nullable().optional(),
  tripType: z.string().nullable().optional(),
  travelDates: z.string().nullable().optional(),
  specificNeeds: z.string().nullable().optional(),
})

export async function POST(req: Request, { params }: Context) {
  const { id } = await params
  const access = await requirePaidClientAccess(id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let parsed: z.infer<typeof createSchema>
  try {
    parsed = createSchema.parse(await req.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const stage = parsed.stage ?? 'new'
  if (!isValidStage(stage)) {
    return NextResponse.json({ error: 'Invalid stage.' }, { status: 400 })
  }

  // 校验 agentContactId 属于这个 client_id 名下、且是 trade 类。
  // 不校验的话，调用方可以拿别的客户的 contact id 建行，或者把散客当 Agent。
  const { data: contactRow } = await supabaseAdmin
    .from('contacts')
    .select('id')
    .eq('id', parsed.agentContactId)
    .eq('client_id', id)
    .maybeSingle()
  if (!contactRow) {
    return NextResponse.json({ error: '找不到这个联系人' }, { status: 400 })
  }

  // kind 是按域名算出来的，不存表（见 contact-kind.ts）—— 读这个 contact 的
  // 邮箱，再按域名规则判。读法参考 mail-ingest.ts 的 findContactByEmail。
  const { data: identityRows } = await supabaseAdmin
    .from('contact_identities')
    .select('value')
    .eq('client_id', id)
    .eq('contact_id', parsed.agentContactId)
    .eq('kind', 'email')
  const emails = (identityRows ?? []).map((r) => r.value as string)

  let rules
  try {
    const { data: clientRow } = await supabaseAdmin
      .from('clients')
      .select('leads_config')
      .eq('id', id)
      .maybeSingle()
    rules = readDomainRules(clientRow?.leads_config ?? null)
  } catch {
    rules = { own: [], trade: [] }
  }

  if (contactKindOf(emails, rules) !== 'trade') {
    return NextResponse.json({ error: '不是同行 Agent' }, { status: 400 })
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('agent_customers')
      .insert({
        client_id: id,
        agent_contact_id: parsed.agentContactId,
        customer_name: parsed.customerName,
        pax: parsed.pax ?? null,
        trip_type: parsed.tripType ?? null,
        travel_dates: parsed.travelDates ?? null,
        specific_needs: parsed.specificNeeds ?? null,
        stage,
        notes: parsed.notes ?? null,
        conversation_id: parsed.conversationId ?? null,
      })
      .select('*')
      .single()

    if (error || !data) {
      return NextResponse.json({ error: 'Could not create agent customer.' }, { status: 500 })
    }
    return NextResponse.json(data, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Could not create agent customer.' }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: Context) {
  const { id } = await params
  const access = await requirePaidClientAccess(id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const qid = new URL(req.url).searchParams.get('id')
  if (!qid) return NextResponse.json({ error: 'Missing id.' }, { status: 400 })

  let parsed: z.infer<typeof updateSchema>
  try {
    parsed = updateSchema.parse(await req.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (parsed.stage !== undefined && !isValidStage(parsed.stage)) {
    return NextResponse.json({ error: 'Invalid stage.' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (parsed.stage !== undefined) patch.stage = parsed.stage
  if (parsed.notes !== undefined) patch.notes = parsed.notes
  if (parsed.customerName !== undefined) patch.customer_name = parsed.customerName
  if (parsed.pax !== undefined) patch.pax = parsed.pax
  if (parsed.tripType !== undefined) patch.trip_type = parsed.tripType
  if (parsed.travelDates !== undefined) patch.travel_dates = parsed.travelDates
  if (parsed.specificNeeds !== undefined) patch.specific_needs = parsed.specificNeeds

  try {
    const { data, error } = await supabaseAdmin
      .from('agent_customers')
      .update(patch)
      .eq('id', qid)
      .eq('client_id', id)
      .select('*')
      .single()

    if (error || !data) {
      return NextResponse.json({ error: 'Could not update agent customer.' }, { status: 404 })
    }
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Could not update agent customer.' }, { status: 500 })
  }
}
