/**
 * Magic Engine 2.0 · 台账激活闸（Issue #930 · #960 冻结版）
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 顺序是这道闸的全部意义
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   1  结构闸（任何解引用之前，含 mode fail-closed）
 *   2  L1 生成签名
 *   3  issuedAt 七天有效期
 *   4  L2 复核凭证
 *   5  L1/L2 的 planId 与 generationDigest 绑定
 *   6  契约版本 / 归一规则版本
 *   7  租户 / 域名 / 批准主机（与当前生产上下文比对）
 *   8  发现覆盖 + 不完整发现的认账
 *   9  被接受集合与逐条重新推导 → core 机器一致性兜底（放在 9 之后，免得遮住更具体的闸）
 *   10 空库闸（首次激活）
 *   ——— 以上全过，才开始抓 ———
 *   11 抓取 + 富集（全成才继续）→ 一次性写入 → 精确集合对账
 *
 * 🔴 第 1–10 步任一失败 ⇒ `status: 'rejected'`，且**一次抓取都没有发生**。
 *    这是承诺不是描述：读审计的人（以及重试 / 成本判断）靠它认定这次没花过网络成本。
 *    抓取之后才出的问题一律 `failed`，哪怕一行都没写。
 *
 * 🔴 闸门不过一律**返回**审计对象而不是抛错 —— 审计本身就是交付物；
 *    抛错会把「为什么没跑」这件事丢掉。调用方必须看 `status`。
 *
 * 🔴 这一层不 import supabase：写入口子从外面注入。
 */

import type {
  ActivationAudit,
  ActivationBlocker,
  ActivationDeps,
  ActivationExpectation,
  AcceptedPageRecord,
  GeneratedPlanCore,
  InventoryPlanEnvelope,
  MachineCandidate,
  RejectionReasonCode,
  ReviewSubmission,
  SignedReview,
} from './types'
import {
  ALLOWED_REVIEWER_IDENTITY_SOURCE,
  INVENTORY_PLAN_CONTRACT_VERSION,
  NORMALIZATION_RULE_VERSION,
} from './types'
import { checkEnvelopeFreshness, PLAN_MAX_AGE_DAYS, verifyEnvelope } from './envelope'
import { verifyReviewAttestation } from './attestation'
import { resolveAcknowledgements, resolveDecisions, type ResolvedCandidate } from './decisions'
import { assertCoreIntact } from './plan'
import { checkActivationShape, isMachineCandidateShape } from './shapes'
import { crawlAndEnrich } from './crawl-stage'
import { deriveCanonicalUrl, normaliseApprovedHosts } from './url-rules'

export interface ActivateInput {
  readonly envelope: InventoryPlanEnvelope
  readonly review: SignedReview
  /** 从当前生产上下文读出来的租户 / 域名 / 批准主机。 */
  readonly expected: ActivationExpectation
  /**
   * 激活模式。**只有首次激活一种**，且要求台账为空。
   * 增量模式涉及「旧行怎么处置」与重放防护，那是另一份设计，不在这里默认成立。
   */
  readonly mode: 'first_activation'
  readonly deps: ActivationDeps
}

interface GateOutcome {
  readonly blockers: readonly ActivationBlocker[]
  readonly resolved: readonly ResolvedCandidate[]
}

/**
 * 执行一次台账激活。
 *
 * 返回的审计对象逐条列出被接受 / 被拒 / 暂缓 / 失败 / 实际写入的 URL —— 不做汇总即真相，
 * 也不许把部分成功报成完成。
 */
export async function activateReviewedPlan(input: ActivateInput): Promise<ActivationAudit> {
  const shape = checkActivationShape(input)
  if (shape.length > 0) return rejected(input, shape, [])

  let gate: GateOutcome
  try {
    gate = await runPreCrawlGates(input)
  } catch (err) {
    // 🔴 code 跟 `plan_shape_invalid` **故意不同**：那个是结构闸认出来的已知形状，
    //    这个是「闸没覆盖到、靠兜底才没炸出去」—— 出现它就说明 checkActivationShape 有洞。
    //    这里还没抓过任何页面、也没写过任何东西，所以是干净的 rejected。
    return rejected(input, [{ code: 'plan_shape_unexpected', message: unexpectedText(err) }], [])
  }
  if (gate.blockers.length > 0) return rejected(input, gate.blockers, gate.resolved)

  const accepted = gate.resolved.filter((r) => r.decision === 'accepted')
  const acceptedUrls = accepted.map((r) => r.candidate.canonicalUrl as string)
  const { records, failures } = await crawlAndEnrich(acceptedUrls, input.deps)
  if (failures.length > 0) {
    return buildAudit({
      input,
      resolved: gate.resolved,
      status: 'failed',
      blockers: [
        {
          code: 'accepted_page_failed',
          message:
            `${failures.length} 个被接受的页面抓取或分类失败，本次不写入任何一行 —— ` +
            '被批准的是「这一整份清单」，写一半就不是那份清单了。修好之后重跑。',
        },
      ],
      failures,
      written: [],
      touched: false,
    })
  }
  return persistAndReconcile(input, gate.resolved, records)
}

// ---------------------------------------------------------------------------
// 闸门（顺序即语义）
// ---------------------------------------------------------------------------

type GateStep = () => readonly ActivationBlocker[]

/** 第一个说不通的闸就地返回 —— 后面的闸不该在已经证明不可信的输入上跑。 */
function firstFailure(steps: readonly GateStep[]): readonly ActivationBlocker[] {
  for (const step of steps) {
    const blockers = step()
    if (blockers.length > 0) return blockers
  }
  return []
}

async function runPreCrawlGates(input: ActivateInput): Promise<GateOutcome> {
  const { envelope, review, expected, deps } = input
  const core = envelope.core
  const submission = review.submission

  const early = firstFailure([
    () => checkGenerationEnvelope(envelope, deps),
    () => checkFreshness(envelope, deps),
    () => checkAttestation(review, deps),
    () => checkBinding(envelope, review, submission),
    () => checkVersions(core),
    () => checkIdentity(core, expected),
    () => checkDiscoveryAndAcknowledgements(core, submission),
  ])
  if (early.length > 0) return { blockers: early, resolved: [] }

  const { resolved, problems } = resolveDecisions(core, submission.decisions)
  const decisionBlockers = firstFailure([
    () => problems.map((p) => ({ code: p.code, message: p.message })),
    () => checkAcceptedSet(resolved, core.boundary.approvedHosts),
    // 🔴 兜底闸**放在最后**：core 被动过手脚时，前面那些更具体的闸（发现覆盖、
    //    被接受集合、逐条重新推导）应该先响 —— 它们说得清「哪一页、错在哪」。
    //    这道只兜「前面每一道都看不见」的形状，比如凭空多一条 rejected 候选 + 改乱计数。
    //    放前面就会把 8、9 两道闸整片遮住，那正是这个仓库反复踩的坑。
    () => checkCoreMachineDerived(core),
  ])
  if (decisionBlockers.length > 0) return { blockers: decisionBlockers, resolved }

  // 空库闸放在最后：它要打数据库，前面的纯校验能拦下的就别浪费这一次查询。
  return { blockers: await checkInventoryEmpty(deps.store, core.clientId), resolved }
}

/**
 * 闸 2 —— L1 生成签名。
 *
 * 🔴 自带的 `generationDigest` 只能证明「内容与同一份文件里的 digest 一致」——
 *    那是公开哈希，谁改了内容都能自己重算。唯一挡得住的是一枚改文件的人算不出来的签名。
 */
function checkGenerationEnvelope(envelope: InventoryPlanEnvelope, deps: ActivationDeps): ActivationBlocker[] {
  let verdict: ReturnType<typeof verifyEnvelope>
  try {
    verdict = verifyEnvelope(envelope, deps.verifyGenerationSignature)
  } catch (err) {
    return [{ code: 'generation_signature_unverifiable', message: `验生成签名时出错，不能当成验过：${unexpectedText(err)}` }]
  }
  if (verdict === 'valid') return []
  const messages: Record<typeof verdict, string> = {
    valid: '',
    digest_mismatch: '信封内容与它自带的 generationDigest 对不上 —— 生成之后被改过',
    signature_invalid: '生成签名对不上 —— 内容与 digest 一起被重算过，而重算签名需要 K_gen',
    unknown_key: '信封声称的签名密钥 id 不在密钥环里 —— 该密钥已作废，必须重新生成计划并重新复核',
    key_unavailable: '一把生成签名密钥都没配，验不了 —— 验不了 ≠ 验过了',
    malformed: '信封缺 keyId / generationDigest / generationSignature',
    version_mismatch: '信封的结构版本不是当前代码这一版 —— 重新生成，别拿旧信封套新语义',
  }
  return [{ code: `generation_${verdict}`, message: messages[verdict] }]
}

/** 闸 3 —— 有效期固定 {@link PLAN_MAX_AGE_DAYS} 天，没有任何入参能调大或关掉它。 */
function checkFreshness(envelope: InventoryPlanEnvelope, deps: ActivationDeps): ActivationBlocker[] {
  let nowIso: string
  try {
    nowIso = deps.now()
  } catch (err) {
    return [{ code: 'clock_unavailable', message: `取不到当前时间，判不了有效期：${unexpectedText(err)}` }]
  }
  const verdict = checkEnvelopeFreshness(envelope.issuedAt, nowIso)
  if (verdict === 'fresh') return []
  if (verdict === 'invalid_timestamp') {
    return [
      {
        code: 'generation_envelope_invalid_timestamp',
        message: `签发时间「${String(envelope.issuedAt)}」解析不了或晚于当前时间（${nowIso}）—— 判不了有效期就不许激活`,
      },
    ]
  }
  return [
    {
      code: 'generation_envelope_expired',
      message:
        `这份计划签发于 ${envelope.issuedAt}，已经超过 ${PLAN_MAX_AGE_DAYS} 天。` +
        '站点在这段时间里可能已经变了 —— 重新生成并重新复核，不要拿旧清单去抓。',
    },
  ]
}

/** 闸 4 —— L2 复核完整性凭证。 */
function checkAttestation(review: SignedReview, deps: ActivationDeps): ActivationBlocker[] {
  let verdict: ReturnType<typeof verifyReviewAttestation>
  try {
    verdict = verifyReviewAttestation(review, deps.verifyReviewAttestation)
  } catch (err) {
    return [{ code: 'review_attestation_unverifiable', message: `验复核凭证时出错，不能当成验过：${unexpectedText(err)}` }]
  }
  if (verdict === 'valid') return []
  const messages: Record<typeof verdict, string> = {
    valid: '',
    digest_mismatch: '复核提交与它自带的 reviewDigest 对不上 —— 盖章之后被改过',
    attestation_invalid: '复核凭证对不上 —— 内容与 digest 一起被重算过',
    unknown_key: '复核凭证声称的密钥 id 不在密钥环里 —— 该密钥已作废',
    key_unavailable: '一把复核密钥都没配，验不了 —— 验不了 ≠ 验过了',
    malformed: '复核凭证缺 keyId / reviewDigest / reviewAttestation',
    version_mismatch: '复核凭证的结构版本不是当前代码这一版 —— 重新复核',
  }
  return [{ code: `review_attestation_${verdict}`, message: messages[verdict] }]
}

/** 闸 5 —— 一份合法 L2 不许配另一份合法 L1。两项都比。 */
function checkBinding(
  envelope: InventoryPlanEnvelope,
  review: SignedReview,
  submission: ReviewSubmission,
): ActivationBlocker[] {
  const blockers: ActivationBlocker[] = []
  if (submission.planId !== envelope.planId) {
    blockers.push({
      code: 'review_plan_binding_mismatch',
      message: `复核凭证指向计划 ${submission.planId}，信封是 ${envelope.planId}`,
    })
  }
  if (submission.generationDigest !== envelope.generationDigest) {
    blockers.push({
      code: 'review_digest_binding_mismatch',
      message: '复核凭证里记的 generationDigest 跟信封的对不上 —— 这两份不是配对的',
    })
  }
  if (review.keyId === envelope.keyId) {
    blockers.push({
      code: 'shared_signing_key',
      message:
        `复核凭证用的密钥 id「${review.keyId}」跟生成信封的是同一个 —— ` +
        'L1 与 L2 必须是两把不同的密钥，共用一把等于两层签名塌成一个信任根',
    })
  }
  if (submission.reviewerIdentitySource !== ALLOWED_REVIEWER_IDENTITY_SOURCE) {
    blockers.push({
      code: 'invalid_reviewer_identity_source',
      message:
        `reviewerIdentitySource 只接受逐字的「${ALLOWED_REVIEWER_IDENTITY_SOURCE}」，` +
        `收到的是「${String(submission.reviewerIdentitySource)}」`,
    })
  }
  return blockers
}

/** 闸 6 —— 版本不对就不能拿旧批准套新语义。 */
function checkVersions(core: GeneratedPlanCore): ActivationBlocker[] {
  const blockers: ActivationBlocker[] = []
  if (core.contractVersion !== INVENTORY_PLAN_CONTRACT_VERSION) {
    blockers.push({
      code: 'contract_version_mismatch',
      message: `计划契约版本是 ${core.contractVersion}，当前代码是 ${INVENTORY_PLAN_CONTRACT_VERSION}`,
    })
  }
  if (core.normalizationRuleVersion !== NORMALIZATION_RULE_VERSION) {
    blockers.push({
      code: 'rule_version_mismatch',
      message:
        `计划按 ${core.normalizationRuleVersion} 归一，当前代码是 ${NORMALIZATION_RULE_VERSION} —— ` +
        '规则变了就必须重新生成并重新复核，旧批准不能套新语义',
    })
  }
  return blockers
}

/**
 * 闸 9.5 —— core 的机器一致性纵深兜底。
 *
 * 🔴 `assertCoreIntact()` 原来**只在盖 L2 时跑**，激活侧一次都不跑。于是一份手工拼的、
 *    计数对不上、凭空多一条从没被发现过的候选的 core，只要用真密钥 seal + sealReview，
 *    就能一路 `activated`。编辑者走不到这条路（L1 挡死），但**绕过 `review.ts` 的内部
 *    调用方**走得到 —— 而 `review.ts` 之所以跑它，理由恰恰是「没有任何东西能证明
 *    一份手写的 core 来自 buildInventoryPlan」。这个理由在激活侧一字不差地成立。
 */
function checkCoreMachineDerived(core: GeneratedPlanCore): ActivationBlocker[] {
  try {
    assertCoreIntact(core)
    return []
  } catch (err) {
    const code = err instanceof Error && 'code' in err ? String((err as { code: unknown }).code) : 'core_not_intact'
    return [{ code: `core_${code}`, message: unexpectedText(err) }]
  }
}

/** 闸 7 —— 一份给 A 客户批的计划不能拿去激活 B 客户。 */
function checkIdentity(core: GeneratedPlanCore, expected: ActivationExpectation): ActivationBlocker[] {
  const blockers: ActivationBlocker[] = []
  if (core.clientId !== expected.clientId) {
    blockers.push({
      code: 'client_mismatch',
      message: `计划属于租户 ${core.clientId}，本次激活的是 ${expected.clientId}`,
    })
  }
  if (core.boundary.requestedDomain.trim().toLowerCase() !== expected.requestedDomain.trim().toLowerCase()) {
    blockers.push({
      code: 'domain_mismatch',
      message: `计划针对域名 ${core.boundary.requestedDomain}，本次上下文是 ${expected.requestedDomain}`,
    })
  }
  if (!sameHostSet(core.boundary.approvedHosts, expected.approvedHosts)) {
    blockers.push({
      code: 'approved_hosts_mismatch',
      message:
        `计划批准的主机是 [${[...core.boundary.approvedHosts].join(', ')}]，` +
        `本次上下文批准的是 [${[...expected.approvedHosts].join(', ')}]`,
    })
  }
  return blockers
}

/**
 * 闸 8 —— 发现覆盖 + 认账。
 *
 * 🔴 挡的是**缺整个站**：批准了两个主机、只找了一个，合并后的 URL 清单看不出任何异常，
 *    复核与激活会一路顺畅地产出一份缺页台账 —— 而缺页没人会发现。
 */
function checkDiscoveryAndAcknowledgements(
  core: GeneratedPlanCore,
  submission: ReviewSubmission,
): ActivationBlocker[] {
  const blockers: ActivationBlocker[] = []
  const covered = new Set(core.discovery.map((d) => d.host.trim().toLowerCase()))
  const missing = core.boundary.approvedHosts.filter((h) => !covered.has(h.trim().toLowerCase()))
  if (missing.length > 0) {
    blockers.push({
      code: 'discovery_host_missing',
      message: `批准了主机 [${missing.join(', ')}] 但计划里没有它们的发现记录 —— 那些站根本没被找过`,
    })
  }
  const approved = new Set(core.boundary.approvedHosts.map((h) => h.trim().toLowerCase()))
  const extra = core.discovery.filter((d) => !approved.has(d.host.trim().toLowerCase()))
  if (extra.length > 0) {
    blockers.push({
      code: 'discovery_host_unapproved',
      message: `发现记录里有未批准的主机 [${extra.map((d) => d.host).join(', ')}]`,
    })
  }
  for (const problem of resolveAcknowledgements(core, submission.acknowledgements)) {
    blockers.push({ code: problem.code, message: problem.message })
  }
  return blockers
}

/** 闸 9 —— 被接受集合。 */
function checkAcceptedSet(
  resolved: readonly ResolvedCandidate[],
  approvedHostsRaw: readonly string[],
): ActivationBlocker[] {
  const accepted = resolved.filter((r) => r.decision === 'accepted')
  if (accepted.length === 0) {
    return [{ code: 'empty_accepted_set', message: '被接受的页面是 0 条，没有可激活的台账' }]
  }
  let approvedHosts: readonly string[]
  try {
    approvedHosts = normaliseApprovedHosts(approvedHostsRaw)
  } catch (err) {
    return [{ code: 'invalid_host_allowlist', message: unexpectedText(err) }]
  }
  const blockers: ActivationBlocker[] = []
  const seen = new Set<string>()
  for (const row of accepted) {
    const blocker = checkAcceptedCandidate(row.candidate, approvedHosts, seen)
    if (blocker !== null) blockers.push(blocker)
  }
  return blockers
}

/**
 * 逐条验一个被接受的候选。
 *
 * 🔴 推导校验拿**原始 URL 重新推导**，而不是只验「这个串本身规不规范」。
 *    差别在于：把 canonical 从 /a 改成同一主机下的 /hacked，那个串自己完全规范，
 *    但它不是这条候选推导出来的东西。L1 已经把这条路堵死了；这里是纵深防御。
 */
function checkAcceptedCandidate(
  candidate: MachineCandidate,
  approvedHosts: readonly string[],
  seen: Set<string>,
): ActivationBlocker | null {
  const url = candidate.canonicalUrl
  if (url === null) {
    return {
      code: 'accepted_without_canonical',
      message: `被接受的候选 ${candidate.originalUrl} 没有 canonical URL`,
    }
  }
  const derived = deriveCanonicalUrl(candidate.originalUrl, { approvedHosts })
  if (derived === null || derived !== url) {
    return {
      code: 'accepted_url_not_derived',
      message:
        `被接受的 ${candidate.originalUrl} 记着的 canonical 是 ${url}，` +
        `按当前规则重新推导得到 ${derived ?? 'null'}（主机未批准或该串被改过）`,
    }
  }
  if (seen.has(url)) {
    return { code: 'duplicate_accepted_target', message: `被接受集合里出现重复的 canonical URL：${url}` }
  }
  seen.add(url)
  return null
}

/** 闸 10 —— 首次激活要求台账为空。读不到行数**绝不当成 0**。 */
async function checkInventoryEmpty(
  store: ActivationDeps['store'],
  clientId: string,
): Promise<ActivationBlocker[]> {
  let existing: number
  try {
    existing = await store.countExistingPages(clientId)
  } catch (err) {
    return [
      {
        code: 'inventory_count_unavailable',
        message: `读不到该租户当前台账行数，无法确认是首次激活：${unexpectedText(err)}`,
      },
    ]
  }
  if (existing !== 0) {
    return [
      {
        code: 'inventory_not_empty',
        message:
          `首次激活要求台账为空，实际有 ${existing} 行。这些行的来源与去留需要单独决定，` +
          '不能被这次激活默默覆盖。',
      },
    ]
  }
  return []
}

// ---------------------------------------------------------------------------
// 写入 + 对账
// ---------------------------------------------------------------------------

async function persistAndReconcile(
  input: ActivateInput,
  resolved: readonly ResolvedCandidate[],
  records: readonly AcceptedPageRecord[],
): Promise<ActivationAudit> {
  // 🔴 走到这里页面**已经抓过了**，所以任何收场都是 `failed`，不是 `rejected` ——
  //    `rejected` 的契约是「一次抓取都没发生」。
  const fail = (blocker: ActivationBlocker, touched: boolean, written: readonly string[] = []): ActivationAudit =>
    buildAudit({ input, resolved, status: 'failed', blockers: [blocker], failures: [], written, touched })

  const stillEmpty = await recheckInventoryEmpty(input)
  if (stillEmpty !== null) return fail(stillEmpty, false)

  const write = await writeRecords(input, records)
  if (write.blocker !== null) return fail(write.blocker, true)

  const mismatch = reconcileWriteSet(records, write.written)
  if (mismatch !== null) return fail(mismatch, true, write.written)

  return buildAudit({
    input,
    resolved,
    status: 'activated',
    blockers: [],
    failures: [],
    written: write.written,
    touched: true,
  })
}

/**
 * 写之前再看一眼台账是不是仍然是空的。
 *
 * ⚠️ 这只是把窗口收窄，**不是**原子性：真正的保证必须由 store 在
 * 同一个事务 / 条件写里跟插入一起做（见 `CanonicalInventoryStore` 契约）。
 */
async function recheckInventoryEmpty(input: ActivateInput): Promise<ActivationBlocker | null> {
  let recheck: number
  try {
    recheck = await input.deps.store.countExistingPages(input.envelope.core.clientId)
  } catch (err) {
    return {
      code: 'inventory_count_unavailable',
      message: `写入前复查台账行数失败，不能确认它仍然是空的：${unexpectedText(err)}`,
    }
  }
  if (recheck !== 0) {
    return {
      code: 'inventory_changed_during_crawl',
      message:
        `抓取期间台账从 0 行变成了 ${recheck} 行 —— 有别的东西在往同一个租户写。` +
        '这次不写，先弄清那些行是谁写的。',
    }
  }
  return null
}

/** 唯一一处真正调用落库口的地方。 */
async function writeRecords(
  input: ActivateInput,
  records: readonly AcceptedPageRecord[],
): Promise<{ written: readonly string[]; blocker: ActivationBlocker | null }> {
  try {
    const written = await input.deps.store.writeAcceptedPages({
      clientId: input.envelope.core.clientId,
      pages: records,
      // 🔴 这个标记不是给日志看的：实现方**必须**在同一个事务 / 条件写里
      //    重新确认台账为空，否则两份不同的计划可以各自对账通过、
      //    最后台账是两份的并集 —— 那已经不是任何一份被批准的清单。
      requireEmptyInventory: true,
    })
    return { written, blocker: null }
  } catch (err) {
    return {
      written: [],
      blocker: {
        code: 'write_failed',
        message:
          `写入台账失败：${unexpectedText(err)}。` +
          '⚠️ 失败发生在写入过程中，库里可能已有部分行，先人工核对再重跑。',
      },
    }
  }
}

/** 拿写入方返回的清单跟被接受集合做**精确**比对，不是数个数。 */
function reconcileWriteSet(
  records: readonly AcceptedPageRecord[],
  written: readonly string[],
): ActivationBlocker | null {
  // 🔴 store 是注入的：返回一个非数组会让下一行 `new Set(written)` 抛，
  //    而那时**写入已经发生**，调用方同时丢掉审计和 `inventoryTouched: true`。
  if (!Array.isArray(written)) {
    return {
      code: 'write_result_malformed',
      message: '落库口返回的不是一个数组 —— 无法与被接受集合对账。⚠️ 写入已经发生，必须人工核对。',
    }
  }
  const expectedSet = new Set(records.map((r) => r.canonicalUrl))
  const writtenSet = new Set(written)
  const missing = Array.from(expectedSet).filter((u) => !writtenSet.has(u))
  const unexpected = Array.from(writtenSet).filter((u) => !expectedSet.has(u))
  if (missing.length === 0 && unexpected.length === 0) return null
  return {
    code: 'write_set_mismatch',
    message:
      `写入结果与被接受集合不一致：缺 ${missing.length} 条 [${missing.join(', ')}]，` +
      `多 ${unexpected.length} 条 [${unexpected.join(', ')}]。⚠️ 台账已被改动，必须人工核对。`,
  }
}

// ---------------------------------------------------------------------------
// 审计对象
// ---------------------------------------------------------------------------

function rejected(
  input: ActivateInput,
  blockers: readonly ActivationBlocker[],
  resolved: readonly ResolvedCandidate[],
): ActivationAudit {
  return buildAudit({ input, resolved, status: 'rejected', blockers, failures: [], written: [], touched: false })
}

interface AuditParts {
  readonly input: ActivateInput
  readonly resolved: readonly ResolvedCandidate[]
  readonly status: ActivationAudit['status']
  readonly blockers: readonly ActivationBlocker[]
  readonly failures: readonly { url: string; error: string }[]
  readonly written: readonly string[]
  readonly touched: boolean
}

/**
 * 🔴 审计对象本身**绝不能抛**：它经常是「入参结构不对」时唯一能交出去的东西。
 *    所以每一处取值都当成「可能不是我以为的类型」来写。
 */
function buildAudit(parts: AuditParts): ActivationAudit {
  // 🔴 连 `parts.input` 自己都可能不是对象（调用方把一个 null 请求体直接透传进来）——
  //    结构闸会正确地报 blocker，但随后这里解引用 `null.envelope` 就会抛，
  //    恰好丢掉本模块承诺「一定交得出账」的那份账。
  const input = (typeof parts.input === 'object' && parts.input !== null ? parts.input : {}) as Partial<ActivateInput>
  const envelope = (input.envelope ?? {}) as Partial<InventoryPlanEnvelope>
  const core = (envelope.core ?? {}) as Partial<GeneratedPlanCore>
  const review = (input.review ?? {}) as Partial<SignedReview>
  const submission = (review.submission ?? {}) as Partial<ReviewSubmission>
  const rows = auditRows(parts.resolved, core)

  const accepted = rows.filter((r) => r.decision === 'accepted')
  const rejectedRows = rows.filter((r) => r.decision === 'rejected')
  const deferredRows = rows.filter((r) => r.decision === 'defer')
  return {
    status: parts.status,
    clientId: str(core.clientId),
    planId: str(envelope.planId),
    generationDigest: str(envelope.generationDigest),
    generationKeyId: str(envelope.keyId),
    reviewKeyId: str(review.keyId),
    issuedAt: str(envelope.issuedAt),
    reviewerIdentitySource: str(submission.reviewerIdentitySource),
    attestationModel: 'server-hmac@1',
    normalizationRuleVersion: str(core.normalizationRuleVersion),
    counts: {
      accepted: accepted.length,
      rejected: rejectedRows.length,
      deferred: deferredRows.length,
      crawlFailed: parts.failures.length,
      written: parts.written.length,
    },
    acceptedUrls: accepted.map((r) => r.url),
    rejectedUrls: rejectedRows.map((r) => ({ url: r.url, reasonCodes: r.reasonCodes })),
    deferredUrls: deferredRows.map((r) => ({ url: r.url, reasonCodes: r.reasonCodes })),
    failedUrls: parts.failures,
    writtenUrls: parts.written,
    blockers: parts.blockers,
    inventoryTouched: parts.touched,
    redirectEvidence: 'unavailable',
  }
}

interface AuditRow {
  readonly url: string
  readonly decision: string
  readonly reasonCodes: readonly RejectionReasonCode[]
}

/**
 * 审计用的逐条明细。
 *
 * 闸门在决策解析**之前**就失败时 `resolved` 是空的 —— 那就退回到机器候选本身，
 * 至少把「机器拒了哪些」留在账上，而不是交一份空账。
 */
function auditRows(resolved: readonly ResolvedCandidate[], core: Partial<GeneratedPlanCore>): AuditRow[] {
  if (resolved.length > 0) {
    return resolved.map((r) => ({
      url: r.candidate.canonicalUrl ?? r.candidate.originalUrl,
      decision: r.decision,
      reasonCodes: r.reasonCodes,
    }))
  }
  const raw = Array.isArray(core.candidates) ? core.candidates : []
  return raw
    .filter((c): c is MachineCandidate => isMachineCandidateShape(c))
    .map((c) => ({
      url: c.canonicalUrl ?? c.originalUrl,
      decision: c.machineDecision,
      reasonCodes: c.reasonCodes,
    }))
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function unexpectedText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function sameHostSet(a: readonly string[], b: readonly string[]): boolean {
  const norm = (hosts: readonly string[]): string =>
    Array.from(new Set(hosts.map((h) => h.trim().toLowerCase())))
      .sort()
      .join('|')
  return norm(a) === norm(b)
}
