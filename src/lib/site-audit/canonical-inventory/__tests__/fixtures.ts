/**
 * 台账测试的公用夹具（Issue #960）。
 *
 * 🔴 这里的密钥是**真的** HMAC 密钥，不是「假签名」占位串。#930 时代那个
 *    `sig:${hash}` 的假签名能证明「验签被调用了」，证明不了「不持密钥的人伪造不出来」——
 *    而后者才是 #960 的全部命题。对抗测试必须在**拿不到密钥**的前提下伪造，
 *    所以夹具得给出真实密钥环，测试只用其中的验签器。
 */

import { vi } from 'vitest'
import { createHmacSigner, createHmacVerifier } from '../signing'
import { signReview } from '../review'
import { FakeInventoryStore } from './fake-store'
import type { ActivateInput } from '../activation'
import type { CrawlResult } from '../../crawler'
import type { EnrichedPage } from '../../page-enrichment'
import { sealEnvelope } from '../envelope'
import { buildInventoryPlan } from '../plan'
import type {
  ActivationDeps,
  ActivationExpectation,
  DiscoveryOutcome,
  GeneratedPlanCore,
  HostAcknowledgement,
  InventoryPlanEnvelope,
  ReviewDecisionEntry,
  ReviewSubmission,
  SignedReview,
} from '../types'

export const CLIENT = '00000000-0000-0000-0000-0000000000aa'
export const DOMAIN = 'example.com'
export const HOSTS = ['example.com']

export const GEN_KEY_ID = 'gen-2026-08'
export const REV_KEY_ID = 'rev-2026-08'
/** 48 字节，超过 `MIN_SIGNING_SECRET_BYTES`。两把**不同**的密钥。 */
export const GEN_SECRET = 'generation-secret-generation-secret-generation!!'
export const REV_SECRET = 'review-secret-review-secret-review-secret-review'

export const GEN_KEYS = { [GEN_KEY_ID]: GEN_SECRET }
export const REV_KEYS = { [REV_KEY_ID]: REV_SECRET }

export const genSigner = createHmacSigner({ keys: GEN_KEYS, activeKeyId: GEN_KEY_ID })
export const revSigner = createHmacSigner({ keys: REV_KEYS, activeKeyId: REV_KEY_ID })
export const verifyGeneration = createHmacVerifier({ keys: GEN_KEYS })
export const verifyReview = createHmacVerifier({ keys: REV_KEYS })

export const PLAN_ID = 'plan-0001'
export const ISSUED_AT = '2026-08-12T00:00:00.000Z'
/** 签发后 2 小时 —— 稳稳在 7 天有效期内。 */
export const NOW = '2026-08-12T02:00:00.000Z'

/** 按真实主机归属统计 —— 不能拿清单长度充数，计划会拿这个数字跟候选对账。 */
export function discoveryFor(urls: readonly string[], hosts: readonly string[]): DiscoveryOutcome {
  const perHost = hosts.map((host) => {
    const own = new Set<string>()
    for (const u of urls) {
      try {
        if (new URL(u.trim()).hostname.toLowerCase() === host.trim().toLowerCase()) own.add(u.trim())
      } catch {
        /* 畸形 URL 不参与逐主机统计 */
      }
    }
    return { host: host.trim().toLowerCase(), count: own.size, foreignCount: 0, error: null }
  })
  return { urls, perHost }
}

export function makeCore(
  urls: readonly string[],
  over: { hosts?: readonly string[]; domain?: string; clientId?: string } = {},
): GeneratedPlanCore {
  const hosts = over.hosts ?? HOSTS
  return buildInventoryPlan({
    clientId: over.clientId ?? CLIENT,
    requestedDomain: over.domain ?? DOMAIN,
    approvedHosts: hosts,
    discovery: discoveryFor(urls, hosts),
  })
}

export function makeEnvelope(
  core: GeneratedPlanCore,
  over: { planId?: string; issuedAt?: string } = {},
): InventoryPlanEnvelope {
  return sealEnvelope(
    { planId: over.planId ?? PLAN_ID, issuedAt: over.issuedAt ?? ISSUED_AT, core },
    genSigner,
  )
}

export function makeSubmission(
  envelope: InventoryPlanEnvelope,
  decisions: Readonly<Record<string, ReviewDecisionEntry>>,
  over: {
    acknowledgements?: Readonly<Record<string, HostAcknowledgement>>
    reviewedBy?: string
    reviewedAt?: string
  } = {},
): ReviewSubmission {
  return {
    planId: envelope.planId,
    generationDigest: envelope.generationDigest,
    reviewedBy: over.reviewedBy ?? 'product-owner',
    reviewedAt: over.reviewedAt ?? '2026-08-12T01:00:00.000Z',
    reviewerIdentitySource: 'self_reported',
    decisions,
    acknowledgements: over.acknowledgements ?? {},
  }
}

/** 把每条 pending 候选都判成 accepted —— 「全过」的基线用。 */
export function acceptAllPending(core: GeneratedPlanCore): Record<string, ReviewDecisionEntry> {
  const out: Record<string, ReviewDecisionEntry> = {}
  for (const c of core.candidates) {
    if (c.machineDecision === 'pending') out[c.originalUrl] = { decision: 'accepted' }
  }
  return out
}

// ---------------------------------------------------------------------------
// 激活用的夹具
// ---------------------------------------------------------------------------

export function makeCrawlResult(url: string, over: Partial<CrawlResult> = {}): CrawlResult {
  return {
    url,
    markdown: `# ${url}\nreal page body`,
    title: `Title ${url}`,
    statusCode: 200,
    crawledAt: new Date('2026-08-12T01:30:00.000Z'),
    ...over,
  }
}

export function makeEnriched(over: Partial<EnrichedPage> = {}): EnrichedPage {
  return {
    pageType: 'service',
    topics: ['t1'],
    primaryKeyword: 'kw',
    classificationConfidence: 0.9,
    classified: true,
    classificationError: null,
    hasGeoBlock: false,
    geoDetectionMethod: null,
    geoConfidence: 0,
    wordCount: 5,
    ...over,
  }
}

export interface ActivationFixtureDeps extends ActivationDeps {
  readonly store: FakeInventoryStore
  /** 记录抓取被调用过几次 —— 「一次抓取都没发生」这条承诺靠它来证。 */
  readonly crawlSpy: ReturnType<typeof vi.fn>
}

export function makeActivationDeps(over: Partial<ActivationDeps> = {}): ActivationFixtureDeps {
  const store = (over.store as FakeInventoryStore) ?? new FakeInventoryStore()
  const crawlSpy = vi.fn(async (urls: readonly string[]) => urls.map((u) => makeCrawlResult(u)))
  return {
    store,
    crawlSpy,
    verifyGenerationSignature: over.verifyGenerationSignature ?? verifyGeneration,
    verifyReviewAttestation: over.verifyReviewAttestation ?? verifyReview,
    crawl: over.crawl ?? crawlSpy,
    enrich: over.enrich ?? (async () => makeEnriched()),
    now: over.now ?? (() => NOW),
  }
}

export function makeActivationInput(over: {
  envelope?: InventoryPlanEnvelope
  review?: SignedReview
  expected?: ActivationExpectation
  deps?: ActivationFixtureDeps
} = {}): ActivateInput & { deps: ActivationFixtureDeps } {
  const envelope = over.envelope ?? makeEnvelope(makeCore(['https://example.com/a', 'https://example.com/b']))
  const review =
    over.review ??
    signReview(envelope, makeSubmission(envelope, acceptAllPending(envelope.core)), {
      verifyGenerationSignature: verifyGeneration,
      signer: revSigner,
    })
  return {
    envelope,
    review,
    expected: over.expected ?? { clientId: CLIENT, requestedDomain: DOMAIN, approvedHosts: HOSTS },
    mode: 'first_activation',
    deps: over.deps ?? makeActivationDeps(),
  }
}
