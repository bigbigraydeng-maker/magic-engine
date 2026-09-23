import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAccounts, uploadMediaFromUrl, schedulePost } from '@/lib/publer/client'
import { getAdapter } from '@/lib/flywheel/adapters/registry'
import { SOCIAL_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import { judgeOutgoingPost, priceGateMessage } from '@/lib/content/price-claim-gate'
import { needsHumanReview } from '@/lib/content/guard-receipt'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import '@/lib/flywheel/adapters/SocialContentAdapter'

// POST /api/publer/create-post
// 用 post_id 找最新 ready 素材，自动选第一个匹配平台的 Publer 账号，排期发布。
//
// Auth: 登录态、对该 post 所属客户有权限、且是**付费档**（paid_client 或 admin）。
// 这是一条付费发布能力，挂在 ME 鉴权、租户绑定的驾驶舱控制面背后。
//
// #1149：这条接口原先无鉴权——任何人拿一个 post_id 就能把该客户的成片发到他的
// 社媒账号。历史上曾设想它被 Zapier/Airtable webhook 调用，故一度补过 Bearer
// token 旁路；但 docs/STATE.md、docs/DECISIONS.md 记录 Zapier/Airtable 自动化链路
// 已完全退役、审核已搬进 ME 驾驶舱，仓库里唯一的活跃调用方是 dashboard/content
// 页面的登录态请求。据此收窄：每个请求都必须走付费档客户权限校验，授权绑定到
// resolved post.client_id，光有 post_id 不算授权。Publer 只是这条控制面背后一个
// 可替换的发布适配器。
export async function POST(req: NextRequest) {
  try {
    const { post_id, schedule_at } = await req.json()
    if (!post_id) {
      return NextResponse.json({ success: false, error: 'post_id required' }, { status: 400 })
    }

    const { data: post } = await supabaseAdmin
      .from('content_posts')
      .select('id, client_id, caption, script, hashtags, platforms, status, generation_context_snapshot')
      .eq('id', post_id)
      .single()

    if (!post) return NextResponse.json({ success: false, error: 'Post not found' }, { status: 404 })

    // 每个请求都必须是登录态、对这个 post 的客户有权限、且是付费档——授权绑定到
    // resolved post.client_id，光有 post_id 不算授权（#1149）。用付费档校验而非
    // dashboard 版：/dashboard/content 页面本身被 middleware 限定为 paid_client，
    // 若这里只查 dashboard 权限，self_serve 用户就能绕过页面闸、直接拿自己客户的
    // approved post 打这条 API 触发真实发布（Codex P1）。未登录 / 越租户 / 非付费档
    // 都在这里被拒，到不了下面任何 Publer 写入。
    const access = await requirePaidClientAccess(post.client_id)
    if (!access.ok) {
      return NextResponse.json(
        { success: false, error: access.error, ...(access.reason ? { reason: access.reason } : {}) },
        { status: access.status },
      )
    }

    if (post.status !== 'approved') {
      return NextResponse.json({ success: false, error: 'Post not approved' }, { status: 400 })
    }

    // Content guard: reject posts whose pre-publish self-check flagged issues.
    // Posts without a receipt (never checked) pass through — blocking them would
    // freeze every legacy post. Only posts with a receipt that says "needs human
    // review" are stopped here. Unreadable receipts also block (fail closed).
    if (needsHumanReview(post.generation_context_snapshot)) {
      return NextResponse.json(
        {
          success: false,
          error: 'This post was flagged by the pre-publish content check and needs human review before it can be published. Go to the content board to review it.',
          code: 'content_guard_blocked',
        },
        { status: 409 },
      )
    }

    // Prefer is_final=true assets (externally edited final versions),
    // then fall back to most recently selected/created ready asset
    const { data: assets } = await supabaseAdmin
      .from('visual_assets')
      .select('id, storage_url, asset_type, is_final, current_version_num')
      .eq('post_id', post_id)
      .eq('generation_status', 'ready')
      .order('is_final', { ascending: false })
      .order('is_selected', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)

    const asset = assets?.[0]
    if (!asset?.storage_url) {
      return NextResponse.json({ success: false, error: 'No ready asset found' }, { status: 400 })
    }

    // Look up client's configured Publer account IDs (set via Connectors > Publer)
    const { data: connectorRow } = await supabaseAdmin
      .from('client_connectors')
      .select('config')
      .eq('client_id', post.client_id)
      .eq('anchor', 'publer')
      .maybeSingle()

    // Runtime-validate the JSONB shape before trusting it
    const rawConfig = connectorRow?.config
    const rawIds =
      rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
        ? (rawConfig as Record<string, unknown>).publer_account_ids
        : undefined
    const configuredIds: Record<string, string> =
      rawIds && typeof rawIds === 'object' && !Array.isArray(rawIds)
        ? (rawIds as Record<string, string>)
        : {}

    const accounts = await getAccounts()
    const postPlatforms: string[] = Array.isArray(post.platforms)
      ? post.platforms
      : (post.platforms ? [post.platforms] : [])

    // Normalise platform strings to lowercase to match Publer's provider field
    const platforms = postPlatforms.map(p => p.toLowerCase()).filter(Boolean)

    // 租户边界必须守到**最终外部落点**（#1149 P1）：只发到这个客户在连接器里
    // 显式绑定、且能解析成 live 账号、且 provider 匹配的 Publer 账号。绝不回退到
    // 工作区里的任意账号 / 第一个匹配平台 / accounts[0]——那会把本客户的内容发到
    // 另一个客户的社媒账号。任一环节缺失 / 对不上都在 uploadMedia / schedulePost
    // 之前 fail closed，并给出不含密钥的配置错误。
    if (platforms.length === 0) {
      return NextResponse.json(
        { success: false, error: 'This post has no target platform, so no bound publishing account can be resolved.', code: 'no_platform' },
        { status: 400 },
      )
    }

    // requested platform 必须在客户连接器里有**非空显式**绑定。
    // key 大小写不敏感匹配（#1149 P2）：连接器 settings UI 直接把 Publer 的 provider
    // 字段原样写进这个 key、不做规范化，所以存进来的可能是 "Facebook"；而请求平台
    // 已小写。若按精确 key 查会把有效绑定误判成 connector_unbound，让配置正确的客户
    // 反而发不出去。按小写归一后再找非空绑定（与 resolveBoundPublerAccount 一致）。
    const boundAccountIdFor = (platform: string): string | undefined => {
      const key = Object.keys(configuredIds).find((k) => k.toLowerCase() === platform)
      const id = key ? configuredIds[key] : undefined
      return typeof id === 'string' && id.trim() !== '' ? id : undefined
    }
    let boundPlatform: string | undefined
    let boundAccountId: string | undefined
    for (const p of platforms) {
      const id = boundAccountIdFor(p)
      if (id) {
        boundPlatform = p
        boundAccountId = id
        break
      }
    }
    if (!boundPlatform || !boundAccountId) {
      return NextResponse.json(
        {
          success: false,
          error: 'No Publishing Hub account is bound for this client on the requested platform. Configure the Publishing Hub connector for this client before publishing.',
          code: 'connector_unbound',
        },
        { status: 400 },
      )
    }

    // 绑定的账号 ID 必须解析成 Publer 当前真实返回的 live 账号（不是历史/失效 ID）。
    const account = accounts.find(a => a.id === boundAccountId)
    if (!account) {
      return NextResponse.json(
        {
          success: false,
          error: `The Publishing Hub account bound for "${boundPlatform}" is stale or no longer available. Reconfigure the Publishing Hub connector for this client.`,
          code: 'account_stale',
        },
        { status: 400 },
      )
    }

    // live 账号的 provider 必须与绑定/请求的平台一致——防止绑错账号把内容发到别的平台。
    if ((account.provider?.toLowerCase() ?? '') !== boundPlatform) {
      return NextResponse.json(
        {
          success: false,
          error: `The bound Publishing Hub account does not match the requested platform "${boundPlatform}". Reconfigure the Publishing Hub connector for this client.`,
          code: 'provider_mismatch',
        },
        { status: 400 },
      )
    }

    const hashtags = post.hashtags ? `\n\n${post.hashtags}` : ''
    const caption = `${post.caption || post.script || ''}${hashtags}`.trim()

    // 真价只配真画面 —— 这条是**自动发布**路径（Airtable 审批过就跑），人不在场，
    // 所以这里是东西出去前的最后一道闸。拦下后本条留在 approved 不动，
    // 由今日待办的「🙋 需要你动手」把它捞出来（loadManualItems → pushPriceGateItems），
    // 不让它烂在 webhook 的错误日志里。
    const verdict = await judgeOutgoingPost(supabaseAdmin, {
      clientId: post.client_id,
      caption,
      imageUrl: asset.storage_url,
    })
    if (verdict.blocked) {
      console.error(`[publer/create-post] 价格闸拦下 post ${post_id}: ${priceGateMessage(verdict.source)}`)
      return NextResponse.json(
        { success: false, error: priceGateMessage(verdict.source), code: 'price_claim_unbacked' },
        { status: 409 },
      )
    }

    const scheduledAt = schedule_at ?? new Date(Date.now() + 3600_000).toISOString()
    const fileName = asset.storage_url.split('/').pop() ?? 'media'
    const media = await uploadMediaFromUrl(asset.storage_url, fileName)

    const result = await schedulePost({
      accountId: account.id,
      provider: account.provider,
      assetType: asset.asset_type,
      media,
      caption,
      scheduledAt,
    })

    await supabaseAdmin
      .from('content_posts')
      .update({
        status: 'scheduled',
        publer_post_id: result.job_id,
        scheduled_at: scheduledAt,
      })
      .eq('id', post_id)

    // Fire-and-forget: write social flywheel action (non-fatal)
    getAdapter('social').execute({
      clientId: post.client_id,
      actionType:    SOCIAL_ACTION_TYPE.SCHEDULE_POST,
      executionMode: 'third_party',
      vendor:        'publer',
      payload: {
        post_id,
        publer_job_id: result.job_id,
        platform:      account.provider,
        scheduled_at:  scheduledAt,
      },
    }).catch((err: unknown) => {
      console.error('[publer/create-post] flywheel write failed:', err)
    })

    return NextResponse.json({ success: true, job_id: result.job_id, client_id: post.client_id })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[publer/create-post]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
