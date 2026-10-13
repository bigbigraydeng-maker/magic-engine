'use client'

/**
 * 全部客人 —— 一张横表，一行一个客人，点一行从右侧滑出这个人的全渠道往来记录，
 * 能顺手记一笔、改跟进到哪一步、回私信/邮件/WhatsApp。区别于「今天要联系」
 * （只显示今天该打的人）：这页是「翻看所有人 / 客户打回来了要查这是谁」用的。
 *
 * 2026-09-28（CRM 重整 B2）：详情从「点行就地展开一块 ContactDetail」换成
 * 「PersonDrawer 抽屉」——原本是「今天要联系」页专用的组件，已经有私信/邮件回复、
 * 一键动作、置顶备注等 ContactDetail 没有的功能。换用它，不用把这些功能再抄一遍，
 * 也顺带解决了「两份重复逻辑」的老毛病（原来 ContactDetail 和 PersonDrawer 各判一次
 * NAL、各接一份 WhatsApp 回复框）。删除的 ContactDetail.tsx 见这次改动的 diff。
 *
 * 板桥定的几条落地：进线时间显示真实首条触点（后端已算）不是导入日期；
 * 平铺名单像传统 CRM 一样显示「到哪一步了」；「该做什么」只在「Magic Engine 智能」
 * 分段视图里显示（PM 2026-10-10）；
 * 每个空格填人话绝不留白；顶部搜索 + 表头排序 +
 * 总数；渠道/方向标签带 fallback（DB 加新枚举前端不炸）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { CrmTabs } from '../_components/CrmTabs'
import { type StageOption } from '../_components/ComposeNote'
import { PersonDrawer, type DrawerRow } from '../_components/PersonDrawer'
import { BatchEmail, type BatchEmailBucket } from '../_components/BatchEmail'
import { PrioritySectionHeader } from './_components/PrioritySection'
import { BookingTrackerPanel } from '../_components/bookings/BookingTrackerPanel'
import { useOpenContactFromNudge } from '../_components/bookings/useOpenContactFromNudge'
import { takeContactName } from '../_components/bookings/payments-return'
import { currentPositionLabel, nextNavStep, type NavInput, type SectionKey } from '@/lib/crm/drawer-nav'
import type { Segment } from '@/lib/crm/segments'
import { type KindView } from '@/lib/crm/kind-filter'
import { dayProgress } from '@/lib/crm/day-list'
import { DAILY_QUOTA } from '@/lib/crm/next-action'
import {
  LIST_CLS,
  fmtDate,
  relTime,
  ts,
  type ContactRow,
  type CustomColumnMeta,
} from './_components/contact-table-types'

// SectionKey 从 drawer-nav.ts 引，不在本文件另声明一份同样的字面量联合类型——
// 只有一处定义，谁改了 lib/crm/list-sections.ts 的两张名单（hot / cold）的名字，这里跟着变，不用记得改两处。
interface PrioritySectionData {
  key: SectionKey
  title: string
  hint: string
  total: number
  open: boolean
  page: number
  items: ContactRow[] | null
}

/** 抽屉打开时正在等下一页数据 —— 拿到之后打开这一页的首个/末个。 */
type PendingNav =
  | { mode: 'segment'; sectionKey: SectionKey; openFirst: boolean }
  | { mode: 'flat'; openFirst: boolean }

/**
 * 今天有没有碰过这个人——"全部客人"的 ContactRow 没有「今天要联系」那页专属的
 * `doneToday` 标记（那边是按日重置的行动队列，这页不是），用「最近联系是不是今天」
 * 当替代信号，跟 contact-table-types.ts 的 `relTime()`「今天/昨天」判断同一个口径
 * （2026-09-28 WP-B5）。
 */
function isToday(iso: string | null): boolean {
  if (!iso) return false
  const d = new Date(iso)
  return d.toDateString() === new Date().toDateString()
}

function toDrawerRow(r: ContactRow): DrawerRow {
  return {
    contactId: r.contactId,
    name: r.name,
    phone: r.phone,
    email: r.email,
    stage: r.stage,
    stageLabel: r.stageLabel,
    reason: r.reason,
    // 「该做什么」三行卡的内容 —— 跟列表那一格同一个对象，两处不会说两套话。
    nextAction: r.nextAction,
    // 只给抽屉显示一行「AI 初判（未校准）」小字，不参与任何判断。
    intent: r.intent,
    // 后端 segmentContact() 的枚举值原样传下来，这里的 ContactRow.segment 类型是
    // string（跨接口共用的宽类型），值域跟 Segment 一致，不重新校验。
    segment: r.segment as Segment,
    important: r.important,
    suggestedChannel: r.suggestedChannel,
    phoneUnusable: r.phoneUnusable,
    doNotContact: r.doNotContact,
  }
}

export default function CrmAllContactsPage() {
  const params = useParams()
  const clientId = params.id as string

  const [rows, setRows] = useState<ContactRow[]>([])
  const [columns, setColumns] = useState<CustomColumnMeta[]>([])
  const [total, setTotal] = useState(0)
  const [stages, setStages] = useState<StageOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [q, setQ] = useState('')
  // 只有防抖后的值进 API —— 否则每敲一个字都打一次请求。
  const [qDebounced, setQDebounced] = useState('')
  // 服务端拒绝 q 里的逗号/括号（PostgREST or() 语法），单独一条提示，不覆盖整页错误。
  const [qError, setQError] = useState<string | null>(null)
  const [stageFilter, setStageFilter] = useState<string[]>([])
  /**
   * 终端客户 / 同行 / 全部（2026-09-28 WP-B3）。只在平铺模式生效——服务端
   * `?kind=` 只接了分页路径（getPaged），分段视图（今天要联系同款四段）
   * 这一轮没接，切到分段时这个筛选会被忽略（下面 grouped 切换那里会重置它，
   * 不留一个"选了但看起来没生效"的筛选条件)。
   */
  const [kindFilter, setKindFilter] = useState<KindView>('all')
  const [page, setPage] = useState(1)
  // C1a 固定 100，先不给改每页条数的入口。
  const [perPage] = useState(100)
  const [sortKey, setSortKey] = useState<'firstSeenAt' | 'lastTouchAt'>('lastTouchAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  /**
   * 平铺 / 按优先级分段。默认平铺 —— 这一轮先把分段做出来给人看，
   * 不动任何老用户打开这一页时看到的东西。
   */
  const [grouped, setGrouped] = useState(false)
  const [sections, setSections] = useState<PrioritySectionData[]>([])
  /** 展开哪些段。null = 还没动过，用服务端默认（前两段展开）。 */
  const [openSections, setOpenSections] = useState<SectionKey[] | null>(null)
  /**
   * 每段看到第几页。服务端一段只下发 100 行（`?p_<段>=2` 取下一页）。
   *
   * 🔴 没有这个的那一版：段头写「217 人」、表里只有 100 行、**没有任何入口能看到
   * 剩下 117 个人**。子牙和魏征两边独立判为 BLOCKER，形状跟 2026-08-02
   * 「33 个人从名单上凭空消失」完全一样 —— 人数对、人不在。
   * 服务端 `?p_<段>` 早就收了，只是前端一次都没发过。
   */
  const [sectionPages, setSectionPages] = useState<Partial<Record<SectionKey, number>>>({})
  /** 分段那次请求正在飞 —— 点开一段到数据回来之间要有话说，不能白茫茫一片（魏征 C2）。 */
  const [sectionsLoading, setSectionsLoading] = useState(false)
  /**
   * `?contact=` 只认第一次。
   *
   * 不锁的那一版：每次分段请求都重新读 URL，于是服务端每次都回 focus、
   * 页面每次都把那一段弹回展开 —— 用户**关不掉它**，还每次白跑一遍
   * 「整批拉 1010 人 + 5k 条触点」（魏征 C1 实测）。
   */
  const focusUsedRef = useRef(false)

  const [viewerEmail, setViewerEmail] = useState<string | null>(null)

  // ── 抽屉状态（2026-09-28 B2，取代原来的 expandedId + 就地展开） ──────────────
  const [drawerContactId, setDrawerContactId] = useState<string | null>(null)
  /** 抽屉里这个人属于分段模式的哪一段 —— 只在 grouped=true 时有意义，决定上一位/下一位怎么算。 */
  const [drawerSectionKey, setDrawerSectionKey] = useState<SectionKey | null>(null)
  const [pendingNav, setPendingNav] = useState<PendingNav | null>(null)
  /**
   * 🔴 pendingNav 消费用的「这一轮到底有没有在飞」信号，必须是 ref 不是 state
   * （魏征 2026-09-28 复审 B2 实现查出的真实 bug，`loading`/`sectionsLoading` 这两个
   * state 不够用）：翻页点击触发 `setPage` 之后，`loadList` 是在**同一次 effect 处理**
   * 里同步跑到 `setLoading(true)` 那一行的——但那只是"排了一次状态更新"，跟它同一批
   * 处理的其它 effect（包括 pendingNav 那条）读到的还是**这一轮渲染开始时**的旧值
   * （React 不会在同一批 effect 处理中途把新状态回灌给还没跑到的 effect）。于是 pendingNav
   * 那条 effect 会拿着上一页的旧数据把自己提前消费掉，真正的新数据到达时已经没人认领。
   * ref 读写不受这层批处理影响，`loadList` 一开始就同步置 true，其它 effect 无论在
   * 哪一批跑到都能读到当下最新的值。
   */
  const fetchInFlightRef = useRef(false)

  const loadList = useCallback(async () => {
    setError(null)
    fetchInFlightRef.current = true
    try {
      const params = new URLSearchParams()
      if (grouped) {
        setSectionsLoading(true)
        params.set('view', 'priority')
        if (qDebounced.trim()) params.set('q', qDebounced.trim())
        for (const s of stageFilter) params.append('stage', s)
        if (openSections !== null) params.set('open', openSections.join(','))
        for (const [key, p] of Object.entries(sectionPages)) {
          if (typeof p === 'number' && p > 1) params.set(`p_${key}`, String(p))
        }
        if (!focusUsedRef.current) {
          const focusContactId = new URLSearchParams(window.location.search).get('contact')
          if (focusContactId) params.set('contact', focusContactId)
        }
      } else {
        // 平铺模式翻页也标一下「正在飞」（跟 grouped 分支的 setSectionsLoading(true) 同理）——
        // 之前这里从来不重置，翻页时页面不会有任何加载中的迹象。真正防住 pendingNav
        // 提前消费旧数据的是 fetchInFlightRef（见该 ref 定义处的头注），这一行只管 UI。
        setLoading(true)
        params.set('page', String(page))
        params.set('perPage', String(perPage))
        if (qDebounced.trim()) params.set('q', qDebounced.trim())
        for (const s of stageFilter) params.append('stage', s)
        if (kindFilter !== 'all') params.set('kind', kindFilter)
      }

      const [res, stageRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/crm/contacts?${params.toString()}`),
        fetch(`/api/clients/${clientId}/pipeline-stages`),
      ])
      const json = (await res.json()) as {
        total?: number
        columns?: CustomColumnMeta[]
        items?: ContactRow[]
        view?: string
        sections?: PrioritySectionData[]
        focus?: { found: boolean; section?: SectionKey; page?: number }
        error?: string
        viewerEmail?: string | null
      }
      if (!res.ok) {
        // 400 是搜索词非法（逗号/括号）—— 只提示搜索框，别把已有名单清空。
        if (res.status === 400) {
          setQError('搜索里不能有逗号或括号')
          return
        }
        setError(json.error ?? '加载失败')
        return
      }
      setQError(null)
      // 展开的联系人要显示「发出去会记在谁名下」（Messenger/邮件/WhatsApp 回复框）。
      setViewerEmail(json.viewerEmail ?? null)
      if (json.view === 'priority') {
        const secs = json.sections ?? []
        setSections(secs)
        setColumns(json.columns ?? [])
        setTotal(secs.reduce((n, s) => n + s.total, 0))
        setRows(secs.flatMap((s) => s.items ?? []))
        // 直达链接落在收起来的段里时，把那一段打开 —— 否则点进来什么都看不到。
        if (json.focus?.found && json.focus.section) {
          focusUsedRef.current = true
          const target = json.focus.section
          setOpenSections((prev) => {
            const base = prev ?? secs.filter((s) => s.open).map((s) => s.key)
            return base.includes(target) ? base : [...base, target]
          })
        }
      } else {
        setRows(json.items ?? [])
        setColumns(json.columns ?? [])
        setTotal(json.total ?? 0)
      }
      if (stageRes.ok) {
        const s = (await stageRes.json()) as { stages?: StageOption[] }
        // marketingAction 之前被这里的映射漏掉了——NAL"标已成交"要靠它判断该弹
        // 金额面板还是走普通改状态，没有它这条判断永远是 false（2026-09-15 修）。
        setStages(
          (s.stages ?? []).map((x) => ({ stageKey: x.stageKey, label: x.label, marketingAction: x.marketingAction })),
        )
      }
    } catch {
      setError('加载失败，检查网络后再试。')
    } finally {
      setLoading(false)
      setSectionsLoading(false)
      fetchInFlightRef.current = false
    }
  }, [clientId, page, perPage, qDebounced, stageFilter, kindFilter, grouped, openSections, sectionPages])

  useEffect(() => {
    void loadList()
  }, [loadList])

  // 搜索词防抖：300ms 内还在敲就不发请求。
  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q), 300)
    return () => window.clearTimeout(t)
  }, [q])

  // 换了搜索词或筛选条件就回第一页 —— 否则会停在一个可能不存在的页码上。
  useEffect(() => {
    setPage(1)
  }, [qDebounced, stageFilter, kindFilter])

  /**
   * 直达链接 `?contact=<id>` —— 列表加载完自动打开那个人的抽屉。
   *
   * 🔴 今日待办的人工任务靠这个才算「直达」（Codex 复审 2026-08-16）。原先这页
   * 根本不读这个参数，点进来只是打开整张 583 行的表，FDE 还得自己搜名字 ——
   * 那不叫直达，那叫「我给了你一个入口，剩下你自己找」。
   *
   * 2026-09-28（魏征复审 B2）：换用抽屉之后，详情不再撑开表格行——滚到一行
   * 普通表格行、旁边再弹出半屏抽屉是两件割裂的事，不如直接触发「打开抽屉」，
   * 跟点这一行是同一个动作。
   *
   * 只认一次：认完就清掉，之后同事点谁就是谁，不会被链接拽回去。
   * 用 `window.location.search` 而不是 `useSearchParams`，免得为一个可选参数
   * 给整页套 Suspense 边界。
   */
  const [deepLinkId, setDeepLinkId] = useState<string | null>(null)
  useEffect(() => {
    setDeepLinkId(new URLSearchParams(window.location.search).get('contact'))
  }, [])

  useEffect(() => {
    if (!deepLinkId || rows.length === 0) return
    setDeepLinkId(null)
    // 这个人不在表里（换客户了 / 记录被删）——**必须说出来**，
    // 否则页面一声不吭，FDE 只会以为链接坏了。
    const stashedName = takeContactName(clientId, deepLinkId)
    if (!rows.some((r) => r.contactId === deepLinkId)) {
      // 名单只装了第一页：付款总览带来的人常在后面几页。有名字就按名字搜出来再开抽屉。
      if (stashedName) {
        openContactFromNudge(deepLinkId, stashedName)
        return
      }
      setToast('这个人不在这份名单里了 —— 用上面的搜索框找找看')
      window.setTimeout(() => setToast(null), 4000)
      return
    }
    openDrawer(deepLinkId)
    // openDrawer 依赖 sections，但只在 deepLinkId/rows 变化时触发一次就够——
    // 加进依赖数组会在每次 sections 更新时重复触发，反而打断用户手动切换。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkId, rows])

  const toggleDetail = (contactId: string) => {
    if (drawerContactId === contactId) {
      closeDrawer()
      return
    }
    openDrawer(contactId)
  }

  function findRowInSections(contactId: string): { row: ContactRow; sectionKey: SectionKey } | null {
    for (const s of sections) {
      const found = s.items?.find((r) => r.contactId === contactId)
      if (found) return { row: found, sectionKey: s.key }
    }
    return null
  }

  function openDrawer(contactId: string) {
    setDrawerContactId(contactId)
    if (grouped) {
      setDrawerSectionKey(findRowInSections(contactId)?.sectionKey ?? null)
    } else {
      setDrawerSectionKey(null)
    }
  }

  function closeDrawer() {
    setDrawerContactId(null)
    setDrawerSectionKey(null)
    setPendingNav(null)
  }

  // 当前抽屉里这个人的完整行数据——从 rows（平铺）或 sections（分段）里找，
  // 两边共用同一份 rows（loadList 里两条路径都会 setRows）。
  const drawerContactRow = useMemo(
    () => (drawerContactId ? (rows.find((r) => r.contactId === drawerContactId) ?? null) : null),
    [drawerContactId, rows],
  )

  // 数据重新加载完之后，抽屉打开的这个人如果已经不在名单里了（被筛选/搜索掉出，
  // 或者被删除）——必须说出来 + 关掉抽屉，不能让它继续显示一份过时数据。
  //
  // 🔴 `pendingNav` truthy 时必须跳过（魏征 2026-09-28 复审 B2 实现查出的真实 bug，
  // 实测：翻到下一页时这条 effect 会抢先跑——此刻新数据刚到、`rows` 换成了新一页的人，
  // 而抽屉里还挂着上一页最后那个人的 id，天然「不在这份新名单里」，被这条 effect
  // 当成「人被筛掉了」直接关掉抽屉，把 pendingNav 想打开新一页首个人的意图连带清空。
  // 翻页本来就是主动换页，不是「这个人消失了」，这段时间该由 pendingNav 那条 effect
  // 接管，不该被这条误判。
  useEffect(() => {
    if (!drawerContactId || loading || sectionsLoading || pendingNav) return
    if (!rows.some((r) => r.contactId === drawerContactId)) {
      setToast('他不在这份名单里了 —— 用上面的搜索框找找看')
      window.setTimeout(() => setToast(null), 4000)
      closeDrawer()
    }
  }, [drawerContactId, rows, loading, sectionsLoading, pendingNav])

  // 「付款要催」名单里点一个人：在当前这页就直接开抽屉，不在就先按名字搜，搜到再开。
  const openContactFromNudge = useOpenContactFromNudge({
    contactIds: rows.map((r) => r.contactId),
    loading,
    sectionsLoading,
    debouncedQuery: qDebounced,
    setQuery: setQ,
    openDrawer,
    notify: (message) => {
      setToast(message)
      window.setTimeout(() => setToast(null), 4000)
    },
  })

  // 搜索交给服务端了，这里只排当前页。放在 buildNavInput 前面——它的闭包引用 sorted，
  // 声明顺序倒过来会在渲染时踩 TDZ（"Cannot access 'sorted' before initialization"）。
  const sorted = [...rows].sort((a, b) => {
    const av = sortKey === 'firstSeenAt' ? ts(a.firstSeenAt) : ts(a.lastTouchAt)
    const bv = sortKey === 'firstSeenAt' ? ts(b.firstSeenAt) : ts(b.lastTouchAt)
    return sortDir === 'desc' ? bv - av : av - bv
  })

  /** 组装 nextNavStep 的输入——分段模式用 sections 里那一段，平铺模式用 sorted 那份已排序的行。 */
  function buildNavInput(direction: 'prev' | 'next'): NavInput | null {
    if (!drawerContactId) return null
    if (grouped && drawerSectionKey) {
      const secIdx = sections.findIndex((s) => s.key === drawerSectionKey)
      const sec = sections[secIdx]
      if (!sec || sec.items === null) return null
      const nextSec = sections[secIdx + 1] ?? null
      return {
        mode: 'segment',
        direction,
        loadedIds: sec.items.map((r) => r.contactId),
        currentIndex: sec.items.findIndex((r) => r.contactId === drawerContactId),
        sectionKey: drawerSectionKey,
        sectionTitle: sec.title,
        sectionPage: sectionPages[drawerSectionKey] ?? 1,
        perPage,
        sectionTotal: sec.total,
        nextSection: nextSec ? { key: nextSec.key, title: nextSec.title, total: nextSec.total } : null,
      }
    }
    const ids = sorted.map((r) => r.contactId)
    return {
      mode: 'flat',
      direction,
      loadedIds: ids,
      currentIndex: ids.indexOf(drawerContactId),
      page,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
    }
  }

  const navInputNow = drawerContactId ? buildNavInput('next') : null
  const navPositionLabel = navInputNow ? currentPositionLabel(navInputNow) : null
  const navBusy = pendingNav !== null

  function goNav(direction: 'prev' | 'next') {
    const input = buildNavInput(direction)
    if (!input) return
    const step = nextNavStep(input)
    if (step.kind === 'move') {
      setDrawerContactId(step.contactId)
      return
    }
    if (step.kind === 'need_more') {
      if (input.mode === 'segment') {
        setPendingNav({ mode: 'segment', sectionKey: input.sectionKey, openFirst: step.openFirst })
        const cur = sectionPages[input.sectionKey] ?? 1
        goSectionPage(input.sectionKey, direction === 'next' ? cur + 1 : cur - 1)
      } else {
        setPendingNav({ mode: 'flat', openFirst: step.openFirst })
        setPage((p) => (direction === 'next' ? p + 1 : p - 1))
      }
      return
    }
    // end_of_section / end_of_list / not_in_list —— 都只是一句话，不是错误。
    setToast(step.message)
    window.setTimeout(() => setToast(null), 4000)
  }

  // pendingNav 等的那一页数据到了（fetchInFlightRef 转 false）—— 打开首个/末个，
  // 清掉 pendingNav。出错时也要清掉，否则按钮会一直卡在禁用状态。
  //
  // 🔴 判据用 `fetchInFlightRef.current`，不用 `loading`/`sectionsLoading` 这两个
  // state（魏征 2026-09-28 复审 B2 实现查出的真实 bug，见 fetchInFlightRef 定义处的
  // 头注）：翻页点击那一刻，`setPendingNav` 触发的这批 effect 里，"负责发起请求的
  // effect" 和"这条负责消费 pendingNav 的 effect" 是在同一批处理里前后执行的——
  // 后者读到的 `loading`/`sectionsLoading` 还是这一轮渲染开始时的旧值（React 不会在
  // 同一批 effect 处理中途把新状态回灌进去），于是它会拿着上一页的旧 `rows` 把
  // pendingNav 提前消费掉。ref 读写没有这层批处理延迟，`loadList` 一开始就同步
  // 置 true，这条 effect 无论在哪一批跑到都能读到当下最新的值。
  //
  // 🔴 依赖数组里的 `loading`/`sectionsLoading` 不是摆设，虽然函数体不读它们——
  // `loadList` 里 `await Promise.all(...)` 之后还有一个 `await stageRes.json()`，
  // 中间那一刻 `rows` 已经 setRows 过了、但 `fetchInFlightRef.current` 要等到
  // 最后的 `finally` 才真正翻回 false。少了这两个依赖，`rows` 变化触发的这一次
  // 检查会因为 ref 还是 true 而跳过，而之后 `fetchInFlightRef` 真正翻 false 那一刻
  // 没有任何一个依赖跟着变，这条 effect 就再也没有机会重新检查一遍——实测过的坑，
  // 不是理论推演。
  useEffect(() => {
    if (!pendingNav) return
    if (fetchInFlightRef.current) return
    if (error) {
      setPendingNav(null)
      return
    }
    if (pendingNav.mode === 'segment') {
      const sec = sections.find((s) => s.key === pendingNav.sectionKey)
      if (!sec || sec.items === null) return
      if (sec.items.length === 0) {
        setPendingNav(null)
        return
      }
      const target = pendingNav.openFirst ? sec.items[0] : sec.items[sec.items.length - 1]
      setDrawerContactId(target.contactId)
      setDrawerSectionKey(pendingNav.sectionKey)
      setPendingNav(null)
    } else {
      const ids = sorted.map((r) => r.contactId)
      if (ids.length === 0) {
        setPendingNav(null)
        return
      }
      const target = pendingNav.openFirst ? ids[0] : ids[ids.length - 1]
      setDrawerContactId(target)
      setPendingNav(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNav, sections, rows, loading, sectionsLoading, error])

  // 写完（记一笔 / 改阶段 / 一键动作）之后：刷新列表拿到最新冷热/阶段/最近联系。
  // PersonDrawer 自己的往来时间线是独立组件（ContactTimeline），有写就自己重拉，
  // 不需要父级管——这也是换用抽屉之后能整块删掉 timeline 相关 state 的原因。
  const afterWrite = (msg: string, reload = true) => {
    setToast(msg)
    if (reload) void loadList()
    window.setTimeout(() => setToast(null), 2400)
  }

  /**
   * 点星星：置顶 / 取消置顶。
   *
   * 先本地改（乐观更新），失败再翻回来并说一句 —— 星星是即时反馈的控件，
   * 等一个来回才变色会让人以为没点上、连点两下。
   */
  const togglePin = async (row: ContactRow) => {
    const next = row.pinnedAt === null
    /**
     * 🔴 两处都要写。
     *
     * 平铺模式的行来自 `rows`，分段模式的行来自 `sections[].items` —— 只写 `rows`
     * 的那一版，在分段模式下点⭐星星永远不亮（PATCH 发出去了、库也改了，页面零反馈）。
     * 星星是即时反馈的控件，不亮就等于「我点了但没成功」。魏征 B3 / 子牙 P0-1 实测。
     */
    const paint = (pinnedAt: string | null) => {
      setRows((prev) =>
        prev.map((r) => (r.contactId === row.contactId ? { ...r, pinnedAt } : r)),
      )
      setSections((prev) =>
        prev.map((sec) => ({
          ...sec,
          items:
            sec.items?.map((r) => (r.contactId === row.contactId ? { ...r, pinnedAt } : r)) ?? null,
        })),
      )
    }
    paint(next ? new Date().toISOString() : null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${row.contactId}/pin`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: next }),
      })
      if (!res.ok) throw new Error()
    } catch {
      paint(row.pinnedAt)
      setToast('置顶失败，请重试')
      window.setTimeout(() => setToast(null), 2400)
    }
  }

  const toggleSort = (key: 'firstSeenAt' | 'lastTouchAt') => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const colCount = 6 + columns.length
  const sortArrow = (key: 'firstSeenAt' | 'lastTouchAt') =>
    sortKey === key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''

  /**
   * 这一段现在显示的是第几个到第几个。
   *
   * ⚠️ 服务端是**翻页不是累加**：`list-sections.ts` 用 `bucket.slice(start, start + perPage)`，
   * 所以 `p_<段>=2` 拿到的是第 101–200 个、**第 1–100 个会消失**。
   * 第一版我按「累加」写，按钮叫「再看 100 个」——那会让前 100 个人凭空不见，
   * 正是这一轮要修的那个毛病换个方向再犯一次。查了 slice 才改成老实的翻页。
   */
  const sectionRange = (s: PrioritySectionData): { from: number; to: number; pages: number } => {
    const page = sectionPages[s.key] ?? 1
    const from = s.total === 0 ? 0 : (page - 1) * perPage + 1
    return { from, to: (page - 1) * perPage + (s.items?.length ?? 0), pages: Math.max(1, Math.ceil(s.total / perPage)) }
  }

  /** 这一段翻到第 n 页。改了 sectionPages 会触发 loadList 重新拉。 */
  const goSectionPage = (key: SectionKey, n: number) => {
    setSectionPages((prev) => ({ ...prev, [key]: Math.max(1, n) }))
  }

  const toggleSection = (key: SectionKey) => {
    setOpenSections((prev) => {
      const base = prev ?? sections.filter((s) => s.open).map((s) => s.key)
      return base.includes(key) ? base.filter((k) => k !== key) : [...base, key]
    })
  }

  const renderRow = (r: ContactRow) => {
    const active = drawerContactId === r.contactId
    const contactCell =
      r.phone || r.email ? (
        <span className="text-me-charcoal/70">{r.phone ?? r.email}</span>
      ) : r.hasMessenger ? (
        <span className="text-me-charcoal/45">仅 FB 私信</span>
      ) : (
        <span className="text-me-charcoal/35">没留联系方式</span>
      )
    return (
      <tr
        key={r.contactId}
        // 直达链接靠它定位（?contact=<id> 打开对应抽屉）
        id={`contact-${r.contactId}`}
        onClick={() => toggleDetail(r.contactId)}
        className={`border-b border-me-charcoal/5 cursor-pointer hover:bg-me-ivory/40 ${active ? 'bg-me-ivory/50' : ''}`}
      >
        <td className="px-2 py-3">
          {/* 点星星不能顺带打开抽屉 —— 两个动作是分开的。 */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              void togglePin(r)
            }}
            title={r.pinnedAt ? '取消置顶' : '置顶'}
            aria-label={r.pinnedAt ? '取消置顶' : '置顶'}
            className={`p-1 text-base leading-none ${
              r.pinnedAt ? 'text-yellow-500' : 'text-me-charcoal/40 hover:text-me-charcoal'
            }`}
          >
            {r.pinnedAt ? '⭐' : '☆'}
          </button>
        </td>
        <td className="px-4 py-3 font-medium text-me-charcoal">
          {r.name}
          {r.important?.note && (
            <span
              title={r.important.note}
              className="ml-2 rounded bg-me-gold/20 px-1.5 py-0.5 text-[10px] font-bold text-me-charcoal/70"
            >
              ⭐ {r.important.note.length > 12 ? `${r.important.note.slice(0, 12)}…` : r.important.note}
            </span>
          )}
          {r.important?.dueAt && new Date(r.important.dueAt) < new Date() && (
            <span className="ml-1 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
              到期
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-me-charcoal/60">{fmtDate(r.firstSeenAt)}</td>
        <td className="px-4 py-3 text-me-charcoal/60">
          {r.lastTouchAt ? relTime(r.lastTouchAt) : <span className="text-me-charcoal/35">还没联系过</span>}
        </td>
        <td className="px-4 py-3">{contactCell}</td>
        {columns.map((c) => (
          <td key={c.key} className="px-4 py-3 text-me-charcoal/60">
            {r.custom[c.key] ?? <span className="text-me-charcoal/35">还没聊到</span>}
          </td>
        ))}
        <td className="px-4 py-3">
          {grouped ? (
            <>
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${LIST_CLS[r.nextAction.list]}`}>
                {r.nextAction.verbLabel}
              </span>
              <span className="ml-2 text-xs text-me-charcoal/60">{r.nextAction.reason}</span>
            </>
          ) : r.stageLabel ? (
            <span className="text-me-charcoal/70">{r.stageLabel}</span>
          ) : (
            <span className="text-me-charcoal/35">还没标</span>
          )}
        </td>
      </tr>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div>
        <Link href={`/dashboard/clients/${clientId}`} className="text-sm text-me-charcoal/40 hover:text-me-charcoal">
          ← 返回客户
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-black text-me-charcoal">全部客人</h1>
          <CrmTabs clientId={clientId} active="all" />
        </div>
        <p className="mt-1 text-sm text-me-charcoal/45">
          翻看所有人、查某个客人的来往记录。想知道今天该打谁，点上面「今天要联系」。
        </p>
      </div>

      {toast && (
        <div className="sticky top-2 z-10 rounded-xl bg-me-charcoal px-4 py-2 text-center text-sm font-black text-white">
          {toast}
        </div>
      )}

      {/* 付款要催（没开通这项功能或没权限的人，这一块什么都不渲染） */}
      <BookingTrackerPanel clientId={clientId} onOpenContact={openContactFromNudge} />

      {loading && rows.length === 0 && <p className="py-16 text-center text-sm text-me-charcoal/40">加载中…</p>}

      {error && (
        <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
          <p className="text-sm font-semibold text-[#C2453A]">{error}</p>
          <button onClick={() => void loadList()} className="mt-2 text-sm font-black text-me-charcoal underline">
            重试
          </button>
        </div>
      )}

      {/* 搜索框必须一直挂在页面上：之前它跟着下面那一大块一起被 `!loading` 包住，
          每敲一个字、过 300ms 请求一发出，整块（含输入框）被卸载再重装，焦点丢了、
          像「每打一个字页面就刷新一次」（PM 2026-10-13 录屏）。 */}
      {!error && (
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔍 客户打回来了？按名字 / 电话 / 邮箱找他"
          className="w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm focus:border-me-charcoal focus:outline-none"
        />
      )}

      {!error && qError && <p className="text-xs font-semibold text-[#C2453A]">{qError}</p>}

      {!error && !loading && (
        <>
          {stages.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-me-charcoal/45">到哪一步了：</span>
              {stages.map((s) => {
                const on = stageFilter.includes(s.stageKey)
                return (
                  <button
                    key={s.stageKey}
                    onClick={() =>
                      setStageFilter((prev) =>
                        on ? prev.filter((k) => k !== s.stageKey) : [...prev, s.stageKey],
                      )
                    }
                    className={`rounded-full border border-black/10 px-3 py-1 text-xs font-semibold ${
                      on ? 'bg-me-charcoal text-white' : 'text-me-charcoal/60'
                    }`}
                  >
                    {s.label}
                  </button>
                )
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setGrouped((v) => !v)
                // 分段视图的服务端还没接 ?kind=（B3 只接了平铺路径）——切过去时把筛选
                // 收回「全部」，不留一个选了但悄悄不生效的筛选条件（见上面状态定义处的注）。
                setKindFilter('all')
              }}
              className="rounded-lg border border-me-charcoal/15 px-3 py-1.5 text-xs font-bold text-me-charcoal hover:bg-me-ivory"
            >
              {grouped ? '← 回到平铺名单' : '✨ Magic Engine 智能'}
            </button>
            {grouped && (
              <span className="text-xs text-me-charcoal/45">
                系统读完往来记录和 AI 摘要，告诉你今天该先联系谁、做什么；段内按紧急程度排，点表头不改顺序
              </span>
            )}
            {/* 终端客户 / 同行 筛选（2026-09-28 WP-B3）——分段模式下不显示，服务端还没接。 */}
            {!grouped && (
              <div className="inline-flex rounded-lg border border-me-charcoal/15 p-0.5">
                {(
                  [
                    ['all', '全部'],
                    ['retail', '终端客户'],
                    ['trade', '🤝 同行'],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKindFilter(k)}
                    className={`rounded-md px-3 py-1 text-xs font-bold transition ${
                      kindFilter === k ? 'bg-me-charcoal text-white' : 'text-me-charcoal/60 hover:text-me-charcoal'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 批量发邮件——只在「🤝 同行」筛选下出现。人从当前已加载的 rows 来：
              同行通常是一小撮人（CTS 约 20 人），一页（100）装得下，不需要额外拉全量。
              doneToday 恒 false——"全部客人"没有"今天处理过"这个每日重置的概念，
              跟"今天要联系"那页的批次语义不是一回事，批量发送面向的是"这批同行"
              整体，不是"今天还没联系过的同行"。
              🔴 魏征 2026-09-28 复审 B3 查出：同行超过一页（100 人）时，这个面板只会
              发给当前这一页，且原来没有任何提示——容易被当成"已经是全部同行"。
              生产唯一客户 CTS 目前约 20 人不会触发，但这是结构性缺口，先在这里挡一句、
              不让人无声漏发；真要支持大批量同行客户，需要另开一条不分页的批量取数接口。 */}
          {!grouped && kindFilter === 'trade' && rows.length > 0 && (
            <>
              {total > rows.length && (
                <p className="rounded-lg border border-[#C2453A]/30 bg-[#C2453A]/8 px-3 py-2 text-xs font-semibold text-[#C2453A]">
                  ⚠️ 同行一共 {total} 人，这一页只装得下 {rows.length} 人——批量发邮件现在只会发给这一页看到的人，翻页分批发，别当成已经发给了全部同行。
                </p>
              )}
              <BatchEmail
                clientId={clientId}
                bucket={
                  {
                    batch: 'send_email',
                    people: rows.map((r) => ({ contactId: r.contactId, email: r.email, kind: 'trade', doneToday: false })),
                    batchEmails: [],
                    total: rows.length,
                  } satisfies BatchEmailBucket
                }
                onLogged={(msg) => afterWrite(msg)}
              />
            </>
          )}

          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-me-charcoal/50">
              {grouped ? `共 ${total} 位客人` : `第 ${page} 页，共 ${total} 位客人`}
            </p>
            {!grouped && <p className="text-xs text-me-charcoal/40">排序只对当前页生效</p>}
          </div>

          {/* 刚搬过来时安抚一句，别让「全空的跟进阶段」像没做完的作业 */}
          {/* `rows.length > 0`：分段模式把所有段收起来时 rows 是空数组，
              而 `[].every()` 恒为 true —— 少了这一条，对一个人人都标好阶段的客户
              也会弹出「大家的跟进到哪步都还空着」（魏征 C3 / 子牙 P1-4 实测）。 */}
          {total > 0 && rows.length > 0 && rows.every((r) => !r.stage) && (
            <p className="rounded-lg bg-me-ivory px-3 py-2 text-xs leading-relaxed text-me-charcoal/55">
              「该做什么」是系统按往来记录和 AI 摘要算的，现在就能用；点开一个人可以在里面标他到哪一步了。
            </p>
          )}

          <div className="overflow-x-auto rounded-xl border border-me-charcoal/10 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-me-charcoal/10 text-left text-xs text-me-charcoal/50">
                  <th className="px-2 py-3">⭐</th>
                  <th className="px-4 py-3">客人</th>
                  {/*
                    分段模式下**不给**排序入口：行来自服务端各段的顺序，点了也不会重排。
                    留着一个点了会变箭头、却一行都不动的按钮，等于告诉人「你排过了」。
                    魏征 B2 实测：箭头会变、顺序一字不动，而平铺那句「排序只对当前页生效」
                    的提示在分段下反而被藏起来了。
                  */}
                  <th
                    className={grouped ? 'px-4 py-3' : 'cursor-pointer select-none px-4 py-3'}
                    onClick={grouped ? undefined : () => toggleSort('firstSeenAt')}
                  >
                    进线时间{grouped ? '' : sortArrow('firstSeenAt')}
                  </th>
                  <th
                    className={grouped ? 'px-4 py-3' : 'cursor-pointer select-none px-4 py-3'}
                    onClick={grouped ? undefined : () => toggleSort('lastTouchAt')}
                  >
                    最近联系{grouped ? '' : sortArrow('lastTouchAt')}
                  </th>
                  <th className="px-4 py-3">联系方式</th>
                  {columns.map((c) => (
                    <th key={c.key} className="px-4 py-3">{c.label}</th>
                  ))}
                  <th className="px-4 py-3">{grouped ? '该做什么' : '到哪一步了'}</th>
                </tr>
              </thead>
              <tbody>
                {!grouped && sorted.length === 0 && (
                  <tr>
                    <td colSpan={colCount} className="px-4 py-10 text-center text-me-charcoal/40">
                      {qDebounced.trim() || stageFilter.length > 0 ? '没找到这个人。' : '还没有客人。'}
                    </td>
                  </tr>
                )}
                {!grouped && sorted.map((r) => renderRow(r))}
                {grouped &&
                  sections.map((s) => {
                    const open = openSections === null ? s.open : openSections.includes(s.key)
                    return [
                      <PrioritySectionHeader
                        key={`section-${s.key}`}
                        title={s.title}
                        hint={s.hint}
                        total={s.total}
                        // 段收起时 items=null——没数据就不算「今天进度」，等展开了再算，
                        // 不能拿 0 冒充「今天一个都没处理」。
                        progress={s.items ? dayProgress(s.items.map((r) => ({ handled: isToday(r.lastTouchAt) }))) : undefined}
                        open={open}
                        colSpan={colCount}
                        onToggle={() => toggleSection(s.key)}
                      />,
                      open && s.items !== null && s.key === 'hot' && s.items.length > DAILY_QUOTA
                        ? [
                            ...s.items.slice(0, DAILY_QUOTA).map((r) => renderRow(r)),
                            // 只在第一页画：翻到第二页时前面那 20 个已经看过了，线不该再出现。
                            (sectionPages[s.key] ?? 1) <= 1 && (
                              <tr key="quota-line" data-testid="quota-line">
                                <td colSpan={colCount} className="border-y border-dashed border-me-charcoal/25 bg-me-ivory/60 px-4 py-2 text-center text-xs font-bold text-me-charcoal/55">
                                  ↑ 今天先打这 {DAILY_QUOTA} 个 · 以下 {s.total - DAILY_QUOTA} 个排队，打完前面的再往下看 ↓
                                </td>
                              </tr>
                            ),
                            ...s.items.slice(DAILY_QUOTA).map((r) => renderRow(r)),
                          ]
                        : open && s.items !== null && s.items.map((r) => renderRow(r)),
                      open && s.items !== null && s.items.length === 0 && (
                        <tr key={`section-${s.key}-empty`}>
                          <td colSpan={colCount} className="px-4 py-4 text-center text-xs text-me-charcoal/35">
                            这一段现在没有人。
                          </td>
                        </tr>
                      ),
                      // 展开了但数据还在路上：白茫茫一片会让「在加载」「真的空了」「页面坏了」
                      // 三件事长得一模一样（魏征 C2）。CTS 那段 643 人要拉 ~1.4MB，这个窗口是秒级的。
                      open && s.items === null && (
                        <tr key={`section-${s.key}-loading`}>
                          <td colSpan={colCount} className="px-4 py-4 text-center text-xs text-me-charcoal/35">
                            {sectionsLoading ? '正在拿这一段的人…' : '这一段还没取回来，点一下段头重试。'}
                          </td>
                        </tr>
                      ),
                      /*
                       * 🔴 段里还有人没显示出来，必须说出来 + 给得出下一步。
                       *
                       * 服务端一段只下发 100 行。少了这一块的那一版：段头写「217 人」、
                       * 表里 100 行、**剩下 117 个人没有任何入口**。两个复审都判 BLOCKER，
                       * 形状就是 2026-08-02「33 个人凭空消失」——人数对、人不在。
                       */
                      open &&
                        s.items !== null &&
                        s.total > perPage && (
                          <tr key={`section-${s.key}-more`}>
                            <td colSpan={colCount} className="px-4 py-3 text-center text-xs">
                              <span className="text-me-charcoal/45">
                                这一段共 {s.total} 人，正在看第 {sectionRange(s).from}–{sectionRange(s).to} 个
                                （第 {sectionPages[s.key] ?? 1} / {sectionRange(s).pages} 页）
                              </span>
                              <button
                                type="button"
                                disabled={(sectionPages[s.key] ?? 1) <= 1}
                                onClick={() => goSectionPage(s.key, (sectionPages[s.key] ?? 1) - 1)}
                                className="ml-3 rounded-lg border border-me-charcoal/15 px-2.5 py-1 font-bold text-me-charcoal hover:bg-me-ivory disabled:opacity-40"
                              >
                                上一页
                              </button>
                              <button
                                type="button"
                                disabled={(sectionPages[s.key] ?? 1) >= sectionRange(s).pages}
                                onClick={() => goSectionPage(s.key, (sectionPages[s.key] ?? 1) + 1)}
                                className="ml-2 rounded-lg border border-me-charcoal/15 px-2.5 py-1 font-bold text-me-charcoal hover:bg-me-ivory disabled:opacity-40"
                              >
                                下一页
                              </button>
                            </td>
                          </tr>
                        ),
                    ]
                  })}
              </tbody>
            </table>
          </div>

          {!grouped && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-me-charcoal/50">
                共 {total} 人 · 第 {page} / {Math.max(1, Math.ceil(total / perPage))} 页
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="rounded-lg border border-black/10 px-3 py-1.5 disabled:opacity-40"
                >
                  上一页
                </button>
                <button
                  disabled={page >= Math.ceil(total / perPage)}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-lg border border-black/10 px-3 py-1.5 disabled:opacity-40"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {drawerContactRow && (
        <PersonDrawer
          // 🔴 换人必须重新挂载——见 docs/specs/2026-09-28-crm-management-hub-design-v1.md
          // 已知坑第 1 条：没有 key 时连续点两个人，子组件（如 ComposeNote）的防重复键
          // 不会跟着重置，A 记的笔记可能被记到 B 头上。
          key={drawerContactRow.contactId}
          clientId={clientId}
          row={toDrawerRow(drawerContactRow)}
          stages={stages}
          viewerEmail={viewerEmail}
          onClose={closeDrawer}
          onSaved={afterWrite}
          nav={
            navPositionLabel
              ? { positionLabel: navPositionLabel, busy: navBusy, onPrev: () => goNav('prev'), onNext: () => goNav('next') }
              : undefined
          }
        />
      )}
    </div>
  )
}
