import { NextResponse } from 'next/server'

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'Password resets are handled by a Magic Engine administrator.' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  )
}
