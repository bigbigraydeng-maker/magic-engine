/**
 * Meta 付费 vs 自然社媒 —— 线索入库、触点、CRM 来源共用的唯一判断。
 *
 * 付费只认付费信号：
 *   · utm_medium 属于付费集合（paid / cpc / ppc / paid_social / ads / cpm）
 *   · 有广告编号（显式 ad id，或 Meta 来源上 6 位以上纯数字的 utm_content）
 *   · fbclid 和广告编号同时出现（只有 fbclid 不算：自然帖点击也会带）
 *   · 来源是 Meta 即时表单
 *
 * utm_source 写成 facebook / fb / ig / instagram / meta，媒介是 organic、social、
 * organic_social，或没写媒介，记成自然社媒。其它非付费媒介同样不记成付费。
 *
 * 即时表单来源一律付费。Meta 的 is_organic 只留在触点 metadata，不进这个判断。
 * 广告名单导出的同意闸不在这里改：它仍只看已经存下的 platform==='meta' 或广告编号。
 */

export const PAID_UTM_MEDIUMS = ['paid', 'cpc', 'ppc', 'paid_social', 'ads', 'cpm'] as const

const META_UTM_SOURCES = ['facebook', 'fb', 'ig', 'instagram', 'meta'] as const

const AD_ID_RE = /^\d{6,}$/

export type MetaTouchClass = 'meta_paid' | 'organic_social' | 'not_meta'

export interface MetaTouchSignals {
  utmSource?: string | null
  utmMedium?: string | null
  utmContent?: string | null
  adId?: string | null
  fbclid?: string | null
  /** 'meta_lead_form' 本身就是付费信号。 */
  sourceKind?: string | null
}

function present(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim()
  if (!s || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') return null
  return s
}

function listed(value: string | null, allowed: readonly string[]): boolean {
  return value !== null && allowed.includes(value)
}

/** 6 位以上纯数字才当广告编号。短数字和人手写的素材名都不是。 */
export function isMetaAdId(raw: string | null): boolean {
  return raw !== null && AD_ID_RE.test(raw)
}

export function classifyMetaTouch(input: MetaTouchSignals): MetaTouchClass {
  if (present(input.sourceKind)?.toLowerCase() === 'meta_lead_form') return 'meta_paid'

  const source = present(input.utmSource)?.toLowerCase() ?? null
  const medium = present(input.utmMedium)?.toLowerCase() ?? null
  const metaSource = listed(source, META_UTM_SOURCES)
  const otherSource = source !== null && !metaSource
  const explicitAdId = present(input.adId)
  const contentAdId = isMetaAdId(present(input.utmContent))
  const fbclid = present(input.fbclid)

  if (!otherSource && explicitAdId) return 'meta_paid'
  if (metaSource && (listed(medium, PAID_UTM_MEDIUMS) || contentAdId)) return 'meta_paid'
  if (!otherSource && fbclid && contentAdId) return 'meta_paid'
  if (metaSource) return 'organic_social'
  return 'not_meta'
}

/**
 * 广告名单导出沿用的同意判断。口径不变：已存成 meta，或存了广告编号。
 * 自然社媒要靠分类结果（platform 不是 meta、也没有广告编号）才进不了这份名单。
 */
export function storedMetaAdConsent(platform: string | null, adId: string | null): boolean {
  return platform === 'meta' || adId != null
}
