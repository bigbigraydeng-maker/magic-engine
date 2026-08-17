'use client'

/**
 * 「切换前先看这批人」的复核页。
 *
 * ## 这一页要回答的唯一问题
 *
 * 把拒联判据改成「只看事实」之后，有一批人会**重新开始收到我们的消息** ——
 * 他们的档案开关写着「已停」，但往来记录里**一条证据都没有**。
 *
 * 对每个人只有两种结局：
 *   · 他当初真说过「别再联系」→ 记录那一步当年写失败了，**必须先补回去**再切换
 *   · 他从没说过 → 那个开关本来就是错的，切换正好把他放回名单
 *
 * ## 为什么没有「标记已处理」按钮
 *
 * 不需要。补一条记录用的是**已有的**那个输入框（打开他 → 记一笔），
 * 补完之后他就有证据了，**下次刷新这一页他自己就消失**。
 *
 * 加一个「已处理」按钮意味着再存一份状态 —— 而这一整轮重设计要修的
 * 正是「存下来的状态会跟事实走散」。在这一页上重犯，就太说不过去了。
 *
 * ## 一行写操作都没有
 *
 * 这一页只读。所有改动都发生在「打开他的记录」之后的既有界面里。
 */

import { useCallback, useState } from 'react'

interface Diff {
  contactId: string
  displayName: string | null
  touchCount: number
  lastTouchAt: string | null
}

interface Result {
  clientId: string
  examined: number
  blockedNow: number
  blockedFactsOnly: number
  wouldUnblock: Diff[]
  unexpectedNewBlocks: Diff[]
  error?: string
}

export interface ClientOption {
  id: string
  name: string
}

function when(iso: string | null): string {
  if (!iso) return '从来没有过往来记录'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '时间坏了'
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  const date = d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' })
  return days < 1 ? '今天' : `${date}（${days} 天前）`
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return (
    <div className="rounded-xl border border-me-charcoal/10 bg-white px-4 py-3">
      <p className="text-[11px] font-bold text-me-charcoal/45">{label}</p>
      <p className={`mt-0.5 text-2xl font-black ${tone === 'danger' ? 'text-[#C2453A]' : 'text-me-charcoal'}`}>
        {value}
      </p>
    </div>
  )
}

/** 一个人一行 —— 名字、档案有多薄、最后一次往来、以及直达他的链接。 */
function Row({ d, clientId }: { d: Diff; clientId: string }) {
  const thin = d.touchCount === 0
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-me-charcoal/8 py-2.5">
      <span className="min-w-[9rem] font-bold text-me-charcoal">{d.displayName || '未留姓名'}</span>
      <span className={`text-xs ${thin ? 'font-bold text-[#C2453A]' : 'text-me-charcoal/55'}`}>
        {thin ? '⚠️ 一条往来记录都没有' : `${d.touchCount} 条往来记录`}
      </span>
      <span className="text-xs text-me-charcoal/45">最后一次：{when(d.lastTouchAt)}</span>
      <a
        href={`/dashboard/clients/${clientId}/crm/all?contact=${d.contactId}`}
        target="_blank"
        rel="noreferrer"
        className="ml-auto shrink-0 rounded-lg border border-me-charcoal/20 bg-white px-3 py-1 text-xs font-bold text-me-charcoal/75"
      >
        打开他的记录 →
      </a>
    </div>
  )
}

/** 取一次对比结果。抽出来只为让页面主体守住「函数 < 50 行」。 */
async function fetchDualRun(clientId: string): Promise<Result> {
  const res = await fetch(`/api/admin/crm/dnc-dual-run?clientId=${encodeURIComponent(clientId)}`)
  const json = (await res.json()) as Result
  if (!res.ok) throw new Error(json.error ?? '对比失败')
  return json
}

export function DualRunReview({ clients }: { clients: ClientOption[] }) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? '')
  const [data, setData] = useState<Result | null>(null)
  const [loading, setLoading] = useState(false)
  /** 🔴 「还没查」和「查完了没有差异」是两回事，不能都渲染成空白。 */
  const [err, setErr] = useState<string | null>(null)

  const run = useCallback(async () => {
    if (!clientId) return
    setLoading(true)
    setErr(null)
    setData(null)
    try {
      setData(await fetchDualRun(clientId))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '对比失败')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="rounded-lg border border-me-charcoal/20 bg-white px-3 py-2 text-sm font-semibold"
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button
          onClick={() => void run()}
          disabled={loading || !clientId}
          className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white disabled:opacity-40"
        >
          {loading ? '对比中…' : '开始对比'}
        </button>
        <span className="text-xs text-me-charcoal/45">只读 —— 这一页不会改任何数据</span>
      </div>

      {err && (
        <p className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/5 px-4 py-3 text-sm font-bold text-[#C2453A]">
          没跑成：{err}
        </p>
      )}

      {data && <Summary data={data} clientId={clientId} />}
    </div>
  )
}

/** 结果那一块单独拆出来 —— 页面主体只管取数和选客户。 */
function Summary({ data, clientId }: { data: Result; clientId: string }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="看了多少人" value={data.examined} />
        <Stat label="现在被停的" value={data.blockedNow} />
        <Stat label="改完之后还被停的" value={data.blockedFactsOnly} />
      </div>

      {data.unexpectedNewBlocks.length > 0 && (
        <p className="rounded-xl border border-[#C2453A]/40 bg-[#C2453A]/8 px-4 py-3 text-sm font-bold text-[#C2453A]">
          🔴 出现了 {data.unexpectedNewBlocks.length} 个<b>反方向</b>的差异 —— 这本该是 0。
          说明对现有判据的理解有错，<b>先别切换</b>，把这个查清楚。
        </p>
      )}

      <div>
        <h2 className="text-sm font-black text-me-charcoal">
          切换后会重新开始被联系的人 ——{' '}
          <span className={data.wouldUnblock.length > 0 ? 'text-[#C2453A]' : ''}>
            {data.wouldUnblock.length} 人
          </span>
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-me-charcoal/60">
          他们的档案开关写着「已停」，但往来记录里<b>一条证据都没有</b>。
          <br />
          逐个点开看他说过什么：<b>真说过「别再联系」</b> → 在他的记录里补一句「客户说别再联系」；
          <b>从没说过</b> → 什么都不用做，切换正好把他放回名单。
          <br />
          <span className="text-me-charcoal/45">
            补完一个人，他下次刷新就从这份名单上消失 —— 所以这里不需要「标记已处理」。
          </span>
        </p>

        {data.wouldUnblock.length === 0 ? (
          <p className="mt-3 rounded-xl border border-me-charcoal/10 bg-white px-4 py-6 text-center text-sm font-bold text-me-charcoal/50">
            ✓ 没有差异 —— 这个客户可以安全切换
          </p>
        ) : (
          <div className="mt-3 rounded-xl border border-me-charcoal/10 bg-white px-4 py-1">
            {data.wouldUnblock.map((d) => (
              <Row key={d.contactId} d={d} clientId={clientId} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
