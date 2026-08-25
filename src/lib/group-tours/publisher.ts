/**
 * 团发布编排 —— payload → 安全改写目标网站数据文件 → 开 Draft PR。
 *
 * 编排模式参照 `src/lib/capabilities/page-apply-optimization/index.ts` 已验证
 * 过的强化模式（createBranchWithMarker + 422 恢复靠 commit message 里的 run
 * 标记核对所有权 + createPullRequest 同理靠 getPullRequestDetail receipt 核对），
 * 而不是更简单、没有并发防护的 `blog-publisher.ts`/`seo-fix-orchestrator.ts`——
 * 这是设计复审（子牙/魏征）明确要求的：发布这一步是 A 级风险，理应用库里
 * 已有的更强方案，不是回头再踩一遍旧坑。
 *
 * 不接入完整 Kernel/Capability 框架 —— group_tours 走自己的状态机，不需要
 * kernel_run_id/authorization_decision_id 那一整套；只借用"发布前原子状态锁
 * 防并发"+"分支/commit/PR 各自的 422 恢复靠身份标记核对"这两条核心保护，
 * 按当前调用方需要的最小契约实现。
 */

import { randomBytes } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { getConnection } from '@/lib/cms/connection-store'
import { GithubClient, GitHubApiError } from '@/lib/cms/github-client'
import { findSharedIdentifiers } from '@/lib/clients/cross-client-audit'
import { safeFetchText, ResponseTooLargeError } from '@/lib/net/safe-fetch'
import { CMS_ACTION_TYPE } from '@/lib/cms/vocabulary'
import {
  insertOrReplaceTourObject,
  NonLiteralTourObjectError,
  TourArrayNotFoundError,
  TourSlugConflictError,
} from './tour-object-writer'
import type { GroupTourPayload, GroupTourClaim } from './types'

const BRANCH_PREFIX = 'feat/me-tour-'
const TOURS_ARRAY_NAME = 'tours'

export type PublishErrorCode =
  | 'NOT_FOUND'
  | 'ALREADY_PUBLISHING'
  | 'MISSING_REQUIRED_FIELDS'
  | 'NOT_CONFIRMED'
  | 'NO_CONNECTION'
  | 'NO_CONTENT_PATH'
  | 'CROSS_CLIENT_CONFLICT'
  | 'GITHUB_READ_ERROR'
  | 'NON_LITERAL_OBJECT'
  | 'ARRAY_NOT_FOUND'
  | 'SLUG_CONFLICT'
  | 'SYNTAX_INVALID'
  | 'GITHUB_WRITE_ERROR'
  | 'GITHUB_PR_ERROR'

export type PublishResult =
  | { ok: true; prUrl: string; prNumber: number; branchName: string; mode: 'inserted' | 'replaced' }
  | { ok: false; reason: string; code: PublishErrorCode }

interface GroupTourRow {
  id: string
  client_id: string
  status: string
  title: string
  slug: string
  payload: GroupTourPayload
  confidence_notes: string[]
  client_claims_to_verify: GroupTourClaim[]
  required_fields_confirmed: boolean
}

class PublishStepError extends Error {
  code: PublishErrorCode
  /** 只在 GitHub 侧 PR 可能已经创建（外部副作用已发生）时才带上 —— 调用方靠它
   *  判断能不能把发布锁直接还回去，还是要保留 pr_open 等 pr-sync cron 对账，
   *  防止重试生成新分支/新 PR，同一个团挂出多个冲突的 Draft PR。 */
  prInfo?: { prNumber: number; prUrl: string }
  constructor(message: string, code: PublishErrorCode, prInfo?: { prNumber: number; prUrl: string }) {
    super(message)
    this.code = code
    this.prInfo = prInfo
  }
}

// ─── 对外主函数 ──────────────────────────────────────────────────────────────

export async function publishGroupTour(params: { clientId: string; tourId: string }): Promise<PublishResult> {
  const { clientId, tourId } = params

  const loaded = await loadPublishableTour(clientId, tourId)
  if (!loaded.ok) return loaded

  const lease = await acquirePublishLease(tourId)
  if (!lease.ok) return lease

  try {
    const result = await doPublish(clientId, loaded.tour)
    await recordPublishSuccess(tourId, clientId, result)
    return { ok: true, prUrl: result.prUrl, prNumber: result.prNumber, branchName: result.branchName, mode: result.mode }
  } catch (err) {
    const prInfo = err instanceof PublishStepError ? err.prInfo : undefined
    if (prInfo) {
      // PR 大概率已经在 GitHub 上开出来了——不能把锁还回去，否则用户重试会生成
      // 新分支/新 PR，同一个团挂出多个冲突的 Draft PR。留着 pr_open，尽量把
      // pr_number/pr_url 补写回去，让 syncTourPrOpenPosts 这个 cron 能追上后续状态。
      await supabaseAdmin
        .from('group_tours')
        .update({ pr_url: prInfo.prUrl, pr_number: prInfo.prNumber })
        .eq('id', tourId)
        .eq('status', 'pr_open')
    } else {
      // 还没产生外部副作用（PR 未创建）：把锁还回去，让 FDE 能重试
      await supabaseAdmin.from('group_tours').update({ status: 'ready' }).eq('id', tourId).eq('status', 'pr_open')
    }

    if (err instanceof PublishStepError) return { ok: false, reason: err.message, code: err.code }
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: `发布失败：${msg}`, code: 'GITHUB_WRITE_ERROR' }
  }
}

/** 读团 + 发布前置闸：关键字段必须齐全，且人工必须已确认（板桥意见4 / 魏征 B4、W4 —
 *  这是后端字段校验，不是纯前端约定，绕开 UI 直调 API 也拦得住）。 */
async function loadPublishableTour(
  clientId: string,
  tourId: string,
): Promise<{ ok: true; tour: GroupTourRow } | { ok: false; reason: string; code: PublishErrorCode }> {
  const { data: tourData, error: tourErr } = await supabaseAdmin
    .from('group_tours')
    .select('id,client_id,status,title,slug,payload,confidence_notes,client_claims_to_verify,required_fields_confirmed')
    .eq('id', tourId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (tourErr || !tourData) return { ok: false, reason: '找不到这个团。', code: 'NOT_FOUND' }
  const tour = tourData as GroupTourRow

  const missing = requiredFieldGaps(tour.payload)
  if (missing.length > 0) {
    return { ok: false, reason: `还有必填信息没确认：${missing.join('、')}。请先补全再发布。`, code: 'MISSING_REQUIRED_FIELDS' }
  }
  if (!tour.slug) return { ok: false, reason: '团缺少 slug，不能发布。', code: 'MISSING_REQUIRED_FIELDS' }
  if (!tour.required_fields_confirmed) {
    return { ok: false, reason: '还没人工确认关键字段无误，不能发布——请在编辑页勾选确认。', code: 'NOT_CONFIRMED' }
  }

  // 图片链接可达性检查（魏征 W3）——避免团页上线后挂一张 404 图。
  const badImage = await findUnreachableImage(tour.payload)
  if (badImage) {
    return { ok: false, reason: `图片链接打不开：${badImage}，请检查链接或重新上传。`, code: 'MISSING_REQUIRED_FIELDS' }
  }

  return { ok: true, tour }
}

/** 原子状态锁：只有严格从 draft/review/ready 迁到 pr_open 才算拿到锁，防止同一个团
 *  被连点两次发布各自开出一个 PR（子牙问题4 / 魏征 B3）。不单独要求先手动把状态改成
 *  'ready' 再发布——是否可发布由 loadPublishableTour 的两道闸决定（更精确），'ready'
 *  不再是用户要单独操作的一步，减少 FDE 要走的步骤（板桥意见5）。 */
async function acquirePublishLease(tourId: string): Promise<{ ok: true } | { ok: false; reason: string; code: PublishErrorCode }> {
  const { data: leaseRows, error: leaseErr } = await supabaseAdmin
    .from('group_tours')
    .update({ status: 'pr_open' })
    .eq('id', tourId)
    .in('status', ['draft', 'review', 'ready'])
    .select('id')
  if (leaseErr) return { ok: false, reason: `发布锁获取失败：${leaseErr.message}`, code: 'ALREADY_PUBLISHING' }
  if (!leaseRows || leaseRows.length === 0) {
    return { ok: false, reason: '这个团已经在发布中，或者还没到"可以发布"的状态，请刷新页面查看当前状态。', code: 'ALREADY_PUBLISHING' }
  }
  return { ok: true }
}

async function recordPublishSuccess(tourId: string, clientId: string, result: DoPublishResult): Promise<void> {
  const { error: recordErr } = await supabaseAdmin
    .from('group_tours')
    .update({ pr_url: result.prUrl, pr_number: result.prNumber })
    .eq('id', tourId)
  if (recordErr) {
    // PR 已经在 GitHub 上真实存在，但记录没写进去——绝不能当成功报给用户，
    // 否则数据库停在 pr_open 却没有 pr_number/pr_url，pr-sync cron 永远跳过它，
    // 今日待办也因为缺 URL 不展示，链路直接烂尾（魏征 finding 4）。
    throw new PublishStepError(
      `PR 已成功创建（${result.prUrl}），但保存记录失败：${recordErr.message}。请勿重新点发布，先联系工程核对该团状态。`,
      'GITHUB_PR_ERROR',
      { prNumber: result.prNumber, prUrl: result.prUrl },
    )
  }

  const { error } = await supabaseAdmin.from('flywheel_actions').insert({
    client_id: clientId,
    flywheel: 'seo',
    action_type: CMS_ACTION_TYPE.CONTENT_INSERT,
    execution_mode: 'in_house',
    payload: { tourId, filePath: result.filePath, prUrl: result.prUrl, prNumber: result.prNumber, mode: result.mode },
  })
  if (error) console.warn('[group-tours/publisher] flywheel_actions 写入失败（不影响发布结果）:', error.message)
}

// ─── 必填字段校验 ────────────────────────────────────────────────────────────

function requiredFieldGaps(payload: GroupTourPayload): string[] {
  const gaps: string[] = []
  if (!payload.title) gaps.push('标题')
  if (!payload.destination) gaps.push('目的地')
  if (!payload.duration) gaps.push('天数')
  if (!payload.price) gaps.push('价格')
  if (!payload.departures || payload.departures.length === 0) gaps.push('团期')
  if (!payload.itinerary || payload.itinerary.length === 0) gaps.push('逐日行程')
  return gaps
}

// ─── 图片链接可达性检查 ───────────────────────────────────────────────────────

// 图片探测走 safeFetchText（DNS 校验 + 逐跳重定向校验，见 src/lib/net/safe-fetch.ts）——
// 直接对客户填的任意 URL 发 HEAD/GET 原生 fetch 会跟随重定向，等于给了一个盲 SSRF
// 入口（有工作台权限的用户可以让服务器去探内网/云元数据地址）。v1 只支持 GET，
// 所以这里限制响应体大小而不是用 HEAD；超限说明连接本身是通的，仍算可达。
const IMAGE_PROBE_MAX_BYTES = 20 * 1024 * 1024

async function urlReachable(url: string): Promise<boolean> {
  try {
    const res = await safeFetchText(url, { timeoutMs: 5000, maxResponseBytes: IMAGE_PROBE_MAX_BYTES })
    return res.ok
  } catch (err) {
    if (err instanceof ResponseTooLargeError) return true
    return false
  }
}

/** 只查 v1 允许手填的 heroImage/gallery 链接；空值不算错误，跳过。 */
async function findUnreachableImage(payload: GroupTourPayload): Promise<string | null> {
  const urls = [payload.heroImage, ...payload.gallery].filter((u): u is string => Boolean(u?.trim()))
  for (const url of urls) {
    if (!/^https?:\/\//i.test(url)) return url // 明显不是合法 URL，不用发请求也能判
    if (!(await urlReachable(url))) return url
  }
  return null
}

// ─── 跨客户串台同步检查 ───────────────────────────────────────────────────────

/**
 * Reuse Statement 新增的防御：`assertClientOwnsTarget()` 只接在 WordPress 通道，
 * GitHub 通道从未受它保护（子牙核实的结论）。库里已有 `cross-client-audit.ts`
 * 的 `findSharedIdentifiers()` 专门检测"同一个 repo_owner/repo_name 挂在两个
 * 客户名下"，但那是每日审计、事后发现。这里在真正调用 GitHub API 之前同步
 * 调用一次同一个纯函数，把检查提前到风险最高的时刻，不新增检测逻辑。
 */
async function checkCrossClientRepoConflict(clientId: string, repoOwner: string, repoName: string): Promise<string | null> {
  const [{ data: connRows, error: connErr }, { data: clientRows }] = await Promise.all([
    supabaseAdmin.from('cms_connections').select('client_id, repo_owner, repo_name'),
    supabaseAdmin.from('clients').select('id, name'),
  ])
  if (connErr) throw new PublishStepError(`跨客户配置核对失败：${connErr.message}`, 'CROSS_CLIENT_CONFLICT')

  const clients = (clientRows ?? []) as Array<{ id: string; name: string }>
  const nameOf = (id: string) => clients.find((c) => c.id === id)?.name ?? id

  const rows = ((connRows ?? []) as Array<{ client_id: string; repo_owner: string | null; repo_name: string | null }>)
    .filter((r) => r.repo_owner && r.repo_name)
    .map((r) => ({ client_id: r.client_id, value: `${r.repo_owner}/${r.repo_name}` }))

  const findings = findSharedIdentifiers('代码仓通道（发布前同步检查）', rows, nameOf, {
    what: (v, names) => `${names.join(' 和 ')} 的代码仓通道都指向同一个仓库 ${v}`,
  })

  const myName = nameOf(clientId)
  const hit = findings.find((f) => f.clients.includes(myName))
  return hit
    ? `发布前检查发现风险：${hit.what}。为避免把内容发进别的客户的仓库，已阻止本次发布 —— 请先在后台核对这个客户的 GitHub 连接配置（repo_owner/repo_name）。`
    : null
}

// ─── GitHub 编排 ─────────────────────────────────────────────────────────────

interface DoPublishResult {
  prUrl: string
  prNumber: number
  branchName: string
  filePath: string
  mode: 'inserted' | 'replaced'
}

interface GithubTarget {
  github: GithubClient
  repoOwner: string
  repoName: string
  defaultBranch: string
  filePath: string
}

/** 拿连接 + 跨客户串台检查 + 目标文件路径，三件事都可能挡住发布，集中在一处。 */
async function resolveGithubTarget(clientId: string): Promise<GithubTarget> {
  const conn = await getConnection(clientId).catch(() => null)
  if (!conn) {
    throw new PublishStepError('客户没有配置 GitHub 发布通道，请去 Settings → 🔗 网站连接 配置。', 'NO_CONNECTION')
  }
  const { repoOwner, repoName, branch: defaultBranch, plainToken, contentPaths } = conn

  const conflict = await checkCrossClientRepoConflict(clientId, repoOwner, repoName)
  if (conflict) throw new PublishStepError(conflict, 'CROSS_CLIENT_CONFLICT')

  const filePath = (contentPaths ?? []).find((p) => /tours?\.ts$/i.test(p))
  if (!filePath) {
    throw new PublishStepError(
      '没有配置团数据文件路径 —— 请去 Settings → 🔗 网站连接，把目标文件（如 src/lib/data/tours.ts）加进"可安全改写的文件"列表。',
      'NO_CONTENT_PATH',
    )
  }

  return { github: new GithubClient(plainToken), repoOwner, repoName, defaultBranch, filePath }
}

interface WriteContentResult {
  content: string
  blobSha: string
  mode: 'inserted' | 'replaced'
}

/** 读目标文件 → 映射字段 → 安全插入/替换 → 语法校验（后两步在 insertOrReplaceTourObject 内部）。 */
async function prepareTourFileContent(target: GithubTarget, tour: GroupTourRow): Promise<WriteContentResult> {
  let fileContent: string
  let blobSha: string
  try {
    const file = await target.github.getFileContent(target.repoOwner, target.repoName, target.filePath, target.defaultBranch)
    fileContent = file.decodedContent
    blobSha = file.sha
  } catch (e) {
    throw new PublishStepError(`读取目标文件失败：${buildGithubErr(e)}`, 'GITHUB_READ_ERROR')
  }

  const ctsFields = mapPayloadToCtsTourFields(tour.payload, tour.slug)

  try {
    const writeResult = insertOrReplaceTourObject({
      fileContent,
      filePath: target.filePath,
      arrayName: TOURS_ARRAY_NAME,
      slug: tour.slug,
      newObjectFields: ctsFields,
    })
    return { content: writeResult.content, blobSha, mode: writeResult.mode }
  } catch (e) {
    if (e instanceof NonLiteralTourObjectError) throw new PublishStepError(e.message, 'NON_LITERAL_OBJECT')
    if (e instanceof TourArrayNotFoundError) throw new PublishStepError(e.message, 'ARRAY_NOT_FOUND')
    if (e instanceof TourSlugConflictError) throw new PublishStepError(e.message, 'SLUG_CONFLICT')
    const msg = e instanceof Error ? e.message : String(e)
    throw new PublishStepError(`生成发布内容失败：${msg}`, 'SYNTAX_INVALID')
  }
}

/** createBranchWithMarker：分支创建与身份标记 commit 原子绑定，422（分支已存在）时靠
 *  tip commit message 是否含本次 run 的 marker 判断"是不是我开的"，不是靠"tip == baseSha"
 *  这种可能被第三方巧合命中的弱判据（同 page-apply-optimization）。 */
async function createOwnedBranch(target: GithubTarget, branchName: string, marker: string): Promise<void> {
  const { github, repoOwner, repoName, defaultBranch } = target

  let baseSha: string
  try {
    baseSha = await github.getBranchSha(repoOwner, repoName, defaultBranch)
  } catch (e) {
    throw new PublishStepError(`读取分支失败：${buildGithubErr(e)}`, 'GITHUB_WRITE_ERROR')
  }

  try {
    await github.createBranchWithMarker(repoOwner, repoName, branchName, baseSha, `chore(tour): identity marker ${marker}`)
    return
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!/422|already exists|Reference already exists/i.test(msg)) {
      throw new PublishStepError(`创建分支失败：${buildGithubErr(e)}`, 'GITHUB_WRITE_ERROR')
    }
  }

  let tipSha: string
  try {
    tipSha = await github.getBranchSha(repoOwner, repoName, branchName)
  } catch (e) {
    throw new PublishStepError(`分支已存在但读不到状态：${buildGithubErr(e)}`, 'GITHUB_WRITE_ERROR')
  }
  let tipMessage: string
  try {
    tipMessage = (await github.getCommit(repoOwner, repoName, tipSha)).message
  } catch (e) {
    throw new PublishStepError(`分支已存在但读不到 commit：${buildGithubErr(e)}`, 'GITHUB_WRITE_ERROR')
  }
  if (!tipMessage.includes(marker)) {
    throw new PublishStepError('分支名冲突且不属于本次发布，请重试一次。', 'GITHUB_WRITE_ERROR')
  }
}

/** 开 PR，422（"已存在"）时靠 listPullRequestsByHead + getPullRequestDetail receipt 核对
 *  所有权；happy path 也要回读一次自检，挡"网络抖动导致响应丢失，但 GitHub 那边其实开了
 *  别的 PR"这类情况（同 page-apply-optimization）。 */
async function openOwnedPullRequest(
  target: GithubTarget,
  params: { branchName: string; title: string; body: string; marker: string },
): Promise<{ prNumber: number; prUrl: string }> {
  const { github, repoOwner, repoName, defaultBranch } = target
  const { branchName, title, body, marker } = params

  let prNumber: number
  let prUrl: string
  try {
    const pr = await github.createPullRequest(repoOwner, repoName, { title, body, head: branchName, base: defaultBranch, draft: true })
    prNumber = pr.number
    prUrl = pr.html_url
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!/422|already/i.test(msg)) throw new PublishStepError(`开 PR 失败：${buildGithubErr(e)}`, 'GITHUB_PR_ERROR')

    const candidates = await github.listPullRequestsByHead(repoOwner, repoName, branchName).catch(() => [])
    let adopted: { number: number; html_url: string } | null = null
    for (const cand of candidates) {
      const d = await github.getPullRequestDetail(repoOwner, repoName, cand.number).catch(() => null)
      if (
        d && d.draft === true && d.state === 'open' && d.merged === false &&
        d.headRef === branchName && d.baseRef === defaultBranch && d.body.includes(marker)
      ) {
        adopted = { number: d.number, html_url: d.htmlUrl }
        break
      }
    }
    if (!adopted) throw new PublishStepError('开 PR 失败：GitHub 报"已存在"，但找不到属于本次发布的 PR。', 'GITHUB_PR_ERROR')
    prNumber = adopted.number
    prUrl = adopted.html_url
  }

  let detail
  try {
    detail = await github.getPullRequestDetail(repoOwner, repoName, prNumber)
  } catch (e) {
    // PR 已经确定开出来了（有 prNumber/prUrl），只是回读这一步失败——带上 prInfo，
    // 让调用方不要把发布锁还回去，否则重试会对同一个团再开一个 PR。
    throw new PublishStepError(
      `PR 已开出（${prUrl}）但回读校验失败：${buildGithubErr(e)}`,
      'GITHUB_PR_ERROR',
      { prNumber, prUrl },
    )
  }
  const receiptOk =
    detail.draft === true && detail.state === 'open' && detail.merged === false &&
    detail.headRef === branchName && detail.baseRef === defaultBranch && detail.body.includes(marker)
  if (!receiptOk) {
    throw new PublishStepError(`PR #${prNumber} 校验不通过，可能开错了 PR，已阻止继续。`, 'GITHUB_PR_ERROR')
  }

  return { prNumber, prUrl }
}

async function doPublish(clientId: string, tour: GroupTourRow): Promise<DoPublishResult> {
  const target = await resolveGithubTarget(clientId)
  const written = await prepareTourFileContent(target, tour)

  const runId = randomBytes(8).toString('hex')
  const marker = `[me-tour-run ${runId}]`
  const safeSlug = tour.slug.replace(/[^a-z0-9-]/g, '-')
  const branchName = `${BRANCH_PREFIX}${safeSlug}-${randomBytes(4).toString('hex')}`

  await createOwnedBranch(target, branchName, marker)

  try {
    await target.github.commitFile(
      target.repoOwner,
      target.repoName,
      target.filePath,
      branchName,
      written.content,
      `feat(tour): ${written.mode === 'inserted' ? 'add' : 'update'} "${tour.title}" ${marker}`,
      written.blobSha,
    )
  } catch (e) {
    throw new PublishStepError(`提交内容失败：${buildGithubErr(e)}`, 'GITHUB_WRITE_ERROR')
  }

  const { prNumber, prUrl } = await openOwnedPullRequest(target, {
    branchName,
    title: `[Magic Engine] Tour: ${tour.title}`,
    body: buildPrBody(tour, written.mode, marker),
    marker,
  })

  return { prUrl, prNumber, branchName, filePath: target.filePath, mode: written.mode }
}

// ─── payload → CTS Tour 字段映射（客户专属，只在这一层做）────────────────────

export function mapPayloadToCtsTourFields(payload: GroupTourPayload, slug: string): Record<string, unknown> {
  const nowIso = new Date().toISOString()
  const destination = payload.destination ?? 'china'
  const tier = payload.suggestedTier ?? 'discovery'

  const fields: Record<string, unknown> = {
    id: slug,
    slug,
    destination,
    tier,
    name: payload.name,
    title: payload.title,
    shortDescription: payload.shortDescription,
    duration: payload.duration,
    price: payload.price ?? '',
    heroImage: payload.heroImage ?? '',
    gallery: payload.gallery,
    highlights: payload.highlights,
    itinerary: payload.itinerary.map((d) => ({
      day: d.day,
      title: d.title,
      description: d.description,
      meals: d.meals,
      ...(d.accommodation ? { accommodation: d.accommodation } : {}),
    })),
    inclusions: payload.inclusions,
    exclusions: payload.exclusions,
    metaTitle: payload.metaTitle,
    metaDescription: payload.metaDescription,
    isActive: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  }

  if (payload.tourCities.length > 0) fields.tourCities = payload.tourCities
  if (payload.singleSupplement) fields.singleSupplement = payload.singleSupplement

  if (payload.departures.length > 0) {
    fields.departureDates = payload.departures.map((d) => d.date)
    const pricing: Record<string, string> = {}
    for (const d of payload.departures) {
      if (d.price) pricing[d.date] = d.price
    }
    // 从同一份 departures[] 派生 departureDates 和 departurePricing 两个字段，
    // key 100% 保证一致——不是靠事后测试兜底，是生成方式上不给它出现分歧的机会
    // （魏征 B1.2：AI 分两次生成同一份日期列表时，哪怕差一个空格，build 照样绿，
    // CTS 网站那个价格直接静默不渲染）
    if (Object.keys(pricing).length > 0) fields.departurePricing = pricing
  }

  return fields
}

// ─── PR body / 错误格式化 ────────────────────────────────────────────────────

function buildPrBody(tour: GroupTourRow, mode: 'inserted' | 'replaced', marker: string): string {
  const lines = [
    `## Magic Engine — 团${mode === 'inserted' ? '新增' : '更新'}`,
    '',
    `**团名：** ${tour.title}`,
    `**Slug：** \`${tour.slug}\``,
    '',
  ]

  if (tour.confidence_notes?.length) {
    lines.push('### AI 解析时不确定的地方（请重点核对）', ...tour.confidence_notes.map((n) => `- ${n}`), '')
  }
  if (tour.client_claims_to_verify?.length) {
    lines.push(
      '### 营销材料与行程文档冲突处（请确认哪个对）',
      ...tour.client_claims_to_verify.map((c) => `- **${c.claim}**：${c.issue}`),
      '',
    )
  }

  lines.push('---', `_${marker}_`, '_Auto-generated by [Magic Engine](https://magic-engine.app) — Draft PR, review then merge to publish._')
  return lines.join('\n')
}

function buildGithubErr(e: unknown): string {
  if (e instanceof GitHubApiError) return `GitHub 错误 ${e.status}：${e.message}`
  if (e instanceof Error) return e.message
  return '未知错误'
}
