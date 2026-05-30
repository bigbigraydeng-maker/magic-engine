import { NextResponse } from 'next/server'
import { guardAdmin } from '@/lib/auth/require-admin'

const CF_ACCOUNT_ID = 'bbd84393da8e5707ba617749dc17117c'
const CF_GATEWAY_ID = 'magic-engine'
const CF_BASE = 'https://api.cloudflare.com/client/v4'

export async function GET(request: Request) {
  const guard = await guardAdmin()
  if (guard) return guard

  const token = process.env.CLOUDFLARE_MGMT_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'CLOUDFLARE_MGMT_TOKEN not configured' }, { status: 500 })
  }

  const { searchParams } = new URL(request.url)
  const page = searchParams.get('page') ?? '1'
  const perPage = searchParams.get('per_page') ?? '100'

  const url = [
    `${CF_BASE}/accounts/${CF_ACCOUNT_ID}/ai-gateway/gateways/${CF_GATEWAY_ID}/logs`,
    `?per_page=${perPage}&page=${page}&order_by=created_at&direction=desc`,
  ].join('')

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ error: `CF API ${res.status}: ${text}` }, { status: 502 })
  }

  const data = await res.json()
  return NextResponse.json(data)
}
