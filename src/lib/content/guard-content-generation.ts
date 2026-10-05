import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { isUuid } from '@/lib/validation-utils'

export interface ContentGenerationGuardInput {
  client_id: unknown
  execution_item_id?: unknown
  production_package_id?: unknown
}

function fail(status: number, error: string): NextResponse {
  return NextResponse.json({ success: false, error }, { status })
}

function isValidLowercaseUuid(value: unknown): value is string {
  return isUuid(value) && value === value.toLowerCase()
}

/**
 * Shared guard for content-generation POST handlers. Authenticates the caller,
 * verifies the named client belongs to them (paid access), and verifies any
 * referenced execution_item / production_package rows belong to that same
 * client. Returns null when the caller may proceed, otherwise the response to
 * return immediately.
 */
export async function guardContentGeneration(
  input: ContentGenerationGuardInput,
): Promise<NextResponse | null> {
  try {
    const { client_id, execution_item_id, production_package_id } = input

    if (!isValidLowercaseUuid(client_id)) {
      return fail(400, 'client_id must be a lowercase UUID')
    }

    const access = await requirePaidClientAccess(client_id)
    if (!access.ok) {
      return NextResponse.json(
        { success: false, error: access.error, reason: access.reason },
        { status: access.status },
      )
    }

    const optionalIds: Array<{ field: string; value: unknown; table: string }> = [
      { field: 'execution_item_id', value: execution_item_id, table: 'execution_items' },
      { field: 'production_package_id', value: production_package_id, table: 'production_packages' },
    ]

    for (const { field, value, table } of optionalIds) {
      if (value === undefined || value === null) continue

      if (!isValidLowercaseUuid(value)) {
        return fail(400, `${field} must be a lowercase UUID`)
      }

      const { data, error } = await supabaseAdmin
        .from(table)
        .select('id')
        .eq('id', value)
        .eq('client_id', client_id)
        .maybeSingle()

      if (error) return fail(500, 'Authorization check failed')
      if (data === null) return fail(403, 'Forbidden')
    }

    return null
  } catch (err) {
    console.error('[content-guard]', err)
    return fail(500, 'Authorization check failed')
  }
}
