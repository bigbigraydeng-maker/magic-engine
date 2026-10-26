/**
 * Graph 190、403/#200（主页上没有被批准的角色）、unverified_shared_token
 * 再试也不会好。标掉这条连接（已有行就用 status=error），没有行就记一条暂停，
 * 之后的每小时同步直接跳过，直到重新「连接 Meta」把暂停清掉。
 *
 * 待办走现成的两条：有连接行的由平台授权待办读 status=error；
 * 没有连接行、又不是「绑定没核实」（那条已有自己的待办）的，由
 * `pm-todo/broken-page-hold-items.ts` 下发。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isKernelNotProvisioned } from '@/lib/kernel-approval/errors'
import { CONNECTION_STATUS } from '@/lib/platform-oauth/vocabulary'

export type BrokenPageTokenKind = 'graph_190' | 'missing_page_role' | 'unverified_shared_token'

const CODE_190 = /code"?\s*[:=]\s*190\b|\(#190\)/
const CODE_200 = /code"?\s*[:=]\s*200\b|\(#200\)/
// 只认「主页上没有被批准的角色 / pages_*」。不能把所有带 permission 的 403
// 都算进来 —— `(#278) Requires leads_retrieval permission` 是另一回事。
const HTTP_403_ROLE = /HTTP\s+403\b[\s\S]{0,240}(approved role|page role|\brole\b|pages_)/i

function classifyOne(part: string): BrokenPageTokenKind | null {
  if (part.includes('unverified_shared_token')) return 'unverified_shared_token'
  if (CODE_190.test(part)) return 'graph_190'
  if (CODE_200.test(part) || HTTP_403_ROLE.test(part)) return 'missing_page_role'
  return null
}

/**
 * 多段用 ` | ` 拼在一起时，每一段都得是同一类坏令牌才算。
 * 混进一条真错误（500、代码异常）就返回 null，不能让 190 把它们一起吞掉。
 */
export function classifyBrokenPageToken(error: string | null | undefined): BrokenPageTokenKind | null {
  if (!error) return null
  const parts = error.split(' | ').map((part) => part.trim()).filter((part) => part.length > 0)
  if (parts.length === 0) return null
  const kinds = parts.map(classifyOne)
  if (kinds.some((kind) => kind == null)) return null
  return kinds[0]
}

/** 已知要等人重连的失败，不能再把整轮跑涂成失败。 */
export function isSkippablePageTokenFailure(input: {
  error?: string | null
  skipped?: string | null
}): boolean {
  if (input.skipped === 'connection_unhealthy') return true
  const error = input.error ?? ''
  if (error === 'connection_unhealthy' || error.startsWith('connection_unhealthy:')) return true
  return classifyBrokenPageToken(error) != null
}

export async function metaPageSyncHeld(
  supabase: SupabaseClient,
  clientId: string,
  pageId: string,
): Promise<boolean> {
  try {
    const connection = await supabase
      .from('platform_oauth_connections')
      .select('id')
      .eq('client_id', clientId)
      .eq('provider', 'meta')
      .eq('account_id', pageId)
      .in('status', [CONNECTION_STATUS.ERROR, CONNECTION_STATUS.EXPIRED])
    if (!connection.error && (connection.data?.length ?? 0) > 0) return true

    const hold = await supabase
      .from('meta_page_sync_holds')
      .select('page_id')
      .eq('client_id', clientId)
      .eq('page_id', pageId)
    if (hold.error) {
      if (!isKernelNotProvisioned(hold.error)) {
        console.error('[broken-page-token] hold read failed:', hold.error.message)
      }
      return false
    }
    return (hold.data?.length ?? 0) > 0
  } catch (err) {
    console.error('[broken-page-token] hold check failed:', err instanceof Error ? err.message : String(err))
    return false
  }
}

export async function quarantineBrokenPageToken(
  supabase: SupabaseClient,
  input: { clientId: string; pageId: string; kind: BrokenPageTokenKind; error: string },
): Promise<{ markedConnection: boolean; held: boolean }> {
  const errorMessage = `${input.kind}: ${input.error}`.slice(0, 500)
  const updated = await supabase
    .from('platform_oauth_connections')
    .update({
      status: CONNECTION_STATUS.ERROR,
      error_message: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq('client_id', input.clientId)
    .eq('provider', 'meta')
    .eq('account_id', input.pageId)
    .eq('status', CONNECTION_STATUS.ACTIVE)
    .select('id')

  if (updated.error) console.error('[broken-page-token] mark unhealthy failed:', updated.error.message)
  if ((updated.data?.length ?? 0) > 0) return { markedConnection: true, held: false }

  const already = await supabase
    .from('platform_oauth_connections')
    .select('id')
    .eq('client_id', input.clientId)
    .eq('provider', 'meta')
    .eq('account_id', input.pageId)
    .in('status', [CONNECTION_STATUS.ERROR, CONNECTION_STATUS.EXPIRED])
  if ((already.data?.length ?? 0) > 0) return { markedConnection: false, held: false }

  const inserted = await supabase.from('meta_page_sync_holds').upsert(
    {
      client_id: input.clientId,
      page_id: input.pageId,
      reason: input.kind,
      error_message: errorMessage,
    },
    { onConflict: 'client_id,page_id' },
  )
  if (inserted.error) {
    if (!isKernelNotProvisioned(inserted.error)) {
      console.error('[broken-page-token] hold insert failed:', inserted.error.message)
    }
    return { markedConnection: false, held: false }
  }
  return { markedConnection: false, held: true }
}

export async function rememberBrokenPageToken(
  supabase: SupabaseClient,
  clientId: string,
  pageId: string,
  error: string | undefined,
): Promise<void> {
  const kind = classifyBrokenPageToken(error)
  if (!kind) return
  try {
    await quarantineBrokenPageToken(supabase, { clientId, pageId, kind, error: error ?? kind })
  } catch (err) {
    console.error('[broken-page-token] quarantine failed:', err instanceof Error ? err.message : String(err))
  }
}

/** 重新连接 Meta 时清掉暂停，下一轮同步才准再打 Graph。 */
export async function clearMetaPageSyncHold(
  supabase: SupabaseClient,
  clientId: string,
  pageId: string,
): Promise<void> {
  const { error } = await supabase
    .from('meta_page_sync_holds')
    .delete()
    .eq('client_id', clientId)
    .eq('page_id', pageId)
  if (error && !isKernelNotProvisioned(error)) {
    console.error('[broken-page-token] clear hold failed:', error.message)
  }
}
