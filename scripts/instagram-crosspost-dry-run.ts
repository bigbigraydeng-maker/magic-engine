/**
 * Instagram 交叉发布 —— 当场试跑（2026-10-06）。
 *
 * 做什么：在本机起一个「假 Publer」小服务，再用**真的**适配器、**真的**主流程、**真的**事件契约
 * 把一整条链路跑一遍（领单 → 审批门 → 上传 → 建帖 → 回执 → 事件 → 重跑不重发）。
 * 不碰生产库、不碰真 Publer、不碰真 Instagram：数据库换成内存、Publer 换成本机假服务、
 * Inngest 换成收件箱数组、Supabase 用占位环境变量（只为让模块能加载）。
 *
 * 用法：
 *   npx tsx scripts/instagram-crosspost-dry-run.ts
 * 退出码 0 = 全部断言成立；非 0 = 有一步没达到预期（输出里会写是哪一步）。
 */

import http from 'node:http'
import type { AddressInfo } from 'node:net'

// 占位值,仅为让 '@/lib/supabase' 能被加载(它只在导入时检查有没有这几个变量,不会真连)。
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:9'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dry-run-placeholder'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'dry-run-placeholder'
process.env.PUBLER_API_KEY = 'dry-run-key'
process.env.PUBLER_WORKSPACE_ID = 'dry-run-workspace'

const WO_DRAFT = '11111111-aaaa-4aaa-8aaa-111111111111'
const WO_LIVE = '22222222-bbbb-4bbb-8bbb-222222222222'
const CLIENT_ID = 'dddddddd-0000-4000-8000-00000000000d' // 试跑用的虚拟客户,不是任何真实客户
const IG_ACCOUNT = 'dryrunigaccount0001'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

// ─── 假 Publer ──────────────────────────────────────────────────────────────
interface FakePost { id: string; text: string; state: string; scheduled_at?: string; comments?: unknown }
interface FakePubler {
  url: string
  posts: FakePost[]
  seenHeaders: Array<Record<string, string | string[] | undefined>>
  accountsMode: 'ok' | 'missing'
  scheduleMode: 'ok' | 'http500'
  close(): Promise<void>
}

function startFakePubler(): Promise<FakePubler> {
  const state: Omit<FakePubler, 'url' | 'close'> = { posts: [], seenHeaders: [], accountsMode: 'ok', scheduleMode: 'ok' }
  let jobCounter = 0
  const jobs = new Map<string, unknown>()
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const path = (req.url ?? '').replace(/^\/api\/v1/, '')
      const body = chunks.length > 0 ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>) : null
      if (path.length > 0 && req.method !== 'HEAD') state.seenHeaders.push(req.headers)
      const send = (code: number, json: unknown) => {
        res.writeHead(code, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(json))
      }
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': '4096' })
        return res.end()
      }
      if (path === '/accounts') {
        return send(200, state.accountsMode === 'ok' ? [{ id: IG_ACCOUNT, provider: 'instagram', name: 'Dry Run Brand' }] : [])
      }
      if (path === '/media/from-url' && req.method === 'POST') {
        const job = `job-media-${++jobCounter}`
        jobs.set(job, { status: 'complete', payload: [{ id: `media-${jobCounter}-abcdef` }] })
        return send(200, { job_id: job })
      }
      if (path === '/posts/schedule' && req.method === 'POST' && state.scheduleMode === 'http500') {
        return send(500, { error: 'upstream timeout' }) // 模拟「建帖请求发出去了但不知道有没有受理」
      }
      if (path === '/posts/schedule' && req.method === 'POST') {
        const bulk = (body?.bulk ?? {}) as { state?: string; posts?: Array<{ networks?: Record<string, { text?: string }>; accounts?: Array<{ scheduled_at?: string; comments?: unknown }> }> }
        const post = bulk.posts?.[0]
        const job = `job-post-${++jobCounter}`
        state.posts.push({
          id: `post-${jobCounter}-abcdef`,
          text: post?.networks?.instagram?.text ?? '',
          state: bulk.state ?? 'unknown',
          scheduled_at: post?.accounts?.[0]?.scheduled_at,
          comments: post?.accounts?.[0]?.comments,
        })
        jobs.set(job, { status: 'complete', payload: { failures: {} } })
        return send(200, { job_id: job })
      }
      if (path.startsWith('/job_status/')) return send(200, jobs.get(path.split('/').pop() ?? '') ?? { status: 'failed' })
      if (path.startsWith('/posts')) {
        const wanted = new URL(`http://x${path}`).searchParams.get('state')
        return send(200, { posts: state.posts.filter((p) => p.state === wanted) })
      }
      return send(404, { error: 'not found' })
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      resolve({
        ...state,
        get posts() { return state.posts },
        get seenHeaders() { return state.seenHeaders },
        get accountsMode() { return state.accountsMode },
        set accountsMode(v) { state.accountsMode = v },
        get scheduleMode() { return state.scheduleMode },
        set scheduleMode(v) { state.scheduleMode = v },
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      } as FakePubler)
    })
  })
}

async function main(): Promise<void> {
  const fake = await startFakePubler()
  const { createPublerInstagramAdapter } = await import('../src/lib/factory/publish/instagram-publer-adapter')
  const { runInstagramCrosspost } = await import('../src/lib/factory/publish/instagram-crosspost')
  const { readReceipt, ACCOUNT_RETRY_MINUTES } = await import('../src/lib/factory/publish/instagram-receipt')
  const { REEL_AUTO_CHECK_KEYS, REEL_HUMAN_CHECK_KEYS } = await import('../src/lib/social/content-review')
  type Candidate = import('../src/lib/factory/publish/instagram-crosspost').CrosspostCandidate

  // 适配器与主流程共用同一个「现在」,这样排期时间可以被精确断言
  let currentNow = new Date('2026-10-06T10:00:00.000Z')
  const adapter = createPublerInstagramAdapter({ baseUrl: `${fake.url}/api/v1`, sleep: async () => undefined, now: () => currentNow })

  const checklist = (keys: readonly string[], judge: 'AUTO' | 'HUMAN') =>
    keys.map((key) => ({
      key, judge, outcome: 'PASS', detail: 'ok',
      source_ref: judge === 'HUMAN' && key.startsWith('factual_claims') ? 'brief:master' : null,
    }))
  const makeRow = (id: string, fbState: 'DRAFT' | 'PUBLISHED', publishedAt: string): Candidate => ({
    id, client_id: CLIENT_ID, master_brief_id: null, angle: 'Sample angle',
    brief: { angle: 'Sample angle', copy: { caption: 'A sample caption for the dry run.', endcard: { cta: 'Book now', url: 'https://example.test/tours', offer: ['From $1,000'] } } },
    output: { video_path: `renders/${CLIENT_ID}/${id}/final.mp4`, quality_checklist_auto: checklist(REEL_AUTO_CHECK_KEYS, 'AUTO') },
    review_ref: { checklist_human: checklist(REEL_HUMAN_CHECK_KEYS, 'HUMAN') },
    published_ref: { platform: 'facebook', post_id: '2259550698170048', video_state: fbState, published_at: publishedAt },
    updated_at: '2026-10-06T00:00:00.000Z',
  })

  const now = currentNow
  const rows = new Map<string, Candidate>([
    [WO_DRAFT, makeRow(WO_DRAFT, 'DRAFT', '2026-10-05T20:00:00.000Z')],
    [WO_LIVE, makeRow(WO_LIVE, 'PUBLISHED', '2026-08-31T00:00:00.000Z')], // 老片:超过 48 小时,必须不跟发
  ])
  let clock = 0
  const store = {
    async listCandidates() { return Array.from(rows.values()) },
    async loadInstagramTarget() {
      return { platform: 'publer' as const, publer_account_id: IG_ACCOUNT, publer_provider: 'instagram', client_id: CLIENT_ID, expect_brand: 'Dry Run Brand' }
    },
    async writeOutput(id: string, expected: string, output: Record<string, unknown>) {
      const row = rows.get(id)
      if (!row || row.updated_at !== expected) return { ok: false as const }
      const updatedAt = new Date(now.getTime() + ++clock * 1000).toISOString()
      rows.set(id, { ...row, output, updated_at: updatedAt })
      return { ok: true as const, updatedAt }
    },
  }
  const events: Array<{ id: string; name: string; data: Record<string, unknown> }> = []
  const books: string[] = []
  const deps = {
    store, adapter,
    scanCaption: async () => null,
    publicBase: () => fake.url,
    emit: async (e: { id: string; name: string; data: Record<string, unknown> }) => { events.push(e); return { event_ids: [`dry-run-${events.length}`] } },
    recordBooks: async (id: string) => { books.push(id) },
    now: () => now,
    newRequestId: () => 'aaaaaaaa-0000-4000-8000-00000000000a',
  }

  console.log('\n═══ 第 1 轮：草稿模式（FACTORY_PUBLISH_LIVE 没开）═══')
  const run1 = await runInstagramCrosspost({ live: false }, deps)
  console.log(JSON.stringify(run1))
  const r1 = readReceipt(rows.get(WO_DRAFT)?.output)
  check('结果是 drafted', run1.result === 'drafted')
  check('假 Publer 里存的是草稿(state=draft)', fake.posts.length === 1 && fake.posts[0].state === 'draft')
  check('草稿没有排期时间(不会自己发出去)', fake.posts[0].scheduled_at === undefined)
  check('首评(追踪链接)随帖提交,且来源标 instagram', JSON.stringify(fake.posts[0].comments).includes('utm_source=instagram'))
  check('回执:draft / no_publish=true / DRAFT_ONLY', r1?.status === 'draft' && r1.no_publish === true && r1.authorization === 'DRAFT_ONLY')
  check('正文末尾带不可见幂等标记', /[⁣​‌]{8,}$/.test(fake.posts[0].text))
  check('发出的事件是草稿口径(no_publish=true)', events.length === 1 && events[0].data.no_publish === true && events[0].name === 'me/factory.reel.instagram.submitted')
  check('回执里记下了事件回执 id', (r1?.event_ids ?? []).length === 1)
  check('没写「已发布」三本账(草稿不算发布)', books.length === 0)
  check('旧片(8-31,超 48 小时)没有被跟发', readReceipt(rows.get(WO_LIVE)?.output) === null)
  check('每个发给 Publer 的请求都带 UA 与 Bearer-API 头', fake.seenHeaders.length > 0 && fake.seenHeaders.every((h) => h['user-agent'] === 'Mozilla/5.0' && String(h['authorization']).startsWith('Bearer-API ')))

  console.log('\n═══ 第 2 轮：立刻重跑（不许重复发）═══')
  const before = fake.posts.length
  const run2 = await runInstagramCrosspost({ live: false }, deps)
  console.log(JSON.stringify(run2))
  check('没有新候选', run2.result === 'no_candidate')
  check('Publer 里帖子数量没变(没重发)', fake.posts.length === before)

  console.log('\n═══ 第 3 轮：Publer 账号掉线（假服务返回空账号列表）═══')
  rows.set(WO_DRAFT, makeRow(WO_DRAFT, 'DRAFT', '2026-10-05T20:00:00.000Z')) // 回到「没发过」
  fake.posts.length = 0
  fake.accountsMode = 'missing'
  const run3 = await runInstagramCrosspost({ live: false }, deps)
  console.log(JSON.stringify(run3))
  const r3 = readReceipt(rows.get(WO_DRAFT)?.output)
  check('结果是 failed,且归类为账号问题', run3.result === 'failed' && r3?.failure_kind === 'account')
  check('什么都没发(Publer 里 0 条)', fake.posts.length === 0)
  check(`${ACCOUNT_RETRY_MINUTES} 分钟后才重试,且不占用重试次数`, r3?.next_retry_at === new Date(now.getTime() + ACCOUNT_RETRY_MINUTES * 60_000).toISOString() && r3.attempts === 0)

  console.log('\n═══ 第 4 轮：账号接回来 + 打开总开关(live)，但 Facebook 那条还是草稿 ═══')
  fake.accountsMode = 'ok'
  const later = new Date(now.getTime() + 2 * 3600_000)
  currentNow = later
  const run4 = await runInstagramCrosspost({ live: true }, { ...deps, now: () => later })
  console.log(JSON.stringify(run4))
  check('Facebook 还没真发 → Instagram 绝不抢先(不发)', run4.result === 'no_candidate' && fake.posts.length === 0)

  console.log('\n═══ 第 5 轮：总开关打开 + Facebook 已真发 ═══')
  rows.set(WO_DRAFT, { ...makeRow(WO_DRAFT, 'PUBLISHED', '2026-10-06T09:00:00.000Z'), output: rows.get(WO_DRAFT)!.output, updated_at: rows.get(WO_DRAFT)!.updated_at })
  const run5 = await runInstagramCrosspost({ live: true }, { ...deps, now: () => later })
  console.log(JSON.stringify(run5))
  const r5 = readReceipt(rows.get(WO_DRAFT)?.output)
  check('结果是 scheduled', run5.result === 'scheduled')
  check('Publer 里是排期帖,时间 = 现在 + 3 分钟', fake.posts[0]?.state === 'scheduled' && fake.posts[0].scheduled_at === new Date(later.getTime() + 180_000).toISOString(), fake.posts[0]?.scheduled_at)
  check('回执:scheduled / AUTHORIZED / 带排期时间', r5?.status === 'scheduled' && r5.authorization === 'AUTHORIZED' && Boolean(r5.scheduled_at))
  check('真排期才写三本账', books.includes(WO_DRAFT))


  console.log('\n═══ 第 6 轮：建帖请求返回 500（不知道有没有受理）→ 不许因此重复发 ═══')
  const WO_UNSURE = '33333333-cccc-4ccc-8ccc-333333333333'
  rows.set(WO_UNSURE, makeRow(WO_UNSURE, 'PUBLISHED', '2026-10-06T09:30:00.000Z'))
  rows.delete(WO_DRAFT)
  fake.posts.length = 0
  fake.scheduleMode = 'http500'
  const run6 = await runInstagramCrosspost({ live: false }, { ...deps, now: () => later })
  console.log(JSON.stringify(run6))
  const r6 = readReceipt(rows.get(WO_UNSURE)?.output)
  check('结果是 failed/uncertain', run6.result === 'failed' && run6.detail === 'uncertain')
  check('回执保持「创建中」,没有写成可重试的失败', r6?.status === 'creating' && r6.attempts === 0)
  fake.scheduleMode = 'ok'
  const run6b = await runInstagramCrosspost({ live: false }, { ...deps, now: () => new Date(later.getTime() + 60_000) })
  check('一分钟后再跑:视为在途,不动、不重发', run6b.result === 'no_candidate' && fake.posts.length === 0)
  const run6c = await runInstagramCrosspost({ live: false }, { ...deps, now: () => new Date(later.getTime() + 20 * 60_000) })
  console.log(JSON.stringify(run6c))
  check('20 分钟后:只对账(找不到就转人工),仍然不重发', run6c.result === 'failed' && fake.posts.length === 0 && readReceipt(rows.get(WO_UNSURE)?.output)?.next_retry_at === null)

  await fake.close()
  console.log(failures === 0 ? '\n全部通过 ✅' : `\n有 ${failures} 项没达到预期 ❌`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('试跑本身出错:', e)
  process.exit(2)
})
