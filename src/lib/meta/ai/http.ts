import { NextResponse } from 'next/server'
import { extractBearer, verifyApiKey } from '@/lib/auth/api-key-access'
import { requireOnboardingClientAccess } from '@/lib/auth/client-access'
import { MetaReadError } from '../graph-read'
import { enabled } from './contract'
import { requireMetaScope } from './store'
export function json(data: unknown, status=200) { return NextResponse.json(data,{ status,headers:{ 'Cache-Control':'no-store' } }) }
export function failure(error: unknown) { return json({ error:error instanceof MetaReadError ? error.code : 'request_failed' },error instanceof MetaReadError ? error.status : 500) }
export function checkEnabled() { if (!enabled()) throw new MetaReadError('not_available',404) }
export function checkOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (!configured || request.headers.get('origin') !== new URL(configured).origin) throw new MetaReadError('origin_required',403)
}
export async function dashboardAccess(clientId: string) {
  checkEnabled()
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) throw new MetaReadError('invalid_client',400)
  const access = await requireOnboardingClientAccess(clientId)
  if (!access.ok) throw new MetaReadError(access.error,access.status)
  return access
}
export async function apiPrincipal(request: Request) {
  checkEnabled()
  const result = await verifyApiKey(extractBearer(request.headers.get('authorization')),{ expectedKind:'client' })
  if (!result.ok || result.auth.kind !== 'client') throw new MetaReadError('unauthorised',401)
  requireMetaScope(result.auth)
  return result.auth
}
export async function boundedBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) throw new MetaReadError('invalid_json')
  const decoder = new TextDecoder()
  let text = '', bytes = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    bytes += chunk.value.byteLength
    if (bytes > 24000) { await reader.cancel(); throw new MetaReadError('request_too_large',413) }
    text += decoder.decode(chunk.value,{ stream:true })
  }
  text += decoder.decode()
  try { return JSON.parse(text) as unknown } catch { throw new MetaReadError('invalid_json') }
}
