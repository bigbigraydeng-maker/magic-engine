/**
 * 下发给人的任务，链接必须真的能点开（2026-08-03）。
 *
 * PM 2026-08-03 原话：「里面很多工作并不能通过点击完成，比如你给的 gsc 收录链接，
 * 点过去就是 404。这样徒增了我和 fde 的工作时间。」
 *
 * 这是同一个毛病第三次犯：
 *   ① 「需要你动手」首日两条建议全错（图片当页面报 / 让人做谷歌已拒绝的事）
 *   ② CTS 标题执行手三跑空手（按网址猜文件名，前提本身就错）
 *   ③ 这次：GSC 深链 404
 * 共同根因 —— **我验证的是「生成了链接」，不是「链接点得开」**。
 *
 * 🔴 而且实测发现，"点得开" 这件事对登录类工具**测不出来**：
 *    GSC 的正确链接和错误链接，对机器都返回 200（返回的是登录页外壳），
 *    404 是登录之后前端用 JS 画出来的。所以「上线前 curl 一遍」这个办法
 *    在 google.com / facebook.com 这类站上是假的安全感。
 *
 * 所以规矩改成两条：
 *   1. **公开网址**：可以也必须实测可达，不通不下发
 *   2. **登录后才能看的**：一律不用深链。给一个稳定的入口页，
 *      并在 how 里写清楚「进去之后干什么」，让人不点链接也能照做。
 *      深链省的是三秒，赌错代价是一次白跑 —— 不划算。
 */

/** 这些站的链接机器验不了：未登录一律返回登录页外壳，看不出目标存不存在。 */
const LOGIN_REQUIRED_HOSTS = [
  // 我们自己的后台也在此列：实测 2026-08-05，未登录访问
  // app.magicengine.com.au/dashboard/... 会 307 跳到 /login 再返回 200，
  // **好链接和坏链接返回的是同一个东西**。curl 出来的 200 是假信号，
  // 跟下面那些 Google/Facebook 站是同一个坑。
  'app.magicengine.com.au',
  'search.google.com',
  'business.google.com',
  'analytics.google.com',
  'ads.google.com',
  'adsmanager.facebook.com',
  'business.facebook.com',
  'facebook.com',
  // Mailchimp 后台同一个坑：未登录访问 admin.mailchimp.com 会 302 跳
  // login.mailchimp.com 再返回 200 —— 今天 curl 出来是「好链接」，哪天 Mailchimp
  // 对 Render 的出口 IP 返 403，整条「待确认付款」人工车道会被 dropBrokenLinks
  // 静默丢掉，只剩一行 console.warn。那正是铁律 3 下半禁止的断头。
  'mailchimp.com',
]

// 本仓库是私有仓库（2026-09-21 实测 `gh repo view --json visibility`）——未登录
// 直接 curl 任意 blob 深链一律 404（跟登录墙同一个信号，不是链接本身有问题）。
// 不加这条，`client-doc-manual-tasks.ts` 里指向本仓库文件的 GitHub 深链会被
// `dropBrokenLinks` 当成「打不开」静默丢掉——待办本身消失，人根本看不到。
// 只挡这一个私有仓库的路径，不把整个 github.com 当登录墙——公开仓库/PR 链接
// （比如 client-doc-manual-tasks.ts 之外别处用到的公开 issue/PR 深链）应该照常
// 能被 verifyActionLink 实测，一刀切封掉整个域名会让那些链接也变成「验不了」。
const PRIVATE_REPO_PATH_PREFIX = '/bigbigraydeng-maker/magic-engine'

function isPrivateRepoPath(href: string): boolean {
  try {
    const url = new URL(href)
    const host = url.hostname.replace(/^www\./, '')
    return host === 'github.com' && url.pathname.startsWith(PRIVATE_REPO_PATH_PREFIX)
  } catch {
    return false
  }
}

export function isLoginRequiredHost(href: string): boolean {
  if (isPrivateRepoPath(href)) return true
  try {
    const host = new URL(href).hostname.replace(/^www\./, '')
    return LOGIN_REQUIRED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
  } catch {
    return false
  }
}

export type LinkVerdict =
  /** 实测可达 */
  | { kind: 'ok' }
  /** 实测打不开 —— 不该下发 */
  | { kind: 'broken'; status: number | null }
  /** 登录类站点，机器验不了 —— 必须用稳定入口 + 文字步骤 */
  | { kind: 'unverifiable' }

// 🔴（2026-09-15，PM 报生产 /dashboard/today 打开转圈转不出来，排查该页面时
// 顺手发现的隐患，不是这次故障已确认的根因——本文件已有的 `LOGIN_REQUIRED_HOSTS`
// 排除了 app.magicengine.com.au 自身，所以这次疑似受影响的两类新待办
// (messenger-draft-items.ts / knowledge-fact-expiring-items.ts) 的链接其实
// 从不会走到下面这次真正的 fetch。但这两次 `fetchImpl` 调用本身此前完全没有
// 超时——任何一个不在 LOGIN_REQUIRED_HOSTS 里、又恰好响应慢/卡住的公开网址
// （GSC/客户官网等），都会让调用方 `dropBrokenLinks` 的 `Promise.all` 永远
// 不 resolve，进而让 `/dashboard/today` 整个接口挂起且不报错——跟这次症状
// （转圈、不报错）完全吻合，属于同一类风险，先补上防止真正撞上时更难查。
const LINK_VERIFY_TIMEOUT_MS = 8_000

/**
 * 验证一条待办链接。
 *
 * 登录类站点直接返回 unverifiable，**不去 curl** —— curl 出来的 200 是假信号，
 * 拿它当「验过了」比不验更危险。
 */
export async function verifyActionLink(
  href: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LinkVerdict> {
  if (isLoginRequiredHost(href)) return { kind: 'unverifiable' }
  try {
    const res = await fetchImpl(href, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(LINK_VERIFY_TIMEOUT_MS),
    })
    if (res.ok) return { kind: 'ok' }
    // 有些站不认 HEAD，退一次 GET 再判
    const res2 = await fetchImpl(href, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(LINK_VERIFY_TIMEOUT_MS),
    })
    return res2.ok ? { kind: 'ok' } : { kind: 'broken', status: res2.status }
  } catch {
    // 超时(AbortSignal 抛的 TimeoutError)跟其它网络异常同一个归宿——
    // 判 broken，不下发，不让调用方无限期等下去。
    return { kind: 'broken', status: null }
  }
}

/**
 * 链接实测结论的进程内缓存（2026-09-26，PM 报 /dashboard/today「loading 非常慢」）。
 *
 * 之前每打开一次今日待办页，每条公开链接都现场 HEAD（不通再 GET）一遍，
 * 各 8 秒超时 —— 一个慢站就能让整页多等十几秒。同一条链接十分钟内的结论
 * 不会变，所以只存实测过的 ok / broken（含超时），unverifiable 本来就不发请求。
 * 页面和每日邮件共用这一份，同一条链接两边结论一致。
 */
export type LinkVerdictCache = Map<string, { at: number; verdict: LinkVerdict }>

export const LINK_VERDICT_TTL_MS = 10 * 60 * 1000

export const sharedLinkVerdictCache: LinkVerdictCache = new Map()

export function verifyActionLinkCached(
  href: string,
  fetchImpl: typeof fetch,
  cache: LinkVerdictCache,
  now: () => number = Date.now,
): Promise<LinkVerdict> {
  const hit = cache.get(href)
  if (hit && now() - hit.at < LINK_VERDICT_TTL_MS) return Promise.resolve(hit.verdict)
  return verifyActionLink(href, fetchImpl).then((verdict) => {
    if (verdict.kind !== 'unverifiable') cache.set(href, { at: now(), verdict })
    return verdict
  })
}

/**
 * GSC 属性首页 —— 稳定入口，不是深链。
 *
 * 深链 `/inspect?resource_id=…&id=…` 在实际使用中会 404（多账号、属性未选中等），
 * 而这一层只要账号有权限就一定打得开。少省三秒，换掉一次白跑。
 */
export function gscPropertyUrl(siteUrl: string): string {
  return `https://search.google.com/search-console?resource_id=${encodeURIComponent(siteUrl)}`
}

/**
 * 登录类任务的操作说明必须**自带步骤**，不能只说「打开链接点一下」。
 *
 * 判据：链接万一没落到目标位置，光看这段文字还做不做得成？做不成就是不合格。
 */
export function gscInspectSteps(pageUrl: string): string {
  return `进去后在页面最上方那条搜索框里粘贴这个网址：${pageUrl}`
}
