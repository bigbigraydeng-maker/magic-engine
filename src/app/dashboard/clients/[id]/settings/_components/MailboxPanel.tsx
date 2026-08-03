'use client'

/**
 * 连接客户自己的邮箱。
 *
 * 这一块是给**客户老板或他的 IT 同事**看的 —— 不是给我们自己看的。所以：
 *  · 说的是「客人发来的邮件」，不是「Microsoft Graph 授权」
 *  · 连上之后**把邮箱地址显示出来**：连错邮箱是这条管道最贵的错误（会把别的
 *    部门、甚至老板私人的邮件抓进客户的 CRM），必须让人当场看见连的是哪一个
 *  · 要人做的那一步只有一句话：「用你收 info@ 的那个账号登录一下」
 *
 * 为什么它必须存在（铁律 3）：这一步只有客户那边的人能点。做不了自动化的事，
 * 就要把它做成一个按钮 + 一句人话，而不是写进文档让 PM 转述。
 */

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { PlatformConnectionSummary } from '@/lib/platform-oauth/vocabulary'

/**
 * 撞上「需要管理员批准」怎么办。
 *
 * **两种状态下都要显示**，这一点是踩出来的：2026-08-02 CTS 那次，管理员先连上了
 * 自己的 `bdm@`，页面切到「已连接」状态，这行提示就消失了 —— 而他真正要连的
 * `info@` 还卡在那面墙后面，页面上再也找不到那个批准链接。
 *
 * 一条只在「还没连」时才出现的说明，等于在最需要它的时候不见了。
 */
function AdminConsentHint({ clientId }: { clientId: string }) {
  return (
    <p className="mt-3 text-xs text-slate-500">
      登录后看到<strong>「需要管理员批准」</strong>？
      那是这家公司不让员工自己给外部软件授权。请公司里管 Microsoft 365 的那位同事点一次
      <a
        href={`/api/auth/microsoft/mail/start?clientId=${clientId}&admin=1`}
        className="mx-1 font-bold text-slate-700 underline"
      >
        这个链接
      </a>
      替全公司批准，然后再回来连一次。
    </p>
  )
}

/**
 * 「要连哪个邮箱」+ 去 Microsoft 登录。
 *
 * 为什么非要先问一句地址：浏览器里已经登着一个 Microsoft 账号时，Microsoft
 * **不会问**你要用哪个，直接拿当前那个走完全程。2026-08-02 CTS 就是这么把
 * 管理员自己的 `bdm@` 连了上去，而他要连的是 `info@`。
 *
 * 填了地址，Microsoft 会直接把那个账号摆在登录页上 —— 想连错反而要多做一步。
 * 留空也能走（有人就是想用当前账号），只是没有这层保护。
 */
function ConnectButton({
  clientId,
  label,
  primary,
}: {
  clientId: string
  label: string
  primary: boolean
}) {
  const [addr, setAddr] = useState('')
  const href =
    `/api/auth/microsoft/mail/start?clientId=${clientId}` +
    (addr.trim() ? `&loginHint=${encodeURIComponent(addr.trim())}` : '')

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input
        type="email"
        value={addr}
        onChange={(e) => setAddr(e.target.value)}
        placeholder="要连哪个邮箱？例如 info@example.co.nz"
        className="min-w-[16rem] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <a
        href={href}
        className={
          primary
            ? 'shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-slate-700'
            : 'shrink-0 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50'
        }
      >
        {label}
      </a>
    </div>
  )
}

export function MailboxPanel({ clientId }: { clientId: string }) {
  const params = useSearchParams()
  const [connections, setConnections] = useState<PlatformConnectionSummary[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/platform/mailbox`)
      if (!res.ok) throw new Error(String(res.status))
      const { connections: list } = (await res.json()) as {
        connections: PlatformConnectionSummary[]
      }
      setConnections(list)
    } catch {
      setConnections([])
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  // 授权回来时带的那句话（见 /api/auth/microsoft/mail/callback）。
  const justConnected = params.get('mail') === 'ok' ? params.get('addr') : null
  const justFailed = params.get('mail') === 'error' ? (params.get('why') ?? '连接失败') : null
  const adminApproved = params.get('mail') === 'admin_ok'

  const active = (connections ?? []).filter((c) => c.status === 'active')

  const disconnect = async (id: string, addr: string) => {
    if (!window.confirm(`断开 ${addr}？断开后，客人发到这个邮箱的信不会再进 CRM。`)) return
    setBusy(true)
    try {
      await fetch(`/api/clients/${clientId}/platform/mailbox?connectionId=${id}`, { method: 'DELETE' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      {justConnected && (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <p className="text-sm font-black text-emerald-800">✓ 连上了：{justConnected}</p>
          <p className="mt-0.5 text-xs text-emerald-700">
            客人发到这个邮箱的信，从现在起会自动出现在「今天该联系谁」里。
            {/*
              连错邮箱是这条管道最贵的错误，而它只在这一刻可以零代价撤销 ——
              一旦同步跑过一轮，别人的私人邮件就已经进了客户的 CRM。
              所以这句话必须出现在人刚连上、还盯着屏幕的那一秒。
            */}
            <strong className="ml-1">
              地址不对？现在点「断开」，还没同步过就等于什么都没发生。
            </strong>
          </p>
        </div>
      )}
      {adminApproved && (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <p className="text-sm font-black text-emerald-800">✓ 管理员批准了</p>
          <p className="mt-0.5 text-xs text-emerald-700">
            门开了，但<strong>还没连上</strong>。现在请用平时收这个邮箱的账号，点下面的
            「连接公司邮箱」再走一次。
          </p>
        </div>
      )}
      {justFailed && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-sm font-black text-red-800">没连上</p>
          <p className="mt-0.5 text-xs text-red-700">{justFailed}</p>
        </div>
      )}

      {connections === null ? (
        <p className="text-sm text-slate-400">读取中…</p>
      ) : active.length === 0 ? (
        <>
          <p className="text-sm text-slate-700">
            还没连。客人现在发到公司邮箱的询价，<strong>系统里看不到</strong>。
          </p>
          <p className="mt-1 text-xs text-slate-500">
            点下面的按钮，用<strong>平时收这个邮箱的那个账号</strong>登录一次就好。
            我们只读这一个邮箱，不碰公司里其他任何邮箱。
          </p>
          <ConnectButton clientId={clientId} label="连接公司邮箱" primary />
          <AdminConsentHint clientId={clientId} />
        </>
      ) : (
        <>
          <ul className="space-y-2">
            {active.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-800">✉️ {c.display_name}</p>
                  <p className="text-xs text-slate-500">
                    {c.last_synced_at ? `最近同步：${new Date(c.last_synced_at).toLocaleString('zh-CN')}` : '还没同步过'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void disconnect(c.id, c.display_name)}
                  className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  断开
                </button>
              </li>
            ))}
          </ul>
          <ConnectButton clientId={clientId} label="再连一个邮箱" primary={false} />
          <AdminConsentHint clientId={clientId} />
        </>
      )}
    </div>
  )
}
