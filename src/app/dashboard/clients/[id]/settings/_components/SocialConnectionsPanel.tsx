'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { factoryConfigHref } from '@/lib/factory/config-link'
import type { SocialAuthorization, SocialChannelStatus, SocialConnectionsSnapshot } from '@/lib/platform-oauth/social-onboarding'

const LABELS: Record<SocialAuthorization, string> = {
  saved: '授权记录已保存', refresh_pending: '待刷新核验', target_missing: '待确认发布目标',
  not_connected: '尚未授权', account_mismatch: '授权目标不一致', ambiguous: '待核实多个账号',
  needs_attention: '授权需要处理', unknown: '暂时无法确认', not_available: '原生授权暂未开放',
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
  if (channel.platform === 'youtube' && canManage) {
    return channel.targetAccountId
      ? { label: '授权 YouTube 频道', href: `/api/auth/google/youtube/start?clientId=${encodeURIComponent(clientId)}` }
      : { label: '配置 YouTube 频道', href: `${base}/settings?tab=connect&section=youtube-channel` }
  }
  if (channel.platform === 'instagram') return { label: '登记账号资料', href: `${base}/settings?tab=content&section=social-profiles` }
  return null
}

function DisconnectYoutube({ channel, clientId, onChanged }: {
  channel: SocialChannelStatus; clientId: string; onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const generation = useRef(0)
  const invalidate = useCallback(() => { generation.current++ }, [])
  useEffect(() => { invalidate(); return invalidate }, [clientId, invalidate])
  const disconnect = async (connectionId: string) => {
    if (!window.confirm('确认断开这条 YouTube 授权？需要使用时可以重新授权。')) return
    const version = generation.current
    setBusy(true)
    setFailed(false)
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/platform/youtube?connectionId=${encodeURIComponent(connectionId)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('unavailable')
      if (version === generation.current) onChanged()
    } catch { if (version === generation.current) setFailed(true) }
    finally { if (version === generation.current) setBusy(false) }
  }
  return <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
    {channel.managedAccounts?.map(account => <div key={account.connectionId} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
      <span className="break-all">{account.displayName}（{account.accountId}）</span>
      <button disabled={busy} onClick={() => void disconnect(account.connectionId)} className="font-semibold text-red-700 disabled:opacity-40">断开此 YouTube 授权</button>
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
      {!canManage && (channel.platform === 'youtube' || (channel.platform === 'facebook' && !channel.targetAccountId)) && (
        <p className="mt-3 text-xs text-amber-800">{saved || channel.authorization === 'refresh_pending' ? '频道配置由团队维护。' : '请团队核实发布目标并完成此平台连接。'}</p>
      )}
      {action && <a href={action.href} className="mt-4 self-start rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white">{action.label}</a>}
      {canManage && channel.platform === 'youtube' && Boolean(channel.managedAccounts?.length) && <DisconnectYoutube channel={channel} clientId={clientId} onChanged={onChanged} />}
    </article>
  )
}

export function SocialConnectionsPanel({ clientId }: { clientId: string }) {
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
