'use client'

/**
 * /dashboard/conversions —— 成交/咨询核对页（Issue #1397 PR3）
 *
 * PM 每天在这里花 3 分钟：看一眼客人和金额对不对，对就告诉广告平台，不对就不发。
 *
 * 设计取舍（板桥复审的必改项）：
 *   · 一页看全，不是点进详情再返回 —— 一天十来条要能连着批完。
 *   · 键盘 Y / N 直接批，鼠标可选。
 *   · 「告诉广告平台」撤不回，所以必须弹二次确认；「不发送」要选原因。
 *   · 邮箱电话一律打码 —— 这一页会被截图、会投屏。
 *
 * 路径放 /dashboard 下是因为登录保护只覆盖 /dashboard/*（中间件 matcher）。
 * 放 /admin 下会是一个不需要登录就能打开的页面。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatMoney } from '@/lib/conversions/money'

/**
 * Meta 只收 7 天内的事件（官方硬限制）。
 * 🔴 这里**不能** import metaCapiWriter 来取这个数 —— 这是 'use client' 组件，
 *    writer 牵连出 hasher → node 的 crypto，拖进浏览器 bundle 会让整页闪一下就崩
 *    （2026-09-06 线上实测）。宁可写死这个常数，也不把服务端模块拉进客户端。
 */
const MAX_AGE_DAYS = 7

type Writeback = {
  id: string
  status: string
  last_error: string | null
  next_attempt_at: string | null
}

type Outcome = {
  id: string
  outcome_kind: 'purchase' | 'balance' | 'lead'
  order_ref: string | null
  amount_minor: number | null
  currency: string | null
  occurred_at: string
  review_status: string
  reject_reason: string | null
  redacted_at: string | null
  source_kind: string
  created_at: string
  /** contact_id 本身不是 PII（一个内部 UUID），用来跳转去客户管理页看这个人是谁。 */
  contact_id: string | null
  /** 存的是规范化过的小写形式（给 Meta 哈希用），显示前要转成首字母大写。 */
  customer_first: string | null
  me_conversion_writebacks?: Writeback[]
}

/** customer_first 存库时全小写（给 Meta 哈希用），这里只管显示好看，不改数据。 */
function displayName(name: string | null): string | null {
  if (!name) return null
  return name.replace(/\b\w/g, (c) => c.toUpperCase())
}

/** 这条记录当前的发送状态（一个事实目前只发一个平台，取第一条即可）。 */
function sendState(o: Outcome): Writeback | null {
  return o.me_conversion_writebacks?.[0] ?? null
}

const REJECT_REASONS: Array<{ value: string; label: string }> = [
  { value: 'customer_opted_out', label: '客人明确说过别用他的信息' },
  { value: 'not_real_sale', label: '不是真成交（补开发票之类）' },
  { value: 'duplicate', label: '重复了，同一笔已经有一条' },
  { value: 'other', label: '其它（下面写一句）' },
]

/**
 * 金额一律走 `money.ts` 那一份。
 * 🔴 这里曾经自己抄过一份带 `?? 2` 兜底的小数位表 —— 正是 money.ts 文件头
 *    声讨的那个事故的第 4 份复制。而这一页是人按下撤不回按钮前**唯一**核对金额的地方，
 *    兜底值在这里最不该存在。
 */
function money(o: Outcome): string {
  return formatMoney(o.amount_minor, o.currency) ?? '—'
}

function kindLabel(k: Outcome['outcome_kind']): string {
  return k === 'purchase' ? '收到定金' : k === 'balance' ? '收到尾款' : '有效咨询'
}

/** 精确天数。判"过没过期"用它，跟服务端同一口径；显示时才取整。 */
function daysAgo(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000
}

export default function ConversionsPage() {
  const [clientId, setClientId] = useState<string>('')
  const [rows, setRows] = useState<Outcome[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [writebackDisabled, setWritebackDisabled] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ id: string; text: string; ok: boolean } | null>(null)
  const [stuck, setStuck] = useState<Outcome[]>([])
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState<string>('')
  const [rejectNote, setRejectNote] = useState('')

  /**
   * 深链参数：今日待办邮件里的两条 kind 都会带上：
   *   · conversion_needs_review → ?client=<id>&focus=<outcomeId>
   *   · conversion_send_in_doubt → ?client=<id>&status=in_doubt
   * 这两个是**一次性**动作——加载完数据自动跳到对的位置就消费掉，
   * 别再影响用户后续手动切换（否则改 URL 或 pushState 一次它又跳一次）。
   * 2026-09-07 每日待办 href 落地页审计 (PR #1467) 修复项。
   */
  const [focusOutcomeId, setFocusOutcomeId] = useState<string | null>(null)
  const [autoScrollStatus, setAutoScrollStatus] = useState<string | null>(null)
  const stuckSectionRef = useRef<HTMLDivElement | null>(null)
  const outcomeRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    setClientId(p.get('client') ?? '')
    setFocusOutcomeId(p.get('focus'))
    setAutoScrollStatus(p.get('status'))
  }, [])

  const load = useCallback(async () => {
    if (!clientId) return
    setLoading(true)
    setError(null)
    setWritebackDisabled(false)
    try {
      const base = `/api/admin/conversions/outcomes?client_id=${encodeURIComponent(clientId)}&limit=200`
      // 已批准但没走完的：发出去没下文的、失败可重试的。send_status 交给接口在 SQL
      // 层筛（不是先按最新 200 条截断再筛）—— 否则堆积超过 200 条时，卡住的老记录
      // 会先被"最新 N 条"的窗口挤掉，压根轮不到这一步筛选。
      const [pendingRes, stuckRes] = await Promise.all([
        fetch(`${base}&review_status=pending_review`),
        fetch(`${base}&review_status=approved&send_status=in_doubt,failed`),
      ])
      const pending = await pendingRes.json()
      if (!pendingRes.ok) {
        // 成交回写那张表还没建（migration 未 apply）时，查询会报"表不存在"。
        // 这不是坏了，是那部分还没启用 —— 平静地说明，别弹红。名单下载不受影响。
        const msg = String(pending.error ?? '')
        if (/does not exist|relation|42P01|PGRST205|could not find the table/i.test(msg)) {
          setWritebackDisabled(true)
          setRows([])
          setStuck([])
          return
        }
        throw new Error(pending.error ?? '读取失败')
      }
      setRows(pending.outcomes ?? [])
      setCursor(0)

      // 今日待办叫人来点这里的按钮 —— 不列出来就是让人扑空（管道断头）。
      // 🔴 API 的 send_status filter 只是过滤 outcome，不保证每条一定带
      //    me_conversion_writebacks —— 万一将来 join 逻辑改了、或测试环境
      //    只返回 outcome 主表，渲染时 `sendState(o)!` 会 crash 整页。
      //    再挡一次：stuck 里只放**真有 writeback**的 outcome。
      const stuckBody = await stuckRes.json()
      const stuckRows: Outcome[] = (stuckBody.outcomes ?? []).filter(
        (o: Outcome) => (o.me_conversion_writebacks?.length ?? 0) > 0,
      )
      setStuck(stuckRows)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * 邮件深链 ?focus=<outcomeId>：数据到手后，把 cursor 跳到那条 + scrollIntoView。
   * 待核对堆积超过 200 条时，目标可能比默认列表窗口更老、根本不在 `rows` 里
   * ——这种情况按 id 直查一次（不受 limit/排序影响），把这一条插到列表最前面。
   * 直查也找不到才是真的没了（可能已经被人处理掉了、或 outcomeId 拼错）——
   * 静默不动，用户看到普通列表，不弹错。跳完清空 focusOutcomeId，同一 URL 不会二次跳。
   */
  useEffect(() => {
    if (!focusOutcomeId) return
    // rows / stuck 都还没读回来，等 —— 先返回，等某一边填了再触发本 effect
    if (rows.length === 0 && stuck.length === 0) return
    const id = focusOutcomeId

    // 先在两个列表里找
    const inRowsIdx = rows.findIndex((r) => r.id === id)
    if (inRowsIdx >= 0) {
      setCursor(inRowsIdx)
      setTimeout(() => outcomeRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)
      setFocusOutcomeId(null)
      return
    }
    if (stuck.some((s) => s.id === id)) {
      // stuck 用的是 stuckSectionRef 而不是 outcomeRefs（stuck 卡片没进 outcomeRefs
      // 池 —— 那是 rows 才注册的），滚到「需要你动手」区块顶就行
      setTimeout(() => stuckSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)
      setFocusOutcomeId(null)
      return
    }

    // 两边都没有 —— 按 id 直查一次（可能被 200 条窗口挤掉），拿回来后按
    // review_status 决定塞 rows 还是 stuck。
    if (!clientId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/conversions/outcomes?client_id=${encodeURIComponent(clientId)}&id=${encodeURIComponent(id)}`,
        )
        const body = await res.json()
        if (cancelled || !res.ok) return
        const found: Outcome | undefined = (body.outcomes ?? [])[0]
        if (!found) return
        if (found.review_status === 'pending_review') {
          setRows((rs) => (rs.some((r) => r.id === found.id) ? rs : [found, ...rs]))
          setCursor(0)
          setTimeout(() => outcomeRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)
          return
        }
        // approved + 卡在 in_doubt/failed 的 outcome：走 stuck 展示（只当它真有
        // writeback 时才塞 —— 跟 load() 里的防御过滤同一口径）
        const wb = found.me_conversion_writebacks?.[0]
        if (found.review_status === 'approved' && wb && (wb.status === 'in_doubt' || wb.status === 'failed')) {
          setStuck((s) => (s.some((r) => r.id === found.id) ? s : [found, ...s]))
          setTimeout(() => stuckSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)
        }
      } finally {
        if (!cancelled) setFocusOutcomeId(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [focusOutcomeId, rows, stuck, clientId])

  /**
   * 邮件深链 ?status=in_doubt：数据到手后 scroll 到「需要你动手」区块，
   * 让 PM 直接看到 doubt 那条卡片。stuck 空的时候啥也不做（可能已经解决完了）。
   * 跳完清空 autoScrollStatus，别在后续 stuck 变化时重复 scroll。
   */
  useEffect(() => {
    if (autoScrollStatus !== 'in_doubt' || stuck.length === 0) return
    setTimeout(() => stuckSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
    setAutoScrollStatus(null)
  }, [autoScrollStatus, stuck])

  const current = rows[cursor]

  const approve = useCallback(
    async (o: Outcome) => {
      // 撤不回，所以每一条都要点头一次。
      const ok = window.confirm(
        `确定把这条告诉广告平台吗？\n\n` +
          `${kindLabel(o.outcome_kind)} ${money(o)}${o.order_ref ? `（单号 ${o.order_ref}）` : ''}\n\n` +
          `⚠️ 发出去之后撤不回 —— 广告平台没有提供删除的办法。`,
      )
      if (!ok) return

      setBusy(o.id)
      try {
        const res = await fetch(`/api/admin/conversions/outcomes/${o.id}/review`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ decision: 'approve', confirm: true }),
        })
        const body = await res.json()
        setFlash({
          id: o.id,
          text: body.message ?? (res.ok ? '已处理' : '出错了'),
          ok: res.ok && body.send_status !== 'error',
        })
        if (res.ok) {
          setRows((rs) => {
            const next = rs.filter((r) => r.id !== o.id)
            setCursor((c) => Math.min(c, Math.max(0, next.length - 1)))
            return next
          })
        }
      } catch (e) {
        setFlash({ id: o.id, text: e instanceof Error ? e.message : String(e), ok: false })
      } finally {
        setBusy(null)
      }
    },
    [],
  )

  const reject = useCallback(async (o: Outcome, reason: string, note: string) => {
    setBusy(o.id)
    try {
      const res = await fetch(`/api/admin/conversions/outcomes/${o.id}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'reject', rejectReason: reason, rejectNote: note }),
      })
      const body = await res.json()
      setFlash({ id: o.id, text: body.message ?? (res.ok ? '已记为不发送' : '出错了'), ok: res.ok })
      if (res.ok) {
        setRows((rs) => {
          const next = rs.filter((r) => r.id !== o.id)
          setCursor((c) => Math.min(c, Math.max(0, next.length - 1)))
          return next
        })
        setRejecting(null)
        setRejectReason('')
        setRejectNote('')
      }
    } catch (e) {
      setFlash({ id: o.id, text: e instanceof Error ? e.message : String(e), ok: false })
    } finally {
      setBusy(null)
    }
  }, [])

  const resolve = useCallback(
    async (o: Outcome, resolution: 'confirmed' | 'resend') => {
      const wb = sendState(o)
      if (!wb) return
      if (resolution === 'confirmed') {
        const ok = window.confirm(
          '你在广告平台后台确认看到这一笔了吗？\n\n' +
            '看到了才点确定 —— 记成"已收到"之后就不会再发了。',
        )
        if (!ok) return
      } else {
        const ok = window.confirm(
          '确认平台**没有**收到，要重新发一次吗？\n\n' +
            '⚠️ 如果其实已经收到了，这一下会让同一笔算成两笔，而且撤不回。\n' +
            '请先在平台后台确认真的没有再点。',
        )
        if (!ok) return
      }

      setBusy(o.id)
      try {
        const res = await fetch(`/api/admin/conversions/writebacks/${wb.id}/resolve-doubt`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ resolution }),
        })
        const body = await res.json()
        if (res.ok && resolution === 'resend') {
          // 放回队列还不算发出去 —— 真正再发一次走这个接口。
          const sendRes = await fetch(`/api/admin/conversions/outcomes/${o.id}/send`, { method: 'POST' })
          const sendBody = await sendRes.json()
          setFlash({ id: o.id, text: sendBody.message ?? '已重新发送', ok: sendRes.ok })
        } else {
          setFlash({ id: o.id, text: body.message ?? '已处理', ok: res.ok })
        }
        if (res.ok) void load()
      } catch (e) {
        setFlash({ id: o.id, text: e instanceof Error ? e.message : String(e), ok: false })
      } finally {
        setBusy(null)
      }
    },
    [load],
  )

  const retry = useCallback(
    async (o: Outcome) => {
      setBusy(o.id)
      try {
        const res = await fetch(`/api/admin/conversions/outcomes/${o.id}/send`, { method: 'POST' })
        const body = await res.json()
        setFlash({ id: o.id, text: body.message ?? (res.ok ? '已重试' : '出错了'), ok: res.ok })
        if (res.ok) void load()
      } catch (e) {
        setFlash({ id: o.id, text: e instanceof Error ? e.message : String(e), ok: false })
      } finally {
        setBusy(null)
      }
    },
    [load],
  )

  // 键盘：Y 告诉平台 / N 不发送 / ↑↓ 换一条
  const [aud, setAud] = useState<Record<string, Record<string, number | string>>>({})
  const [audienceLoading, setAudienceLoading] = useState(false)
  const [keyLock, setKeyLock] = useState(false)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // 🔴 window.confirm 是阻塞的，期间的第二次按键拿到的还是旧的 busy=null，
      //    不锁住会连发两个请求。
      if (rejecting || busy || keyLock || !current) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'y' || e.key === 'Y') {
        setKeyLock(true)
        void approve(current).finally(() => setKeyLock(false))
      }
      if (e.key === 'n' || e.key === 'N') setRejecting(current.id)
      if (e.key === 'ArrowDown') setCursor((c) => Math.min(c + 1, rows.length - 1))
      if (e.key === 'ArrowUp') setCursor((c) => Math.max(c - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, rejecting, busy, keyLock, rows.length, approve])

  const checkAudience = useCallback(async () => {
    if (!clientId) return
    setAudienceLoading(true)
    const base = `/api/admin/conversions/audience-export?client_id=${encodeURIComponent(clientId)}&format=stats`
    const next: Record<string, Record<string, number | string>> = {}
    for (const source of ['fbleads']) {
      try {
        const res = await fetch(`${base}&source=${source}`)
        const body = await res.json()
        next[source] = res.ok ? body : { error: 1, note: body.error ?? '出错' }
      } catch (e) {
        next[source] = { error: 1, note: e instanceof Error ? e.message : String(e) }
      }
    }
    setAud(next)
    setAudienceLoading(false)
  }, [clientId])

  // PM 反馈：要点一下"先看人数"才有东西看，多余的一步——名单统计是只读查询，
  // 跟主列表一样，客户 ID 一到手就该自动跑，不用等人点。按钮留着当"重新统计"用。
  useEffect(() => {
    void checkAudience()
  }, [checkAudience])

  const summary = useMemo(() => {
    const purchases = rows.filter((r) => r.outcome_kind !== 'lead' && r.amount_minor != null)
    const currencies = new Set(purchases.map((r) => r.currency))
    // 🔴 混币种不给合计。把 NZD 和 AUD 加在一起再贴上第一条的币种标签，
    //    是一个**看起来很正常的错数字** —— 比不显示危险得多。
    const total =
      currencies.size === 1
        ? formatMoney(
            purchases.reduce((sum, r) => sum + (r.amount_minor ?? 0), 0),
            purchases[0]?.currency ?? null,
          )
        : null
    return { count: rows.length, purchases: purchases.length, total, mixed: currencies.size > 1 }
  }, [rows])

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 font-sans text-me-charcoal">
      <header>
        <h1 className="font-display text-2xl font-bold text-me-charcoal">成交与咨询 · 待核对</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-me-charcoal/60">
          核对无误后点「告诉广告平台」，平台就会去找更多像这位客人一样的人。
          <strong className="font-semibold text-me-charcoal">发出去撤不回</strong>，所以每条都会再确认一次。
        </p>
      </header>

      <div className="flex items-center gap-2">
        <input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="客户 ID"
          className="flex-1 rounded-lg border border-me-stone bg-white px-3 py-2 text-sm text-me-charcoal placeholder:text-me-charcoal/35 focus:border-me-ochre focus:outline-none"
        />
        <button onClick={() => void load()} className={btnNeutral()}>
          刷新
        </button>
      </div>

      <div className="rounded-xl border border-me-ochre/25 bg-me-gold/10 p-4">
        <div className="text-sm font-bold text-me-charcoal">Meta 客户名单（做 lookalike 用）</div>
        <div className="mt-1 text-xs leading-relaxed text-me-charcoal/60">
          只含<strong className="font-semibold text-me-charcoal">终端客户</strong>（旅行社同行、员工、拒联的自动排除）。看够不够 100 人再下载。
        </div>
        <button
          onClick={() => void checkAudience()}
          disabled={!clientId || audienceLoading}
          className={`mt-3 ${btnNeutral()} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {audienceLoading ? '统计中…' : '重新统计人数'}
        </button>

        {(['fbleads'] as const).map((source) => {
          const st = aud[source]
          if (!st) return null
          const today = new Date().toISOString().slice(0, 10)
          return (
            <div key={source} className="mt-3 border-t border-me-ochre/15 pt-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="min-w-[130px] font-semibold text-me-charcoal">FB 广告来的</strong>
                {st.error ? (
                  <span className="text-status-rej">出错：{String(st.note)}</span>
                ) : (
                  <>
                    <span className="text-me-charcoal/70">
                      可上传 <strong className="font-semibold text-me-charcoal">{st.kept}</strong> 人
                    </span>
                    <a
                      href={`/api/admin/conversions/audience-export?client_id=${encodeURIComponent(clientId)}&format=csv&source=${source}`}
                      className="rounded-lg bg-status-track px-3 py-1.5 text-xs font-semibold text-white no-underline hover:opacity-90"
                    >
                      下载（命名 CTS · LIST · fbleads · {today.replace(/-/g, '')}）
                    </a>
                  </>
                )}
              </div>
              {!st.error && <div className="mt-1 text-me-charcoal/50">{st.note}</div>}
            </div>
          )
        })}

        {Object.keys(aud).length > 0 && (
          <div className="mt-3 text-xs leading-relaxed text-me-ochre">
            🔴 下载后到 Meta 后台建 Customer List 上传（Meta 自己加密）。
            <strong className="font-semibold">传完请删掉文件。</strong>
            退订/未订阅的人已自动不在名单里。
          </div>
        )}
      </div>

      {writebackDisabled && (
        <div className={box('neutral')}>
          成交回写功能尚未启用（需先建数据表并重新连接 Meta）。上面的「客户名单下载」不受影响，可以正常使用。
        </div>
      )}
      {error && <div className={box('error')}>读取出错：{error}</div>}
      {loading && <div className="text-sm text-me-charcoal/50">读取中…</div>}

      {!loading && !error && !writebackDisabled && rows.length === 0 && stuck.length === 0 && clientId && (
        <div className={box('success')}>没有待核对的记录 —— 都处理完了。</div>
      )}

      {stuck.length > 0 && (
        <div ref={stuckSectionRef} className="space-y-2.5">
          <h2 className="font-display text-base font-bold text-me-charcoal">需要你动手（{stuck.length}）</h2>
          {stuck.map((o) => {
            const wb = sendState(o)!
            const doubt = wb.status === 'in_doubt'
            return (
              <div key={o.id} className="rounded-xl border border-status-attn/40 bg-me-gold/15 p-4">
                <div className="text-[15px] font-semibold text-me-charcoal">
                  {kindLabel(o.outcome_kind)}
                  {o.outcome_kind !== 'lead' && ` · ${money(o)}`}
                  {o.order_ref && <span className="font-normal text-me-charcoal/50"> · 单号 {o.order_ref}</span>}
                </div>
                <div className="my-2 text-sm leading-relaxed text-me-charcoal/70">
                  {doubt
                    ? '这一笔发出去时断线了，不确定平台收到没有。系统不会自己重发 —— 重发一次就是把同一笔算成两笔，撤不回。'
                    : `上次发送没成功：${wb.last_error ?? '未知原因'}。可以再试一次。`}
                </div>
                {doubt ? (
                  <div className="flex flex-wrap gap-2">
                    <button disabled={busy === o.id} onClick={() => void resolve(o, 'confirmed')} className={btnSolid('status-track')}>
                      平台后台看到了 · 记为已收到
                    </button>
                    <button disabled={busy === o.id} onClick={() => void resolve(o, 'resend')} className={btnSolid('status-attn')}>
                      确认没收到 · 重新发送
                    </button>
                  </div>
                ) : (
                  <button disabled={busy === o.id} onClick={() => void retry(o)} className={btnSolid('me-charcoal')}>
                    再试一次
                  </button>
                )}
                {flash?.id === o.id && (
                  <div className={`mt-2.5 text-sm ${flash.ok ? 'text-status-track' : 'text-status-rej'}`}>{flash.text}</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {rows.length > 0 && (
        <div className="text-sm text-me-charcoal/60">
          共 <strong className="font-semibold text-me-charcoal">{summary.count}</strong> 条待核对
          {summary.purchases > 0 && (
            <>
              ，其中 {summary.purchases} 笔成交
              {summary.total ? (
                <>
                  合计 <strong className="font-semibold tabular-nums text-me-charcoal">{summary.total}</strong>
                </>
              ) : summary.mixed ? (
                <span className="text-me-charcoal/45">（多种币种，不显示合计）</span>
              ) : null}
            </>
          )}
          。快捷键：{kbd('Y')} 告诉平台 · {kbd('N')} 不发送 · {kbd('↑')}
          {kbd('↓')} 换一条
        </div>
      )}

      <div className="space-y-2.5">
        {rows.map((o, i) => {
          const age = daysAgo(o.occurred_at)
          const expired = age > MAX_AGE_DAYS
          const focused = i === cursor
          return (
            <div
              key={o.id}
              ref={(el) => {
                outcomeRefs.current[o.id] = el
              }}
              onClick={() => setCursor(i)}
              className={`cursor-pointer rounded-xl border p-4 shadow-card transition-colors ${
                focused ? 'border-me-ochre ring-2 ring-me-ochre/30' : 'border-black/10'
              } ${expired ? 'bg-me-gold/10' : 'bg-white'}`}
            >
              <div className="flex justify-between gap-3">
                <div>
                  {displayName(o.customer_first) && (
                    <div className="text-base font-bold text-me-charcoal">{displayName(o.customer_first)}</div>
                  )}
                  <div className={`text-[15px] font-semibold ${displayName(o.customer_first) ? 'mt-0.5 text-me-charcoal/70' : 'text-me-charcoal'}`}>
                    {kindLabel(o.outcome_kind)}
                    {o.outcome_kind !== 'lead' && <span className="tabular-nums"> · {money(o)}</span>}
                    {o.order_ref && <span className="font-normal text-me-charcoal/50"> · 单号 {o.order_ref}</span>}
                  </div>
                  <div className="mt-1 text-xs text-me-charcoal/50">
                    {age < 1 ? '今天' : `${Math.floor(age)} 天前`}
                    {' · 来源：'}
                    {{
                      manual_seed: '人工录入',
                      inbox_extract: '邮箱抓取',
                      web_form: '网站表单',
                      meta_lead_form: '广告表单',
                      api: '接口',
                      crm_hubspot: 'HubSpot 同步',
                      crm_sheet_sync: '表格同步',
                      messenger_conversation: '私信判断',
                    }[o.source_kind] ?? o.source_kind}
                  </div>
                  {o.contact_id && (
                    <a
                      href={`/dashboard/clients/${clientId}/crm/all?contact=${o.contact_id}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1.5 inline-block text-sm font-semibold text-me-ochre hover:underline"
                    >
                      查看这个客人 →
                    </a>
                  )}
                  {expired && (
                    <div className="mt-1.5 text-xs leading-relaxed text-me-ochre">
                      ⚠️ 已过去 {Math.floor(age)} 天，广告平台只收 {MAX_AGE_DAYS} 天内的 —— 现在发也收不进去，选「不发送」即可。
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-start gap-2">
                  <button
                    disabled={busy === o.id || expired}
                    onClick={(e) => {
                      e.stopPropagation()
                      void approve(o)
                    }}
                    title={expired ? '超过 7 天，平台不收' : '告诉广告平台（会再确认一次）'}
                    className={`${btnSolid('status-track')} disabled:cursor-not-allowed disabled:bg-me-stone disabled:text-me-charcoal/40`}
                  >
                    ✓ 告诉广告平台
                  </button>
                  <button
                    disabled={busy === o.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      setRejecting(o.id)
                    }}
                    className={btnNeutral()}
                  >
                    ✕ 不发送
                  </button>
                </div>
              </div>

              {rejecting === o.id && (
                <div className="mt-3 border-t border-black/5 pt-3" onClick={(e) => e.stopPropagation()}>
                  <div className="mb-1.5 text-sm text-me-charcoal/70">为什么不发送？（必选，将来复查要用）</div>
                  <select
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    className="w-full rounded-lg border border-me-stone bg-white px-2.5 py-2 text-sm text-me-charcoal focus:border-me-ochre focus:outline-none"
                  >
                    <option value="">请选择…</option>
                    {REJECT_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  {rejectReason === 'other' && (
                    <input
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      placeholder="写一句原因"
                      className="mt-2 w-full rounded-lg border border-me-stone bg-white px-2.5 py-2 text-sm text-me-charcoal placeholder:text-me-charcoal/35 focus:border-me-ochre focus:outline-none"
                    />
                  )}
                  <div className="mt-2 flex gap-2">
                    <button
                      disabled={!rejectReason || busy === o.id}
                      onClick={() => void reject(o, rejectReason, rejectNote)}
                      className={`${btnSolid('me-charcoal')} disabled:cursor-not-allowed disabled:bg-me-stone disabled:text-me-charcoal/40`}
                    >
                      确认不发送
                    </button>
                    <button onClick={() => setRejecting(null)} className={btnNeutral()}>
                      取消
                    </button>
                  </div>
                </div>
              )}

              {flash?.id === o.id && (
                <div className={`mt-2.5 text-sm ${flash.ok ? 'text-status-track' : 'text-status-rej'}`}>{flash.text}</div>
              )}
            </div>
          )
        })}
      </div>

      {flash && !rows.some((r) => r.id === flash.id) && <div className={box(flash.ok ? 'success' : 'error')}>{flash.text}</div>}
    </div>
  )
}

/** 次要动作——白底描边，用在"刷新""不发送""取消"这类不撤不回的按钮上。 */
function btnNeutral(): string {
  return 'whitespace-nowrap rounded-lg border border-me-stone bg-white px-3.5 py-2 text-sm font-semibold text-me-charcoal hover:bg-me-ivory'
}

/** 主要动作——纯色底，颜色按语义传（status-track=确认成功一类，status-attn=需要留意，me-charcoal=中性强调）。 */
function btnSolid(tone: 'status-track' | 'status-attn' | 'me-charcoal'): string {
  const bg = { 'status-track': 'bg-status-track', 'status-attn': 'bg-status-attn', 'me-charcoal': 'bg-me-charcoal' }[tone]
  return `whitespace-nowrap rounded-lg ${bg} px-3.5 py-2 text-sm font-semibold text-white hover:opacity-90`
}

/** 页面级提示条：读取出错 / 都处理完了 / 功能未启用。 */
function box(tone: 'error' | 'success' | 'neutral'): string {
  const styles = {
    error: 'bg-status-rej/10 text-status-rej',
    success: 'bg-status-track/10 text-status-track',
    neutral: 'bg-me-stone/50 text-me-charcoal/70',
  }
  return `rounded-lg px-3.5 py-3 text-sm ${styles[tone]}`
}

function kbd(key: string): React.ReactElement {
  return (
    <kbd className="rounded border border-me-stone bg-white px-1.5 py-0.5 font-mono text-xs font-semibold text-me-charcoal/70">
      {key}
    </kbd>
  )
}
