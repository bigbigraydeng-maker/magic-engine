import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

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

export async function GET(_req: Request, { params }: Context) {
  const { id } = await params
  const access = await requirePaidClientAccess(id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
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

    const customers = (customerRows ?? []) as AgentCustomerRow[]
    const agentContactIds = Array.from(new Set(customers.map((row) => row.agent_contact_id)))

    if (agentContactIds.length === 0) {
      return NextResponse.json({ agents: [] })
    }

    const { data: contactRows } = await supabaseAdmin
      .from('contacts')
      .select('id, display_name')
      .in('id', agentContactIds)

    const contacts = (contactRows ?? []) as ContactRow[]
    const displayNameById = new Map(contacts.map((row) => [row.id, row.display_name]))

    const emailById = new Map<string, string | null>()
    try {
      const { data: identityRows } = await supabaseAdmin
        .from('contact_identities')
        .select('contact_id, value')
        .in('contact_id', agentContactIds)
        .eq('kind', 'email')
        .order('created_at', { ascending: true })
      for (const row of (identityRows ?? []) as IdentityRow[]) {
        if (!emailById.has(row.contact_id)) emailById.set(row.contact_id, row.value)
      }
    } catch {
      // contact_identities shape may differ; email is best-effort.
    }

    const grouped = new Map<string, AgentCustomerRow[]>()
    for (const row of customers) {
      const list = grouped.get(row.agent_contact_id)
      if (list) list.push(row)
      else grouped.set(row.agent_contact_id, [row])
    }

    const agents = Array.from(grouped.entries()).map(([contactId, rows]) => {
      const lastContactAt = rows.reduce<string | null>((acc, row) => {
        if (!row.last_contact_at) return acc
        if (!acc) return row.last_contact_at
        return row.last_contact_at > acc ? row.last_contact_at : acc
      }, null)
      return {
        contactId,
        displayName: displayNameById.get(contactId) ?? null,
        primaryEmail: emailById.get(contactId) ?? null,
        lastContactAt,
        customerCount: rows.length,
        customers: rows.map((row) => ({
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
        })),
      }
    })

    agents.sort((a, b) => {
      if (!a.lastContactAt) return 1
      if (!b.lastContactAt) return -1
      return a.lastContactAt < b.lastContactAt ? 1 : -1
    })

    return NextResponse.json({ agents })
  } catch {
    return NextResponse.json({ error: 'Could not load agents. Try again.' }, { status: 500 })
  }
}
