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
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
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

/**
 * 连邮箱的两步向导。
 *
 * 为什么做成**编号的两步**，而不是一个按钮加一段说明（CTS 实测连挂两次）：
 *
 *   第一次 —— info@ 点了按钮，撞上「需要管理员批准」，卡死。
 *   第二次 —— 管理员点了同一个按钮，浏览器里已经登着他自己的账号，
 *             Microsoft 根本没问要用哪个，直接把 `bdm@` 连了上去。
 *
 * 两次都不是人没看清，是界面把**两件必须分开做的事**摆成了一个按钮：
 * 「让公司放行」和「连上那个邮箱」。所以现在它们是第 1 步和第 2 步，
 * 各自有各自的按钮，第 2 步强制先说清楚要连哪个邮箱。
 */
function ConnectWizard({
  clientId,
  adminApproved,
}: {
  clientId: string
  adminApproved: boolean
}) {
  const [addr, setAddr] = useState('')
  const target = addr.trim()
  const connectHref =
    `/api/auth/microsoft/mail/start?clientId=${clientId}` +
    (target ? `&loginHint=${encodeURIComponent(target)}` : '')

  const step = 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black'

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-700">
        还没连。客人现在发到公司邮箱的询价，<strong>系统里看不到</strong>。
      </p>

      {/* ── 第 1 步 ───────────────────────────────────────── */}
      <div className="flex gap-3">
        <span
          className={`${step} ${adminApproved ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white'}`}
        >
          {adminApproved ? '✓' : '1'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-800">
            让公司放行 —— <span className="font-normal text-slate-500">管理员点一次，只用做一遍</span>
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            很多公司的 Microsoft 365 不让员工自己给外部软件授权。
            <strong>这一步不会连上任何邮箱</strong>，它只是开门 —— 所以谁点都不会连错。
          </p>
          {adminApproved ? (
            <p className="mt-1.5 text-xs font-bold text-emerald-700">✓ 已经批准过了，去做第 2 步</p>
          ) : (
            <a
              href={`/api/auth/microsoft/mail/start?clientId=${clientId}&admin=1`}
              className="mt-2 inline-block rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              管理员批准
            </a>
          )}
        </div>
      </div>

      {/* ── 第 2 步 ───────────────────────────────────────── */}
      <div className="flex gap-3">
        <span className={`${step} bg-slate-900 text-white`}>2</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-800">连上要收信的那个邮箱</p>
          <p className="mt-0.5 text-xs text-slate-500">
            先写清楚要连哪个 —— 浏览器里已经登着别的 Microsoft 账号时，
            <strong>Microsoft 不会问你用哪个，会直接拿当前那个走完</strong>。写了地址它就会把那个账号摆出来。
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="email"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder="要连哪个邮箱？例如 info@example.co.nz"
              className="min-w-[16rem] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <a
              href={connectHref}
              aria-disabled={!target}
              className={
                target
                  ? 'shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-slate-700'
                  : 'pointer-events-none shrink-0 rounded-lg bg-slate-200 px-4 py-2 text-sm font-black text-slate-400'
              }
            >
              连接这个邮箱
            </a>
          </div>
          {!target && (
            <p className="mt-1 text-xs text-slate-400">填了邮箱地址才能继续 —— 这一步就是用来防连错的。</p>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-400">
        我们只读这一个邮箱，不碰公司里其他任何邮箱；也不会改它 —— 不标已读、不移动、不删除。
      </p>
    </div>
  )
}

/** 授权回来时地址栏上带的那几个参数（见 /api/auth/microsoft/mail/callback）。 */
const FLASH_PARAMS = ['mail', 'addr', 'why'] as const

export function MailboxPanel({ clientId }: { clientId: string }) {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
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

  /**
   * 授权回来时带的那句话，**只读一次**。
   *
   * 2026-08-03 PM 反馈「页面还是显示 bdm@，看不懂」：这几个参数留在地址栏上，
   * 于是「✓ 连上了 bdm@」跟着 URL 一直挂着，每次回到这一页都重播一遍，
   * 跟下面的邮箱列表一模一样地重复一次 —— 同一个邮箱在页面上出现两次，
   * 人自然以为哪里出了问题。而且它那句「还没同步过就等于什么都没发生」
   * 在第一次同步之后就变成了假话。
   *
   * 所以：进页面时抓进 state，随即把地址栏擦掉。只擦我们自己加的那几个参数，
   * 别的参数不动 —— 这一页还挂着其他板块。
   */
  const [flash] = useState(() => ({
    connected: params.get('mail') === 'ok' ? params.get('addr') : null,
    failed: params.get('mail') === 'error' ? (params.get('why') ?? '连接失败') : null,
    adminOk: params.get('mail') === 'admin_ok',
  }))

  useEffect(() => {
    if (!params.get('mail')) return
    const next = new URLSearchParams(params.toString())
    for (const k of FLASH_PARAMS) next.delete(k)
    const q = next.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  }, [params, pathname, router])

  const justConnected = flash.connected
  const justFailed = flash.failed
  const adminApproved = flash.adminOk

  const active = (connections ?? []).filter((c) => c.status === 'active')

  /**
   * 刚连上的这个邮箱，同步跑过没有。
   *
   * 决定上面那句撤销提示能不能说「等于什么都没发生」—— 跑过一轮之后就不能说了，
   * 那时候别人的邮件已经在客户的 CRM 里，断开连接并不会把它们收回去。
   */
  const flashConn = justConnected
    ? active.find((c) => c.display_name === justConnected)
    : undefined
  const flashNeverSynced = !flashConn?.last_synced_at

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
              连错邮箱是这条管道最贵的错误，而它只在同步跑起来之前可以零代价撤销 ——
              一旦跑过一轮，别人的私人邮件就已经进了客户的 CRM，断开也收不回来。
              所以这两句话必须分开说，不能一直说「等于什么都没发生」。
            */}
            <strong className="ml-1">
              {flashNeverSynced
                ? '地址不对？现在点「断开」，还没同步过就等于什么都没发生。'
                : '地址不对？点「断开」会停止收信 —— 但已经收进来的信要另外清，来找我们。'}
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
        <ConnectWizard clientId={clientId} adminApproved={adminApproved} />
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
