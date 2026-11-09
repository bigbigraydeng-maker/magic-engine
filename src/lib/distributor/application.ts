/**
 * Public distributor applications (the /partner/apply page). Anyone can submit, so every input is
 * untrusted: strict validation, a hidden honeypot field, per-source and global hourly caps, and the
 * same answer when the email already belongs to an active distributor, so the form cannot be used to
 * look up who is a distributor. Several pending applications may share an email (see the migration).
 * An application only ever creates a `pending` row; approval stays with an admin.
 */
import { createHmac } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { DISTRIBUTOR_TERMS_VERSION } from './terms'
import { DistributorStoreError, fail } from './store'
import type { Parsed } from './admin-input'
import { normaliseReferralCode } from './referral-code'

export const PER_SOURCE_HOURLY_LIMIT = 3
/** Flood brake only. Per-source caps do the real work; this is high so one sender cannot lock everyone out. */
export const GLOBAL_HOURLY_LIMIT = 200
const HOUR_MS = 3_600_000

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^\+?[0-9 ()-]{6,30}$/

export interface ApplicationInput {
  displayName: string
  contactEmail: string
  contactPhone: string
  region: string | null
  note: string | null
  referralCode: string | null
  termsVersion: string
  /** True when the hidden honeypot field was filled: answer as if accepted, write nothing. */
  isBot: boolean
}

function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\p{C}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max + 1)
}

export function parseApplication(body: unknown): Parsed<ApplicationInput> {
  const b = body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  const errors: string[] = []
  const displayName = clean(b.display_name, 100)
  if (displayName.length < 1 || displayName.length > 100) errors.push('请填写名字（100 字以内）')
  const email = clean(b.contact_email, 254).toLowerCase()
  if (!EMAIL.test(email) || email.length > 254) errors.push('邮箱格式不对')
  const phone = clean(b.contact_phone, 30)
  if (!PHONE.test(phone)) errors.push('电话格式不对（只填数字，可以带 + 号和空格）')
  const region = clean(b.region, 100)
  if (region.length > 100) errors.push('所在城市请控制在 100 字以内')
  const note = typeof b.note === 'string' ? b.note.replace(/[^\P{C}\n]/gu, ' ').trim() : ''
  if (note.length > 1000) errors.push('留言请控制在 1000 字以内')
  const rawRef = typeof b.referral_code === 'string' ? b.referral_code.trim() : ''
  const referralCode = rawRef ? normaliseReferralCode(rawRef) : null
  if (rawRef && !referralCode) errors.push('推荐码格式不对（8 位字母和数字）')
  if (b.accept_terms !== true) errors.push('请先阅读并勾选同意上面的经销商规则')
  if (b.terms_version !== DISTRIBUTOR_TERMS_VERSION) errors.push('条款已经更新，请刷新页面重新阅读后再提交')
  const isBot = typeof b.website === 'string' && b.website.trim() !== ''
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    value: { displayName, contactEmail: email, contactPhone: phone, region: region || null, note: note || null, referralCode, termsVersion: DISTRIBUTOR_TERMS_VERSION, isBot },
  }
}

/**
 * The visitor's address as our edge saw it. The left end of x-forwarded-for is whatever the client
 * typed, so it is never used: prefer the CDN's own header, else the right-most entry (appended by the
 * proxy in front of the app).
 */
export function clientIpFrom(headers: Headers): string {
  const cdn = headers.get('cf-connecting-ip')?.trim()
  if (cdn) return cdn.slice(0, 64)
  const hops = (headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (hops.length > 0) return hops[hops.length - 1].slice(0, 64)
  return headers.get('x-real-ip')?.trim().slice(0, 64) || 'unknown'
}

/** Keyed hash of the client IP: stable enough to count repeats, useless for recovering the address. */
export function hashApplicantIp(ip: string): string {
  const secret = process.env.DISTRIBUTOR_APPLY_IP_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!secret) throw new DistributorStoreError('暂时无法提交，请稍后再试', 503)
  // Never use a stored secret directly as the HMAC key: derive a purpose-bound key from it.
  const key = createHmac('sha256', secret).update('distributor-apply-ip-key-v1').digest()
  return createHmac('sha256', key).update(ip).digest('hex')
}

async function countRecent(ipHash: string | null, now: number): Promise<number> {
  let query = supabaseAdmin
    .from('distributors')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'application')
    .gte('created_at', new Date(now - HOUR_MS).toISOString())
  if (ipHash) query = query.eq('applicant_ip_hash', ipHash)
  const { count, error } = await query
  // Fail closed: a public write we cannot meter is refused rather than let through.
  if (error) {
    console.error('[distributor-apply] rate count failed:', error.message)
    throw new DistributorStoreError('暂时无法提交，请稍后再试', 503)
  }
  return count ?? 0
}

async function uplineFor(code: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('distributors').select('id').eq('referral_code', code).eq('status', 'approved').maybeSingle()
  if (error) fail('look up referral code', error)
  const id = (data as { id: string } | null)?.id
  if (!id) throw new DistributorStoreError('推荐码无效，请向介绍你的人确认，或者留空', 400)
  return id
}

/** Stores a pending application. Resolves the same way for a new email and an already-applied one. */
export async function submitApplication(input: ApplicationInput, ipHash: string, now = Date.now()): Promise<void> {
  if (input.isBot) return
  if ((await countRecent(ipHash, now)) >= PER_SOURCE_HOURLY_LIMIT) {
    throw new DistributorStoreError('提交太频繁了，请一小时后再试', 429)
  }
  if ((await countRecent(null, now)) >= GLOBAL_HOURLY_LIMIT) {
    throw new DistributorStoreError('现在申请的人太多，请一小时后再试', 429)
  }
  const parentId = input.referralCode ? await uplineFor(input.referralCode) : null
  const { error } = await supabaseAdmin.from('distributors').insert({
    display_name: input.displayName,
    contact_email: input.contactEmail,
    contact_phone: input.contactPhone,
    region: input.region,
    application_note: input.note,
    parent_id: parentId,
    source: 'application',
    terms_version: input.termsVersion,
    terms_accepted_at: new Date(now).toISOString(),
    applicant_ip_hash: ipHash,
  })
  // Email already belongs to a live distributor: do not tell the visitor which emails are distributors.
  if (error?.code === '23505') return
  if (error) fail('store application', error)
}
