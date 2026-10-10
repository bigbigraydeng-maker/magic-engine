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
 * 「复制这条链接发给别人」——不是每个按钮都该自己点。
 *
 * 2026-09-15 PM 反馈：管理员批准这一步经常不是当前看着屏幕的这个人要做的
 * （见上面 ConnectWizard 的说明——它跟收邮件那个人可以是两位）。之前只给
 * 一个可以点的链接，等于假设了「点这个链接的人就是要批准的人」——但实际上
 * 大概率是这个人要把链接转给同事，链接本身要能被复制、能带上一句现成的话，
 * 而不是让他自己去猜「怎么把这个按钮的地址弄给别人」（右键复制链接地址
 * 这种操作对非技术背景的人不是显然的）。
 *
 * 用绝对地址（`window.location.origin` 拼出来）——相对路径复制出去粘贴到
 * 微信里点开会打不开或者打到错的域名。
 */
function CopyLinkRow({ href, label }: { href: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const [origin, setOrigin] = useState('')

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const fullUrl = origin ? `${origin}${href}` : href

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 剪贴板权限被浏览器拦了——链接本来就摆在输入框里，人自己框选复制。
    }
  }

  return (
    <div className="mt-2">
      <input
        readOnly
        value={fullUrl}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600"
      />
      <div className="mt-1.5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          className={
            copied
              ? 'rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white'
              : 'rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-bold text-white hover:bg-slate-700'
          }
        >
          {copied ? '✓ 已复制' : `复制链接${label ? `，发给${label}` : ''}`}
        </button>
        <a
          href={href}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          我自己点
        </a>
      </div>
    </div>
  )
}

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
    <div className="mt-3">
      <p className="text-xs text-slate-500">
        登录后看到<strong>「需要管理员批准」</strong>？
        那是这家公司不让员工自己给外部软件授权。这一步该找公司里管 Microsoft 365 的那位同事做——
        把下面这条链接复制给他，不用自己点：
      </p>
      <CopyLinkRow
        href={`/api/auth/microsoft/mail/start?clientId=${clientId}&admin=1`}
        label="你们的 IT 同事"
      />
    </div>
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
 * 连邮箱的向导。
 *
 * ## 2026-09-15 重新设计 —— 原来的「第 1 步 / 第 2 步」把顺序摆反了
 *
 * 旧版把「管理员放行」和「连邮箱」编成第 1、2 步并排显示，两个圆圈同样大小、
 * 同样黑底 —— 看起来像「所有人都要先做完 1 才能做 2」。但事实是：
 * **多数公司根本不需要管理员那一步**，直接连就能成功；只有小部分公司锁了
 * 权限的，才会在连接时撞上「需要管理员批准」这面墙。PM 实测这个版本时，
 * 光是解释清楚「谁该点哪个、要不要都点」就要写好几段话 —— UI 没说清楚的事，
 * 只能靠人工反复解释，这正是这次重做要治的病。
 *
 * 新版把**直接连邮箱**摆成唯一的主操作（PM 2026-08-02 定的产品目标就是让
 * 员工自己点一下就行）；管理员那条路收进一个**默认收起、按需展开**的
 * 「卡住了？」区块 —— 只有真撞上那面墙的人才会点开它，不会误导所有人
 * 都要先做这一步。两条路径各自标好「这一步该找谁做」，不用再靠猜。
 */
function ConnectWizard({
  clientId,
  adminApproved,
}: {
  clientId: string
  adminApproved: boolean
}) {
  const [addr, setAddr] = useState('')
  // 管理员批准回来之后，多半是他自己点的，人已经在这个页面上了 ——
  // 直接展开「卡住了」区块，免得他批准完却要自己再去找一次收起的入口。
  const [stuckOpen, setStuckOpen] = useState(adminApproved)
  const target = addr.trim()
  const connectHref =
    `/api/auth/microsoft/mail/start?clientId=${clientId}` +
    (target ? `&loginHint=${encodeURIComponent(target)}` : '')

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-700">
        还没连。客人现在发到公司邮箱的询价，<strong>系统里看不到</strong>。
      </p>

      {/* ── 主操作：直接连邮箱 —— 大多数公司一步就能成功 ───────────── */}
      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
        <p className="text-sm font-bold text-slate-800">连上要收信的那个邮箱</p>
        <p className="mt-0.5 text-xs text-slate-500">
          这一步请找<strong>平时收发这个邮箱的本人</strong>来做——填好地址、点连接，
          会跳到 Microsoft 的登录页，用这个邮箱本身登录、同意一下就行。
        </p>
        <p className="mt-1 text-xs text-slate-500">
          浏览器里已经登着别的 Microsoft 账号时，<strong>Microsoft 不会问你用哪个，
          会直接拿当前那个走完</strong>——写了地址它就会把那个账号摆出来，防止连错。
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

      {/* ── 备用路径：只有撞墙的人才需要，默认收起 ───────────── */}
      <div className="rounded-lg border border-slate-200">
        <button
          type="button"
          onClick={() => setStuckOpen((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2.5 text-left"
        >
          <span className="text-sm font-bold text-slate-700">
            {adminApproved && '✓ '}卡住了？点了以后提示「需要管理员批准」
          </span>
          <span className="text-xs text-slate-400">{stuckOpen ? '收起 ▲' : '展开 ▼'}</span>
        </button>
        {stuckOpen && (
          <div className="border-t border-slate-200 px-3 py-3">
            {adminApproved ? (
              <p className="text-xs font-bold text-emerald-700">
                ✓ 管理员已经批准过了 —— 门开了，但还没连上任何邮箱。回到上面，重新填一次地址、点连接。
              </p>
            ) : (
              <>
                <p className="text-xs text-slate-500">
                  这是公司的 Microsoft 365 锁了「不让员工自己给外部软件登录授权」这项设置，
                  <strong>不是账号或操作出了错</strong>。
                  这一步请找<strong>贵公司管 Microsoft 365 的 IT 同事</strong>来做，
                  跟上面收邮件的那个人可以不是同一位。
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  这一步<strong>不会连上任何邮箱</strong>，只是替全公司开一次门——点完请回到上面，
                  用收邮件的那个账号重新连一次。
                </p>
                <p className="mt-2 text-xs font-bold text-slate-700">
                  这一步该找 IT 同事做的话，把下面这条链接复制给他，不用自己点：
                </p>
                <CopyLinkRow
                  href={`/api/auth/microsoft/mail/start?clientId=${clientId}&admin=1`}
                  label="你们的 IT 同事"
                />
              </>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-slate-400">
        我们只读这一个邮箱，不碰公司里其他任何邮箱；也不会改它 —— 不标已读、不移动、不删除。
      </p>
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
      {/* 「管理员批准了」这句话现在由 ConnectWizard 里那个自动展开的
          「卡住了？」区块说，不在这里重复一遍——两处各说各的、措辞还不一样，
          正是这一块之前被反馈「完全看不懂」的原因之一。 */}
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
