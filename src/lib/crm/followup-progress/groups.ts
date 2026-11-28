/**
 * Which follow-up group an open guest is in today. Pure.
 *
 * The page "跟进进度" and the daily snapshot both count from here, so the two never disagree.
 * This is a coarse view of the whole book ("who should handle this guest, and how"), not the staff's call list:
 * "今天要联系" (`segments.ts`) ranks who to ring today and has its own finer rules. The page says so.
 *
 * Every fact comes from a judgement that already has one home: a staff contact is `isHumanFollowup`
 * (`lead-followup-due.ts`), a closed stage is `stageSuppressesWorklist` (`pipeline.ts`), a qualified guest is the
 * client's own qualified stages. Nothing here names a client, a stage key or an industry.
 */

import { stageSuppressesWorklist, type MarketingAction } from '@/lib/crm/pipeline'

export const FOLLOWUP_GROUPS = [
  'awaiting_reply', 'new_lead', 'never_contacted', 'no_enquiry', 'qualified', 'warm', 'cold', 'later', 'ai', 'no_contact_details',
] as const
export type FollowupGroup = (typeof FOLLOWUP_GROUPS)[number]

export const OUT_OF_SCOPE = ['do_not_contact', 'not_guest', 'booked', 'closed_stage', 'unknown_stage'] as const
export type OutOfScope = (typeof OUT_OF_SCOPE)[number]

export type GroupVerdict = { inScope: true; group: FollowupGroup } | { inScope: false; why: OutOfScope }

export interface GuestFacts {
  doNotContact: boolean
  /** Not a retail guest: the client's own staff, a trade partner, a system account or a test lead. */
  notGuest: boolean
  hasActiveBooking: boolean
  /** null = nobody has moved this guest yet: a new lead, still open. */
  stage: string | null
  /** The stage's marketing action in the client's own stage list; null = the stage is not in that list. */
  stageAction: MarketingAction | null
  stageTerminal: boolean
  /** The stage is one of the client's qualified stages (high intent stays with staff). */
  qualified: boolean
  /** When the AI follow-up took this guest on; null = not with the AI. The mark stays until staff take the guest back. */
  aiTakeoverSince: string | null
  /** Staff asked to be reminded later and that time has not come. */
  snoozed: boolean
  hasEmail: boolean
  hasPhone: boolean
  /** Latest call or personal message from our side on record (`isHumanFollowup`); machine sends and Messenger sends do not count. */
  lastStaffAt: string | null
  /** Latest time the guest wrote or rang in their own words: reply email, WhatsApp, a call (answered or missed). */
  lastGuestMessageAt: string | null
  /** Latest enquiry form. */
  lastEnquiryAt: string | null
  /** Latest open or click on a mail of ours. */
  lastEngagedAt: string | null
}

export interface GroupConfig {
  /** An enquiry this recent with no staff contact after it is a new lead. */
  newLeadDays: number
  /** An open or click this recent makes a quiet guest warm. */
  warmDays: number
}

export const DEFAULT_GROUP_CONFIG: GroupConfig = { newLeadDays: 14, warmDays: 30 }

const DAY_MS = 86_400_000

function ms(iso: string | null): number | null {
  if (iso === null) return null
  const n = Date.parse(iso)
  return Number.isFinite(n) ? n : null
}

function within(at: number | null, now: Date, days: number): boolean {
  return at !== null && now.getTime() - at <= days * DAY_MS
}

/** The guest's group, or why the guest is outside the follow-up work. First match wins, in this order. */
export function groupOf(f: GuestFacts, now: Date, cfg: GroupConfig = DEFAULT_GROUP_CONFIG): GroupVerdict {
  if (f.doNotContact) return { inScope: false, why: 'do_not_contact' }
  if (f.notGuest) return { inScope: false, why: 'not_guest' }
  if (f.hasActiveBooking) return { inScope: false, why: 'booked' }
  const newLead = f.stage === null || f.stage === ''
  // A stage missing from the client's list cannot be judged: counted on its own line, never guessed into a group.
  if (!newLead && f.stageAction === null) return { inScope: false, why: 'unknown_stage' }
  if (!newLead && stageSuppressesWorklist(f.stageAction, f.stageTerminal)) return { inScope: false, why: 'closed_stage' }
  const staff = ms(f.lastStaffAt)
  const guest = ms(f.lastGuestMessageAt)
  const waiting = guest !== null && (staff === null || guest > staff)
  const ai = ms(f.aiTakeoverSince)
  // With the AI, but the guest has spoken since and nobody answered: staff must see this guest, not the AI line.
  if (f.aiTakeoverSince !== null) return { inScope: true, group: waiting && (ai === null || (guest as number) > ai) ? 'awaiting_reply' : 'ai' }
  if (f.qualified) return { inScope: true, group: 'qualified' }
  if (!f.hasEmail && !f.hasPhone) return { inScope: true, group: 'no_contact_details' }
  if (waiting) return { inScope: true, group: 'awaiting_reply' }
  if (f.snoozed) return { inScope: true, group: 'later' }
  const enquiry = ms(f.lastEnquiryAt)
  if (within(enquiry, now, cfg.newLeadDays) && (staff === null || (enquiry as number) > staff)) return { inScope: true, group: 'new_lead' }
  if (f.stageAction === 'defer') return { inScope: true, group: 'later' }
  if (staff === null) return { inScope: true, group: enquiry === null ? 'no_enquiry' : 'never_contacted' }
  if (within(ms(f.lastEngagedAt), now, cfg.warmDays)) return { inScope: true, group: 'warm' }
  return { inScope: true, group: 'cold' }
}

export interface GroupMeta {
  /** What staff see. */
  label: string
  /** Who handles this group and how, one sentence. */
  howTo: string
  /** Who acts by default: client staff, the AI follow-up (a person still releases each letter), or nobody for now. */
  owner: 'staff' | 'ai' | 'none'
  /** The CRM page where this group is worked, relative to the client's CRM root; null = no page. */
  page: string | null
  /** The page needs the client's CRM email feature (same gate as its item in the CRM top nav). */
  needsEmailFeature: boolean
}

/**
 * Default wording and default owner per group. Kept neutral: no client's product, no industry's nouns.
 * Who owns a group ("the AI takes guests nobody rang") is a default here; a client that works differently
 * needs this moved to client configuration (noted in the ledger card for this feature).
 */
export function groupMeta(cfg: GroupConfig = DEFAULT_GROUP_CONFIG): Record<FollowupGroup, GroupMeta> {
  return {
    awaiting_reply: { label: '客人来过信或来过电，之后没记录有人回', howTo: '员工今天回。先看邮箱里是不是已经回过，系统里可能没记上。', owner: 'staff', page: 'all', needsEmailFeature: false },
    new_lead: { label: `近 ${cfg.newLeadDays} 天填了表，之后还没人联系`, howTo: '员工今天打电话，最新填表的先打。', owner: 'staff', page: 'all', needsEmailFeature: false },
    never_contacted: { label: '填过表，记录里没人打过电话或发过信', howTo: '久没人打的可以交给 AI 发第一封信：到「交给 AI」页放行。那一页按自己的规则再筛一遍，能放行的人数比这里少。', owner: 'ai', page: 'ai-pickup', needsEmailFeature: true },
    no_enquiry: { label: '没填过表，也没记录有人联系', howTo: '多半是来信或私信进来的，员工看一眼是不是真客人。', owner: 'staff', page: 'all', needsEmailFeature: false },
    qualified: { label: '意向高的客人，还没成交', howTo: '员工自己跟，AI 不接。久没联系的先打。', owner: 'staff', page: 'all', needsEmailFeature: false },
    warm: { label: `打过电话或发过信，近 ${cfg.warmDays} 天还在看我们的邮件`, howTo: '最适合一人一封的跟进信，写好后进放行页，人点了才发。', owner: 'ai', page: null, needsEmailFeature: false },
    cold: { label: `打过电话或发过信，近 ${cfg.warmDays} 天没动静`, howTo: '不单独花力气，只收定期群发。', owner: 'none', page: null, needsEmailFeature: false },
    later: { label: '说了以后再考虑，或员工设了稍后提醒', howTo: '现在不打扰，到客人说的时间再联系。', owner: 'none', page: null, needsEmailFeature: false },
    ai: { label: 'AI 跟进中', howTo: 'AI 已发出第一封信，之后按节奏再跟一封；客人一回话就转回员工。', owner: 'ai', page: 'day7-followup', needsEmailFeature: true },
    no_contact_details: { label: '没邮箱也没电话', howTo: '邮件和电话都联系不上，先放着。', owner: 'none', page: null, needsEmailFeature: false },
  }
}

export const OUT_OF_SCOPE_LABEL: Record<OutOfScope, string> = {
  do_not_contact: '别再联系',
  not_guest: '不是客人（自己人、同行、系统账号、测试）',
  booked: '已有订单',
  closed_stage: '阶段已结束（成交、售后或不再跟进）',
  unknown_stage: '阶段不在阶段表里（没法判断）',
}

export interface GroupCounts {
  total: number
  inScope: number
  groups: Record<FollowupGroup, number>
  out: Record<OutOfScope, number>
}

export function emptyCounts(): GroupCounts {
  return {
    total: 0, inScope: 0,
    groups: { awaiting_reply: 0, new_lead: 0, never_contacted: 0, no_enquiry: 0, qualified: 0, warm: 0, cold: 0, later: 0, ai: 0, no_contact_details: 0 },
    out: { do_not_contact: 0, not_guest: 0, booked: 0, closed_stage: 0, unknown_stage: 0 },
  }
}

export function countGroups(verdicts: Iterable<GroupVerdict>): GroupCounts {
  const c = emptyCounts()
  for (const v of verdicts) {
    c.total += 1
    if (v.inScope) { c.inScope += 1; c.groups[v.group] += 1 } else c.out[v.why] += 1
  }
  return c
}
