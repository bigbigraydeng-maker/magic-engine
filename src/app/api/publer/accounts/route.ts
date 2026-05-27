import { NextResponse } from 'next/server'
import { getAccounts } from '@/lib/publer/client'
import { requireSession } from '@/lib/auth/require-session'

export async function GET() {
  const session = await requireSession()
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status })
  }

  try {
    const accounts = await getAccounts()
    return NextResponse.json({ accounts })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
