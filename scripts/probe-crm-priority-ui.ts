/**
 * 分段视图**页面**的当场试跑 —— 拿生产真数据，把「全部客人」这一页真的渲染一遍。
 *
 * ## 跟 probe-crm-priority-view.ts 的分工
 *
 * 那一个验的是**算得对不对**（4 段人数之和 = 总人数，分段只是分组没有改判）。
 * 这一个验的是**画得出来没有**：同一份真数据喂进真页面，员工眼睛看到的到底是什么。
 *
 * 分开是因为两者会各自坏：接口算对了、页面把收起来的段整段吞掉，名单上照样凭空
 * 少人（2026-08-02 那次事故就是「算出来了但没显示」）。
 *
 * ## 为什么不是跑 dev server 点页面
 *
 * 列表接口整条路径在 `requirePaidClientAccess` 后面，脚本没有登录态进不去，
 * 而替它登录不是脚本该做的事。所以这里走 **Node 里起 jsdom + 渲染真组件**：
 * 页面代码是线上那一份，行装配用的 `responseRowFor` / `buildPriorityView` 也是
 * 线上那两个函数（正因为要验真路径，才在同一轮把 `responseRowFor` 从路由文件
 * 搬进 `lib/crm/contact-response-row.ts`）。唯一没覆盖到的是 HTTP 那一跳和登录闸。
 *
 * 🔴 **别再把「邻近那条路成了」当成「这条路成了」**：2026-09-26 NAL 止血就是
 * 验了「Meta 会放行」，没验「我们自己的代码会放行」，中间隔着一道闸，改完当场
 * 试跑才发现一条都没进来。
 *
 * ## 怎么跑
 *
 * ```bash
 * npx tsx --env-file=/path/to/.env.local scripts/probe-crm-priority-ui.ts [clientId]
 * ```
 *
 * 密钥由 `node --env-file` 加载进 `process.env`，脚本自己不读、不打印任何密钥。
 *
 * ## 它检查什么
 *
 * 1. 4 段的**段头全都画出来了** —— 包括收起来的那两段（收起来 ≠ 不显示）。
 * 2. 段头上的人数 = 接口给的 `total`，不是「这一页拿到几行」。
 * 3. 展开的段，画出来的行数 = 该段 `items` 条数；收起来的段一行都没画。
 * 4. 点一下收起来的段 → 页面确实拿它的 key 重新去要数据。
 *
 * ## 全程只有 SELECT
 *
 * 三条 `select`，无写操作。安全地对生产跑。
 */
import { JSDOM } from 'jsdom'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAll } from '@/lib/supabase-paginate'
import { buildPriorityView } from '@/lib/crm/contact-list-view'
import { buildContactModel } from '@/lib/crm/contact-model'
import {
  responseRowFor,
  stageMetaOf,
  type ContactRow,
  type TouchRow,
  type StageRow,
} from '@/lib/crm/contact-response-row'
import { visibleCustomColumns, type CustomColumnKey } from '@/lib/crm/table-columns'
import type { SectionKey } from '@/lib/crm/list-sections'

/** 默认客户 = CTS。脚本参数的缺省值，不是判据 —— 共享代码里没有客户事实。 */
const DEFAULT_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const CLIENT_ID = process.argv[2] ?? DEFAULT_CLIENT_ID

/**
 * 跟线上 `getPriority` 同款：同样三条查询、同样的 `responseRowFor` 装配。
 * 差别只有「不包 NextResponse、不过登录闸」。
 */
async function loadPriorityResponse(clientId: string, open?: Partial<Record<SectionKey, boolean>>) {
  const [contacts, touches, stageRows] = await Promise.all([
    fetchAll<ContactRow>((from, to) =>
      supabaseAdmin
        .from('contacts')
        .select(
          'id, display_name, primary_phone, primary_email, do_not_contact, snooze_until, stage, first_seen_at, pinned_at, important_note, important_due_at',
        )
        .eq('client_id', clientId)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    fetchAll<TouchRow>((from, to) =>
      supabaseAdmin
        .from('contact_touchpoints')
        .select('id, contact_id, channel, direction, occurred_at, summary, raw, metadata, source')
        .eq('client_id', clientId)
        .order('occurred_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    ),
    fetchAll<StageRow>((from, to) =>
      supabaseAdmin
        .from('client_pipeline_stages')
        .select('stage_key, label, marketing_action, is_terminal')
        .eq('client_id', clientId)
        .order('sort_order', { ascending: true })
        .range(from, to),
    ),
  ])

  const stageMeta = stageMetaOf(stageRows)
  const byId = new Map(contacts.map((c) => [c.id, c]))
  const byContact = new Map<string, TouchRow[]>()
  for (const t of touches) {
    const list = byContact.get(t.contact_id) ?? []
    list.push(t)
    byContact.set(t.contact_id, list)
  }

  const customPerContact: Array<Record<CustomColumnKey, string | null>> = []
  const { sections, focus } = buildPriorityView(
    { contacts, touchpoints: touches, stageMeta, now: new Date(), perPage: 100, open },
    (row, ranked) => {
      const tps = byContact.get(row.id) ?? []
      // 跟线上 getPriority 同一句 —— 这里的 contacts 本来就是 ContactRow[]，
      // buildPriorityView 只是把它放宽成了 ContactRowLike 传回来。
      const full = byId.get(row.id)
      if (!full) throw new Error(`装配时找不到联系人 ${row.id}`)
      const built = responseRowFor(full, tps, stageMeta, buildContactModel(row, tps, stageMeta), ranked.seg)
      customPerContact.push(built.custom)
      return built.row
    },
  )

  return { view: 'priority', focus, columns: visibleCustomColumns(customPerContact), sections }
}

/** jsdom 全局。必须在 import 页面组件**之前**装好，React 18 在模块加载时就要 document。 */
function installDom(): void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.test/dashboard/clients/x/crm/all',
    pretendToBeVisual: true,
  })
  dom.window.Element.prototype.scrollIntoView = (): void => {}
  // 逐个 defineProperty 而不是 Object.assign：Node 22 起 `navigator` 是只读的
  // getter，直接赋值会抛「which has only a getter」。
  define({
    window: dom.window,
    // next/link 在模块顶层摸 `self` —— jsdom 里它就是 window。
    self: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    history: dom.window.history,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame,
    cancelAnimationFrame: dom.window.cancelAnimationFrame,
    IS_REACT_ACT_ENVIRONMENT: true,
  })
}

/** 往 globalThis 上挂东西。只在这个一次性试跑脚本里用。 */
function define(values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
}

/**
 * 名字拿去页面上找之前先把连续空白压成一个空格。
 *
 * 🔴 不压就会误报：testing-library 默认会把 DOM 里的文字规范化（trim + 连续空白
 * 压成一个），但**不会规范化你传进去的那个字符串**。CTS 生产库里真有一条叫
 * `"Hong  Nguyen. no  pbone  call please"`（客人把备注写进了姓名栏，中间是双空格），
 * 页面明明画出来了，第一版试跑却报「少了 1 个」。
 * 探针自己判错，比不判更糟 —— 会把真问题淹在狼来了里。
 */
const norm = (text: string): string => text.replace(/\s+/g, ' ').trim()

const failed: string[] = []
function check(ok: boolean, label: string, detail: string): void {
  console.log(`${ok ? '✅' : '❌'} ${label} — ${detail}`)
  if (!ok) failed.push(label)
}

async function main(): Promise<void> {
  console.log(`\n【分段视图页面 · 当场试跑】客户 ${CLIENT_ID}\n`)

  const payload = await loadPriorityResponse(CLIENT_ID)
  const urls: string[] = []

  console.log('接口真实返回（生产库）：')
  for (const s of payload.sections) {
    console.log(
      `  ${s.key.padEnd(9)} ${String(s.total).padStart(4)} 人  ${s.open ? '展开' : '收起'}  这次下发 ${s.items?.length ?? 0} 行  「${s.title}」`,
    )
  }
  console.log(
    `  自定义列：${payload.columns.length === 0 ? '无' : payload.columns.map((c) => c.label).join(' / ')}`,
  )

  installDom()
  define({
    fetch: async (url: string) => {
      const u = String(url)
      if (u.includes('/crm/contacts')) {
        urls.push(u)
        return { ok: true, json: async () => payload }
      }
      if (u.includes('/timeline')) {
        return { ok: true, json: async () => ({ timeline: [], omittedMessages: 0 }) }
      }
      return { ok: true, json: async () => ({ stages: [] }) }
    },
  })

  // jsdom 装好之后才 import —— React / 页面组件在模块加载时就会摸 document。
  const React = (await import('react')).default
  const { render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react')
  const { default: CrmAllContactsPage } = await import('@/app/dashboard/clients/[id]/crm/all/page')

  // `useParams()` 在 Next 之外返回 null，页面第一行就炸。把真的 PathParamsContext
  // 喂给它 —— 比替换 next/navigation 模块更贴近线上（页面用的还是真的那个 hook）。
  const { PathParamsContext } = await import(
    'next/dist/shared/lib/hooks-client-context.shared-runtime'
  )
  render(
    React.createElement(
      PathParamsContext.Provider,
      { value: { id: CLIENT_ID } },
      React.createElement(CrmAllContactsPage),
    ),
  )
  fireEvent.click(await screen.findByText(/按「先联系谁」分段/))
  await waitFor(() => {
    if (!urls.some((u) => u.includes('view=priority'))) throw new Error('还没换成分段接口')
  })
  const firstSection = payload.sections[0]
  if (!firstSection) throw new Error('接口一段都没返回')
  await waitFor(() => screen.getByText(firstSection.title))

  console.log('\n页面真的画出来的：')

  // 1 + 2：每段段头都在，人数认 total
  for (const s of payload.sections) {
    const head = screen.queryAllByText(s.title)
    check(
      head.length === 1,
      `段头「${s.title}」画出来了`,
      head.length === 1
        ? `${s.open ? '展开' : '收起'}态也照样显示`
        : `找到 ${head.length} 个，期望 1 个`,
    )
    const badge = screen.queryAllByText(`${s.total} 人`)
    check(
      badge.length >= 1,
      `「${s.title}」人数 = 接口给的 ${s.total}`,
      badge.length >= 1 ? '不是「这一页拿到几行」' : `页面上找不到「${s.total} 人」`,
    )
  }

  // 3：展开的段画出它的人，收起来的段一行不画
  for (const s of payload.sections) {
    if (s.items === null) {
      check(true, `「${s.title}」收起 → 不下发也不画`, '一行都没有')
      continue
    }
    const names = s.items.map((r) => String(r.name))
    const missing = names.filter((n) => screen.queryAllByText(norm(n)).length === 0)
    check(
      missing.length === 0,
      `「${s.title}」展开 → ${names.length} 个人都画出来了`,
      missing.length === 0
        ? `前 3 个：${names.slice(0, 3).join('、') || '（空段）'}`
        : `少了 ${missing.length} 个：${missing.slice(0, 5).map((n) => JSON.stringify(n)).join('、')}`,
    )
  }

  // 4：点收起来的段 → 真的拿它的 key 重新要数据
  const collapsed = payload.sections.find((s) => !s.open)
  if (collapsed) {
    const before = urls.length
    fireEvent.click(screen.getByText(collapsed.title))
    await waitFor(() => {
      if (urls.length <= before) throw new Error('点了没重新要数据')
    })
    const last = urls[urls.length - 1] ?? ''
    check(
      last.includes('open=') && last.includes(collapsed.key),
      `点「${collapsed.title}」→ 带着它重新要数据`,
      last.slice(last.indexOf('?')),
    )
  }

  cleanup()
  console.log(
    failed.length === 0
      ? '\n【结论】全部通过：生产真数据喂进真页面，4 段都画得出来。\n'
      : `\n【结论】${failed.length} 项没过：${failed.join(' / ')}\n`,
  )
  if (failed.length > 0) process.exitCode = 1
}

main().catch((err: unknown) => {
  console.error('试跑本身挂了：', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
