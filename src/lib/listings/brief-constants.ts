/**
 * 房子档案(listing_briefs)的共享枚举 —— 前端下拉 + 后端校验 + AI 提示词共用这一份。
 *
 * 跟 constants.ts(房子本身的枚举)同一条纪律,拆成两个文件只因为职责不同:
 * 那个是「这套房是什么」,这个是「我们对这套房的判断」。
 *
 * 这里的枚举比一般枚举更要紧一层:它们是**跨房子聚合的维度**。
 * 「投资客这条线在 200 万档是不是普遍更贵」这种问题,只有当 20 套房都用同一批
 * slug 才问得出来。一旦允许自由文本,攒到第 20 套就是 60 个近义词,一个都聚不起来。
 * 所以宁可窄:不确定的先不给值(进 gaps),不要现编一个。
 *
 * ⚠️ 加新值必须三处同步(CLAUDE.md enum 硬约束):
 *   ① 这个文件的 as const 数组 + LABEL 记录
 *   ② 数据库那边本表没有数组元素级 CHECK(见 migration 注释),所以真正的闸门
 *      就是这里 + brief-schema.ts —— 更不能松
 *   ③ 提示词里给 AI 的可选值清单是从这里生成的(见 brief-prompt.ts),自动跟上
 *
 * 纯净:不 import supabase、不碰运行时环境,client / server 都能安全引。
 */

// ── 买家类型 ──────────────────────────────────────────────────────────────────

export const BUYER_SEGMENTS = [
  'first_home',
  'investor',
  'wfh_family',
  'upsizer',
  'downsizer',
  'overseas',
] as const
export type BuyerSegment = (typeof BUYER_SEGMENTS)[number]

export function isBuyerSegment(v: unknown): v is BuyerSegment {
  return typeof v === 'string' && (BUYER_SEGMENTS as readonly string[]).includes(v)
}

export const BUYER_SEGMENT_LABEL: Record<BuyerSegment, string> = {
  first_home: '首次置业',
  investor:   '投资客',
  wfh_family: '在家办公的家庭',
  upsizer:    '换大房',
  downsizer:  '换小房',
  overseas:   '海外买家',
}

// ── 卖点 ──────────────────────────────────────────────────────────────────────

export const LISTING_ANGLES = [
  'move_in_ready',
  'yield',
  'school_zone',
  'wfh_space',
  'price_flexible',
  'location',
  'design',
  'community',
  'affordability',
] as const
export type ListingAngle = (typeof LISTING_ANGLES)[number]

export function isListingAngle(v: unknown): v is ListingAngle {
  return typeof v === 'string' && (LISTING_ANGLES as readonly string[]).includes(v)
}

export const LISTING_ANGLE_LABEL: Record<ListingAngle, string> = {
  move_in_ready:  '拎包入住',
  yield:          '租金回报',
  school_zone:    '学区',
  wfh_space:      '在家办公空间',
  price_flexible: '价格好谈',
  location:       '地段',
  design:         '设计 / 品质',
  community:      '社区氛围',
  affordability:  '总价门槛低',
}

// ── 犹豫点 ────────────────────────────────────────────────────────────────────

export const LISTING_HESITATIONS = [
  'market_falling',
  'commute',
  'terrace_vs_house',
  'suburb_reputation',
  'parking',
  'under_construction',
  'body_corp',
] as const
export type ListingHesitation = (typeof LISTING_HESITATIONS)[number]

export function isListingHesitation(v: unknown): v is ListingHesitation {
  return typeof v === 'string' && (LISTING_HESITATIONS as readonly string[]).includes(v)
}

export const LISTING_HESITATION_LABEL: Record<ListingHesitation, string> = {
  market_falling:     '怕市场还在跌',
  commute:            '通勤太远',
  terrace_vs_house:   '联排还是独立屋',
  suburb_reputation:  '这个区口碑',
  parking:            '车位不够',
  under_construction: '期房还没建好',
  body_corp:          '管理费',
}

// ── 档案状态 ──────────────────────────────────────────────────────────────────

export const LISTING_BRIEF_STATUSES = ['draft', 'active', 'superseded'] as const
export type ListingBriefStatus = (typeof LISTING_BRIEF_STATUSES)[number]

export function isListingBriefStatus(v: unknown): v is ListingBriefStatus {
  return typeof v === 'string' && (LISTING_BRIEF_STATUSES as readonly string[]).includes(v)
}

export const LISTING_BRIEF_STATUS_LABEL: Record<ListingBriefStatus, string> = {
  draft:      '草稿',
  active:     '已生效',
  superseded: '旧版本',
}

// ── 回填结论 ──────────────────────────────────────────────────────────────────

export const LISTING_BRIEF_VERDICTS = ['confirmed', 'partly', 'reversed', 'pending'] as const
export type ListingBriefVerdict = (typeof LISTING_BRIEF_VERDICTS)[number]

export function isListingBriefVerdict(v: unknown): v is ListingBriefVerdict {
  return typeof v === 'string' && (LISTING_BRIEF_VERDICTS as readonly string[]).includes(v)
}

export const LISTING_BRIEF_VERDICT_LABEL: Record<ListingBriefVerdict, string> = {
  confirmed: '当初判断对了',
  partly:    '对了一半',
  // 「相反」是最有价值的一档 —— 别在 UI 上把它做得像失败,不然没人愿意如实填。
  reversed:  '跟当初想的相反',
  pending:   '还没跑完',
}

// ── 来源三态(PM 认可的核心设计)────────────────────────────────────────────
//
// 每一条信息都要能回答「这是谁说的」。三态各自的意思:
//   cited    有出处 —— 房源页 / 搜到的网页,url 必须给得出来
//   inferred AI 判断 —— 从上下文推的,没有直接出处,人要重点看这一档
//   missing  缺 —— 查不到。**这是一个正经的结论,不是失败**,
//            因为「不知道」被诚实记下来,好过被一个编出来的数字盖住(ME 为此出过两次事故)。

export const BRIEF_SOURCE_KINDS = ['cited', 'inferred', 'missing'] as const
export type BriefSourceKind = (typeof BRIEF_SOURCE_KINDS)[number]

export function isBriefSourceKind(v: unknown): v is BriefSourceKind {
  return typeof v === 'string' && (BRIEF_SOURCE_KINDS as readonly string[]).includes(v)
}

export const BRIEF_SOURCE_KIND_LABEL: Record<BriefSourceKind, string> = {
  cited:    '有出处',
  inferred: 'AI 判断',
  missing:  '缺',
}

// ── 兜底取 label ──────────────────────────────────────────────────────────────
//
// 跟 constants.ts 同样的纪律:一律走函数,不直接 LABEL[value] 下标。
// 数据库里先出现了这里还不认识的值时,显示原始 slug —— 难看但看得见,
// 而不是渲染成空白让人以为没填。

export function buyerSegmentLabel(v: string | null | undefined): string {
  if (!v) return '—'
  return isBuyerSegment(v) ? BUYER_SEGMENT_LABEL[v] : v
}

export function listingAngleLabel(v: string | null | undefined): string {
  if (!v) return '—'
  return isListingAngle(v) ? LISTING_ANGLE_LABEL[v] : v
}

export function listingHesitationLabel(v: string | null | undefined): string {
  if (!v) return '—'
  return isListingHesitation(v) ? LISTING_HESITATION_LABEL[v] : v
}

export function listingBriefStatusLabel(v: string | null | undefined): string {
  if (!v) return '—'
  return isListingBriefStatus(v) ? LISTING_BRIEF_STATUS_LABEL[v] : v
}

export function listingBriefVerdictLabel(v: string | null | undefined): string {
  if (!v) return '—'
  return isListingBriefVerdict(v) ? LISTING_BRIEF_VERDICT_LABEL[v] : v
}

export function briefSourceKindLabel(v: string | null | undefined): string {
  if (!v) return '—'
  return isBriefSourceKind(v) ? BRIEF_SOURCE_KIND_LABEL[v] : v
}

// ── 下拉选项 ──────────────────────────────────────────────────────────────────

export const BUYER_SEGMENT_OPTIONS = BUYER_SEGMENTS.map(v => ({
  value: v,
  label: BUYER_SEGMENT_LABEL[v],
}))

export const LISTING_ANGLE_OPTIONS = LISTING_ANGLES.map(v => ({
  value: v,
  label: LISTING_ANGLE_LABEL[v],
}))

export const LISTING_HESITATION_OPTIONS = LISTING_HESITATIONS.map(v => ({
  value: v,
  label: LISTING_HESITATION_LABEL[v],
}))
