'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { instagramOutcomeMessage } from '@/lib/instagram-oauth/identity'
import { factoryConfigHref } from '@/lib/factory/config-link'
import type { SocialAuthorization, SocialChannelStatus, SocialConnectionsSnapshot } from '@/lib/platform-oauth/social-onboarding'

const LABELS: Record<SocialAuthorization, string> = {
  saved: '授权记录已保存', refresh_pending: '待刷新核验', target_missing: '待确认发布目标',
  not_connected: '尚未授权', account_mismatch: '授权目标不一致', ambiguous: '待核实多个账号',
  needs_attention: '授权需要处理', unknown: '暂时无法确认', not_available: '原生授权暂未开放',
}

const YOUTUBE_OUTCOMES: Record<string, string> = {
  connected: 'YouTube 频道授权已保存。请核对下方频道名称和编号；公开发布仍需单独授权。',
  cancelled: '你已取消 YouTube 连接，现有配置未改变。',
  no_channel: '此 Google 账号没有返回可连接的 YouTube 频道，请换用拥有目标频道的账号。',
  multiple_channels: '检测到多个频道，本次未建立新连接。请团队核实并配置目标频道后重新连接。',
  channel_mismatch: '本次授权的频道与已登记频道不同，原连接未被替换。请核实后重试。',
  target_changed: '连接期间频道配置或账号权限发生变化，请刷新后重试。',
  scope_missing: 'Google 未授予连接所需的全部权限，本次没有保存授权。',
  verify_failed: '暂时无法核实 YouTube 授权，本次没有保存连接。',
  save_failed: '连接未完成；如频道已显示但授权未保存，请对同一频道重新连接。',
  bad_state: '连接会话已失效，请重新从此页面发起授权。',
  target_review: 'YouTube 目标频道需要团队核实，请联系团队后再连接。',
  unavailable: 'YouTube 连接暂不可用，请稍后重试或联系团队。',
}

function youtubeOutcomeMessage(value: string | null): string | null {
  return value && Object.prototype.hasOwnProperty.call(YOUTUBE_OUTCOMES, value)
    ? YOUTUBE_OUTCOMES[value] : null
}

function nextAction(channel: SocialChannelStatus, clientId: string, canManage: boolean) {
  const base = `/dashboard/clients/${encodeURIComponent(clientId)}`
  if (channel.platform === 'facebook') {
    if (!channel.targetAccountId) return canManage
      ? { label: '配置 Facebook 发布主页', href: factoryConfigHref(clientId) } : null
    return { label: '核实 Facebook 主页与权限', href: `${base}?settings=platform` }
  }
  if (channel.platform === 'tiktok' && channel.authorization !== 'ambiguous') {
    return { label: channel.identity ? '重新授权 TikTok' : '连接 TikTok',
      href: `/api/auth/tiktok/connect?client_id=${encodeURIComponent(clientId)}` }
  }
  if (channel.platform === 'youtube' && channel.authorization !== 'ambiguous') {
    return { label: channel.identity ? '重新连接 YouTube' : '连接 YouTube',
      href: `/api/auth/google/youtube/start?clientId=${encodeURIComponent(clientId)}` }
  }
  if (channel.platform === 'instagram') {
    if (channel.authorization === 'ambiguous') return null
    if (channel.connectAvailable) return {
      label: channel.identity ? '重新连接 Instagram 专业账号' : '连接 Instagram 专业账号',
      href: `/api/auth/instagram/connect?client_id=${encodeURIComponent(clientId)}`,
    }
    return { label: '登记 Instagram 账号', href: `${base}/settings?tab=content&section=social-profiles` }
  }
  return null
}

function DisconnectConnection({ channel, clientId, onChanged }: {
  channel: SocialChannelStatus; clientId: string; onChanged: () => void
}) {
  const platform = channel.platform === 'instagram' ? 'instagram' : 'youtube'
  const name = platform === 'instagram' ? 'Instagram' : 'YouTube'
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const generation = useRef(0)
  const invalidate = useCallback(() => { generation.current++ }, [])
  useEffect(() => { invalidate(); return invalidate }, [clientId, invalidate])
  const disconnect = async (connectionId: string) => {
    if (!window.confirm(platform === 'instagram' ? '确认从 ME 断开此 Instagram 授权？这不会撤销 Instagram 端的应用许可。' : '确认断开这条 YouTube 授权？需要使用时可以重新授权。')) return
    const version = generation.current
    setBusy(true)
    setFailed(false)
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/platform/${platform}?connectionId=${encodeURIComponent(connectionId)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('unavailable')
      if (version === generation.current) onChanged()
    } catch { if (version === generation.current) setFailed(true) }
    finally { if (version === generation.current) setBusy(false) }
  }
  return <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
    {channel.managedAccounts?.map(account => <div key={account.connectionId} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
      <span className="break-all">{account.displayName}（{account.accountId}）</span>
      <button disabled={busy} onClick={() => void disconnect(account.connectionId)} className="font-semibold text-red-700 disabled:opacity-40">{platform === 'instagram' ? '从 ME 断开此 Instagram 授权' : `断开此 ${name} 授权`}</button>
    </div>)}
    {failed && <p role="alert" className="text-xs text-red-700">断开未完成，请重试或让团队核实权限。</p>}
  </div>
}

function ChannelCard({ channel, clientId, canManage, onChanged }: {
  channel: SocialChannelStatus; clientId: string; canManage: boolean; onChanged: () => void
}) {
  const action = nextAction(channel, clientId, canManage)
  const saved = channel.authorization === 'saved'
  return (
    <article aria-label={channel.name} className="flex flex-col rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-slate-900">{channel.name}</h3>
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${saved ? 'bg-cyan-50 text-cyan-800' : 'bg-slate-100 text-slate-700'}`}>
          {LABELS[channel.authorization]}
        </span>
      </div>
      <dl className="mt-3 space-y-1 break-all text-xs text-slate-600">
        <div><dt className="inline font-semibold">登记资料：</dt><dd className="inline">{channel.profile ?? '尚未登记'}</dd></div>
        {channel.targetAccountId && <div><dt className="inline font-semibold">发布目标编号：</dt><dd className="inline">{channel.targetAccountId}</dd></div>}
        {channel.identity && <div><dt className="inline font-semibold">授权账号：</dt><dd className="inline">{channel.identity.displayName}（{channel.identity.accountId}）</dd></div>}
        {channel.identity?.verifiedAt && <div><dt className="inline font-semibold">上次保存的核验：</dt><dd className="inline">{new Date(channel.identity.verifiedAt).toLocaleString('zh-CN')}</dd></div>}
      </dl>
      <p className="mt-3 text-sm text-slate-700">{channel.detail}</p>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">{channel.publishing}</p>
      {channel.platform === 'facebook' && <p className="mt-2 text-xs text-amber-800">现有 Meta 授权还包含消息、评论和线索权限；请先核对权限范围。</p>}
      {!canManage && channel.platform === 'facebook' && !channel.targetAccountId && (
        <p className="mt-3 text-xs text-amber-800">{saved || channel.authorization === 'refresh_pending' ? '频道配置由团队维护。' : '请团队核实发布目标并完成此平台连接。'}</p>
      )}
      {channel.platform === 'instagram' && channel.connectAvailable && <p className="mt-3 text-xs text-slate-600">使用 Instagram 专业账号登录，此次仅读取基本资料。需使用企业或创作者账号；能否连接还取决于平台审核或测试资格。</p>}
      {channel.platform === 'youtube' && <p className="mt-3 text-xs text-slate-600">请使用拥有目标频道的 Google 账号授权。连接仅用于私享上传与核对；这一步不会上传视频或公开发布。{!channel.targetAccountId && '首次连接仅在账号恰有一个频道时自动确认目标。'}</p>}
      {channel.platform === 'youtube' && canManage && !channel.targetAccountId && <a className="mt-2 text-xs font-semibold text-cyan-800" href={`/dashboard/clients/${encodeURIComponent(clientId)}/settings?tab=connect&section=youtube-channel`}>由团队手动配置频道</a>}
      {action && <a href={action.href} className="mt-4 self-start rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white">{action.label}</a>}
      {canManage && (channel.platform === 'youtube' || channel.platform === 'instagram') && Boolean(channel.managedAccounts?.length) && <DisconnectConnection channel={channel} clientId={clientId} onChanged={onChanged} />}
    </article>
  )
}

export function SocialConnectionsPanel({ clientId }: { clientId: string }) {
  const params = useSearchParams()
  const instagramOutcome = instagramOutcomeMessage(params?.get('instagram') ?? null)
  const youtubeOutcome = youtubeOutcomeMessage(params?.get('youtube') ?? null)
  const [loaded, setLoaded] = useState<{ clientId: string; data: SocialConnectionsSnapshot } | null>(null)
  const snapshot = loaded?.clientId === clientId ? loaded.data : null
  const requestVersion = useRef(0)
  const invalidate = useCallback(() => { requestVersion.current++ }, [])
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const load = useCallback(async (signal?: AbortSignal) => {
    const version = ++requestVersion.current
    setLoading(true)
    setLoaded(null)
    setError(false)
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/social-connections`, { cache: 'no-store', signal })
      if (!response.ok) throw new Error('unavailable')
      const data = await response.json() as SocialConnectionsSnapshot
      if (!signal?.aborted && version === requestVersion.current) setLoaded({ clientId, data })
    } catch {
      if (!signal?.aborted && version === requestVersion.current) setError(true)
    } finally {
      if (!signal?.aborted && version === requestVersion.current) setLoading(false)
    }
  }, [clientId])
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => { controller.abort(); invalidate() }
  }, [load, invalidate])
  return (
    <div className="space-y-4">
      {instagramOutcome && <p role="status" className="rounded-lg bg-cyan-50 p-3 text-sm text-cyan-950">{instagramOutcome}</p>}
      {youtubeOutcome && <p role="status" className="rounded-lg bg-cyan-50 p-3 text-sm text-cyan-950">{youtubeOutcome}</p>}
      <p className="text-sm text-slate-600">请在平台官方页面登录并授权，无需向团队提供密码。登记主页链接与账号名称后，仍需完成平台授权。连接授权不会公开发布内容。</p>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>{snapshot ? `本次读取：${new Date(snapshot.readAt).toLocaleString('zh-CN')} · 以下为保存记录，未实时验证平台` : '读取账号授权记录'}</span>
        <button type="button" onClick={() => void load()} disabled={loading} className="font-semibold text-cyan-800 disabled:opacity-40">刷新授权记录</button>
      </div>
      {loading && <p role="status">正在读取社媒授权记录…</p>}
      {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">暂时无法确认授权状态，请重试；读取失败不代表账号未连接。</p>}
      {snapshot && <div className="grid gap-3 sm:grid-cols-2">{snapshot.channels.map(channel => (
        <ChannelCard key={channel.platform} channel={channel} clientId={clientId} canManage={snapshot.canManageConfiguration} onChanged={() => void load()} />
      ))}</div>}
    </div>
  )
}
