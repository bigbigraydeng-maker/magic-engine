/**
 * Social comment auto-reply — permission probe (PR-0, read-only).
 *
 * GET → verifies the Meta setup for this client WITHOUT sending anything:
 *   - resolves the client's Meta token + Page access token
 *   - lists granted permissions (pages_read_engagement / pages_manage_engagement
 *     / pages_messaging) via /me/permissions
 *   - does a live READ of the newest post's comments to prove read access works
 *
 * Backs the "检查 Meta 权限" button so FDE/PM can confirm scopes before enabling,
 * instead of finding out via silent cron no-ops. Never writes to Facebook.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { fetchPagePosts } from '@/lib/meta/page-posts'
import { authorizeConfiguredPage } from '@/lib/meta/page-sync-authorization'
import { fetchPostCommentsResult } from '@/lib/meta/comments'

const GRAPH_BASE = 'https://graph.facebook.com/v20.0'
// pages_read_user_content 是读**别人写的**评论要的那一条；少了它，这个功能
// 看起来在跑，实际每个帖子都被 Meta 挡在 #10（2026-08-15 生产实测）。
const REQUIRED_SCOPES = [
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_engagement',
  'pages_messaging',
] as const

interface ProbeResult {
  token_resolved: boolean
  page_id: string | null
  page_token_resolved: boolean
  permissions: Record<string, boolean>   // scope → granted
  live_read_ok: boolean
  sample_post_id: string | null
  sample_comment_count: number | null
  ready: boolean                         // all three scopes + live read
  notes: string[]
}

async function fetchGrantedScopes(userToken: string): Promise<Record<string, boolean> | null> {
  try {
    const res = await fetch(`${GRAPH_BASE}/me/permissions?access_token=${encodeURIComponent(userToken)}`)
    if (!res.ok) return null
    const body = (await res.json()) as { data?: Array<{ permission: string; status: string }> }
    const granted: Record<string, boolean> = {}
    for (const scope of REQUIRED_SCOPES) {
      granted[scope] = (body.data ?? []).some(p => p.permission === scope && p.status === 'granted')
    }
    return granted
  } catch {
    return null
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const notes: string[] = []

  const userToken = await getMetaTokenForClient(clientId)
  if (!userToken) {
    return NextResponse.json({
      token_resolved: false, page_id: null, page_token_resolved: false,
      permissions: {}, live_read_ok: false, sample_post_id: null, sample_comment_count: null,
      ready: false, notes: ['未找到该客户的 Meta token（检查 META_SYSTEM_USER_TOKEN 环境变量）'],
    } satisfies ProbeResult)
  }

  const { data: config } = await supabaseAdmin
    .from('social_comment_config')
    .select('fb_page_id')
    .eq('client_id', clientId)
    .maybeSingle()
  const pageId = (config?.fb_page_id as string) || null

  const result: ProbeResult = {
    token_resolved: true, page_id: pageId, page_token_resolved: false,
    permissions: {}, live_read_ok: false, sample_post_id: null, sample_comment_count: null,
    ready: false, notes,
  }

  const granted = await fetchGrantedScopes(userToken)
  if (granted) {
    result.permissions = granted
    for (const scope of REQUIRED_SCOPES) {
      if (!granted[scope]) notes.push(`缺少 scope：${scope}`)
    }
  } else {
    notes.push('无法读取权限列表（/me/permissions）——可能是 System User token，此时以实测读取为准')
  }

  if (!pageId) {
    notes.push('尚未在配置里填 Facebook 主页 ID —— 先填 Page ID 再验证')
    return NextResponse.json(result)
  }

  // AD-SEC-4: the configured Page is client-editable — never read it unless it is
  // this client's verified Page (see page-sync-authorization.authorizeConfiguredPage).
  const auth = await authorizeConfiguredPage(supabaseAdmin, clientId, pageId, process.env)
  if (!auth.ok && auth.skipped === 'page_not_verified') {
    notes.push('这里填的主页不是这个客户已核实绑定的 Facebook 主页，不会去读 —— 请团队在「Facebook 主页」卡片里核实绑定，或用主页管理员账号「连接 Meta」')
    return NextResponse.json(result)
  }
  const pageToken = auth.ok ? auth.pageToken : null
  result.page_token_resolved = pageToken !== null
  if (!pageToken) {
    notes.push('无法解析 Page access token —— 确认该 token 管理此 Page（/me/accounts 未返回该 page_id）')
    return NextResponse.json(result)
  }

  try {
    const posts = await fetchPagePosts(pageId, pageToken, 1)
    if (posts.length > 0) {
      // 用 fullId（`<主页id>_<帖子id>`）：给裸 id 时 Graph 会当成老式 status
      // 对象、直接回 #12，那是端点用错了，不是权限问题。
      result.sample_post_id = posts[0].fullId
      const read = await fetchPostCommentsResult(posts[0].fullId, pageId, pageToken, 5)
      // 🔴 读失败不能记成 live_read_ok=true。此前这里无论 Meta 回什么都往下走，
      //    于是「检查 Meta 权限」按钮在权限缺失时照样显示 ✅ 就绪 —— 这个探针
      //    存在的意义就是别让人靠 cron 静默空转才发现问题。
      result.live_read_ok = read.ok
      result.sample_comment_count = read.ok ? read.comments.length : null
      if (!read.ok) {
        notes.push(`实测读取评论失败（${read.failure.reason}）：${read.failure.message}`)
      }
    } else {
      result.live_read_ok = true
      result.sample_comment_count = 0
      notes.push('主页近期无帖子可读（读取本身成功）')
    }
  } catch (err) {
    notes.push(`实测读取评论失败：${err instanceof Error ? err.message : '未知错误'}`)
  }

  result.ready =
    result.page_token_resolved &&
    result.live_read_ok &&
    REQUIRED_SCOPES.every(s => result.permissions[s] !== false) // unknown (System User) counts as not-blocking

  if (result.ready) notes.push('✅ 就绪：token + Page + 读取权限已验证。回帖/私信权限以真实发送为准。')

  return NextResponse.json(result)
}
