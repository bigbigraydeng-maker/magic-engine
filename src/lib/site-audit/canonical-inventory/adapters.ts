/**
 * 把现有 site-audit 能力接到台账契约上（Issue #930 · WP05 前置）。
 *
 * 🔴 这个文件是「复用」这件事的落点：发现 / 抓取 / 分类 / GEO 检测**全部**来自现有模块，
 *    这里只做参数转接，一行采集逻辑都不重写。
 *
 * 🔴 没有默认的 store —— 落库适配器要等激活被单独授权后再接。
 *    这一层给不出 store，就没有任何路径能从代码里写到生产台账。
 */

import { crawlPages, discoverSitemapUrls, type CrawlOptions, type CrawlResult } from '../crawler'
import { enrichCrawledPage } from '../page-enrichment'
import type { ActivationDeps, CanonicalInventoryStore } from './types'
import { normaliseApprovedHosts } from './url-rules'

export interface HostDiscoveryResult {
  readonly host: string
  /** **这个主机自己的**页面数（按解析后的 hostname 精确归属，不是发现器返回的总条数）。 */
  readonly count: number
  /** 发现这个主机时返回的、其实属于别的主机的条数 —— 记下来，不丢掉。 */
  readonly foreignCount: number
  readonly error: string | null
}

export interface DiscoveryOutcome {
  /** 所有主机合并去重后的原始 URL。 */
  readonly urls: readonly string[]
  /** 每个主机各自发现了多少 —— 0 条也要看得见，不许被合并结果盖住。 */
  readonly perHost: readonly HostDiscoveryResult[]
}

/**
 * 发现候选 URL —— 直接用现有 `discoverSitemapUrls`
 * （robots / sitemap / sitemap_index / 首页 BFS / Jina 兜底，五级回退全在里面）。
 *
 * 🔴 **逐个批准主机各发现一遍再合并**，不是只跑一个域名。
 *    批准清单里可以有裸域 + `www` + 子域，而它们完全可能是**互不链接的独立站点**
 *    （#930 的现场就是这样）。只跑第一个的 robots / sitemap / 首页，
 *    第二个站的页面根本不会出现在候选里 —— 复核和激活照样成功，
 *    产出一份**静默缺页**的台账。缺页比多页危险：多的会被人看见并拒掉，缺的没人会发现。
 *
 * 🔴 逐主机的条数原样返回。某个主机 0 条可能是站点空、也可能是被 WAF 挡了，
 *    两者都得让人看见再决定，不能悄悄当成「这个站没有页面」。
 *
 * 🔴 返回的是**原始串**，而且 crawler 内部的同源过滤是宽松的（剥 www + 前缀比较）。
 *    所以结果必须再过 `buildInventoryPlan()` 的精确主机闸，不能直接拿来用。
 */
export async function discoverCandidateUrls(approvedHosts: readonly string[]): Promise<DiscoveryOutcome> {
  const seen = new Set<string>()
  const perHost: HostDiscoveryResult[] = []

  // 🔴 先归一再发请求。`hostnameOf()` 给的是小写 hostname，主机名带大写传进来
  //    （`Example.COM`）会一条都对不上 —— 实际发现到的页面被记成 `count: 0`
  //    加一堆 `foreignCount`，然后计划那边要求人去认一个其实好端端的站。
  //    方向是安全的，但它是假警报，而假警报会训练人闭眼点「认了」，那道闸就废了。
  //
  //    用的是 `normaliseApprovedHosts()` 而不是自己 `trim().toLowerCase()`：
  //    它同时校验格式（带 scheme / 端口 / 路径 / 通配符一律抛）并去重，
  //    跟 `buildInventoryPlan()` 是**同一个**函数 —— 两边口径不许各写各的。
  //    畸形清单在这里就抛掉，比发完一轮网络请求再抛好。
  for (const host of normaliseApprovedHosts(approvedHosts)) {
    perHost.push(await discoverOneHost(host, seen))
  }

  return { urls: Array.from(seen), perHost }
}

/**
 * 跑一个主机的发现，并**如实**记账。
 *
 * 🔴 两件事都不能想当然：
 *    1. **「找到了东西」≠「找到了这个站的东西」。** crawler 的同源过滤是宽松的
 *       （剥 www + 前缀比较），跑 A 主机时完全可能只返回 B 主机的 URL ——
 *       按返回总条数记账，A 就被记成「有页面」，那道「0 条必须有人认」的闸永远不响，
 *       而 A 整个站静默缺席。所以只数**解析后 hostname 精确等于本主机**的那些。
 *    2. **「没抛错」≠「找全了」。** discoverSitemapUrls 每一级回退都会吞掉失败继续走，
 *       一棵子 sitemap 取不到、其余还有结果时，它正常返回 —— 部分结果长得跟完整结果一样。
 *       所以接上它的观察口，任何被吞掉的失败都记成 error，交给人去认。
 */
async function discoverOneHost(host: string, seen: Set<string>): Promise<HostDiscoveryResult> {
  const swallowed: string[] = []
  let found: readonly string[] = []
  try {
    // 🔴 传 `https://${host}` 而不是裸主机：crawler 的 normaliseDomain 用
    //    `input.startsWith('http')` 判断有没有 scheme，于是 `httpbin.org` 这种
    //    **字面量以 http 开头的合法主机**会被当成已带 scheme，直接 new URL() 抛错 ——
    //    那个站连一次请求都发不出去，却只会被记成「0 条 / 出错」。
    found = await discoverSitemapUrls(`https://${host}`, {
      onIssue: (issue) => swallowed.push(`${issue.stage}${issue.url ? ` ${issue.url}` : ''}: ${issue.error}`),
    })
  } catch (err) {
    // 整个发现挂掉也必须留痕 —— 否则它会长得跟「这个站没有页面」一样。
    return { host, count: 0, foreignCount: 0, error: err instanceof Error ? err.message : String(err) }
  }

  const own = new Set<string>()
  let sitemapFiles = 0
  for (const url of found) {
    // 🔴 sitemap 文件不是页面。crawler 的 Level 1 只对 /sitemap.xml 做一次 <loc> 解析，
    //    如果它本身是一个 sitemap index，返回的就是 page-sitemap.xml 之类的**子索引**。
    //    把它们当页面记账，会得到「正数、无错误」的漂亮账，而真实页面全部静默缺席。
    if (isSitemapFile(url)) {
      sitemapFiles++
      continue
    }
    if (!seen.has(url)) seen.add(url)
    // 🔴 按主机**去重**计数：计划那边会拿候选清单里属于本主机的**唯一** URL 数
    //    跟这个数字对账，重复计数会让对账假红。
    if (hostnameOf(url) === host) own.add(url)
  }
  const count = own.size
  if (sitemapFiles > 0) {
    swallowed.push(
      `发现结果里有 ${sitemapFiles} 个 sitemap 文件而不是页面（多半是 /sitemap.xml 本身是索引，没有被展开）`,
    )
  }
  const error =
    swallowed.length > 0
      ? `发现过程中有 ${swallowed.length} 处失败被吞掉（结果可能不完整）：${swallowed.slice(0, 3).join('；')}`
      : null
  return { host, count, foreignCount: found.length - count - sitemapFiles, error }
}

/** `.xml` 结尾（可带 query）= sitemap 文件，不是页面。 */
function isSitemapFile(url: string): boolean {
  return /\.xml(\?[^#]*)?$/i.test(url)
}

/** 解析不了就返回 null —— 绝不用字符串包含去猜归属。 */
function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * 抓取适配器：现有 `crawlPages`（限流 + 容错 + 反爬指纹识别）。
 *
 * 🔴 上限必须按**这一次被接受的页面数**来给，不能吃 `crawlPages` 的默认 100
 *    （`crawler.ts:411`、`:415` 会 `urls.slice(0, limit)`）。被接受清单超过 100 条时，
 *    多出来的 URL 会连结果都没有，激活方只能看到「抓取器没返回这一条」——
 *    整次激活在跑完 100 次真实网络请求之后失败，而且原因看着像抓取挂了，
 *    实际上是配置把批准过的清单截断了。
 *
 * 显式传了一个更小的上限，就是配置本身有问题：**直接抛**，别让它退化成一堆看不懂的失败。
 */
export function createCrawlAdapter(
  opts?: CrawlOptions,
): (urls: readonly string[]) => Promise<readonly CrawlResult[]> {
  return (urls) => {
    if (opts?.limit !== undefined && opts.limit < urls.length) {
      throw new Error(
        `抓取上限 ${opts.limit} 小于被接受的页面数 ${urls.length} —— ` +
          '被批准的是这一整份清单，截断之后跑出来的不是那份清单',
      )
    }
    return crawlPages([...urls], { ...opts, limit: urls.length })
  }
}

/**
 * 组装激活依赖。store 必须由调用方给 —— 见文件头。
 */
export function createActivationDeps(input: {
  readonly store: CanonicalInventoryStore
  readonly now: () => string
  /**
   * 验签。**必须由调用方给**，这里不提供默认实现 ——
   * 一个「默认恒真」的验签器等于没有这道闸，而且没人会注意到它不见了。
   */
  readonly verifyReviewSignature: (planHash: string, signature: string) => boolean
  readonly crawlOptions?: CrawlOptions
}): ActivationDeps {
  return {
    store: input.store,
    verifyReviewSignature: input.verifyReviewSignature,
    crawl: createCrawlAdapter(input.crawlOptions),
    enrich: enrichCrawledPage,
    now: input.now,
  }
}
