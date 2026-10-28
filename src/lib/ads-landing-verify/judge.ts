/**
 * Turn a destination and an optional page read into four plain results.
 * Skip means this ad does not have that check. Unchecked means a person must look.
 * A failure is never reported as a pass.
 */

import { utmPreserved } from '@/lib/ads-tracking-preflight/landing-probe'
import type { Destination, RequestTarget } from './destination'
import type { PageRead } from './fetch-page'

export type ItemKey = 'loads' | 'right_page' | 'form_fields' | 'utm'
export type ItemState = 'pass' | 'fail' | 'unchecked' | 'skip'

export interface LandingItem {
  readonly key: ItemKey
  readonly state: ItemState
  readonly detail: string
}

const NAME_RE = /^(name|full_name|fullname|full-name|first_name|firstname|your-name)$/i
const CONTACT_RE = /^(email|e-mail|phone|phone_number|tel|mobile)$/i
const SKIP_TYPE = new Set(['hidden', 'submit', 'button', 'image'])

function item(key: ItemKey, state: ItemState, detail: string): LandingItem {
  return { key, state, detail }
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  if (!match) return null
  return match[1] ?? match[2] ?? match[3] ?? ''
}

function formSignals(html: string): { hasForm: boolean; hasName: boolean; hasContact: boolean } {
  const visible = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  if (!/<form\b/i.test(visible)) return { hasForm: false, hasName: false, hasContact: false }
  let hasName = false
  let hasContact = false
  const tags = visible.match(/<(input|textarea|select)\b[^>]*>/gi) ?? []
  for (const tag of tags) {
    const type = (attr(tag, 'type') ?? '').toLowerCase()
    if (SKIP_TYPE.has(type)) continue
    const name = attr(tag, 'name') ?? ''
    if (NAME_RE.test(name)) hasName = true
    if (CONTACT_RE.test(name) || type === 'email' || type === 'tel') hasContact = true
  }
  return { hasForm: true, hasName, hasContact }
}

function leadItems(): LandingItem[] {
  return [
    item('loads', 'unchecked', '这是表单广告，系统打不开里面的表单'),
    item('right_page', 'unchecked', '请你确认就是这条广告用的那张表单'),
    item('form_fields', 'unchecked', '请核对表单里有姓名，以及邮箱或电话'),
    item('utm', 'skip', '表单广告不走网址上的追踪参数'),
  ]
}

function missingItems(): LandingItem[] {
  return [
    item('loads', 'fail', '没有落地页地址，也没有表单'),
    item('right_page', 'unchecked', '没有地址，对不上是不是这一页'),
    item('form_fields', 'unchecked', '没有表单可以核对字段'),
    item('utm', 'skip', '没有网址，不查追踪参数'),
  ]
}

function pageIdentity(raw: string): string | null {
  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const path = url.pathname.replace(/\/+$/, '').toLowerCase() || '/'
    return `${host}${path}`
  } catch {
    return null
  }
}

function loadDetail(read: PageRead | null, blocked: RequestTarget | null): LandingItem {
  if (blocked && !blocked.ok && blocked.reason === 'off_site') {
    return item('loads', 'fail', '地址不在这位客户的网站上，系统没有打开')
  }
  if (blocked && !blocked.ok && blocked.reason === 'no_site') {
    return item('loads', 'unchecked', '还没有记下这位客户的网站，系统没有打开')
  }
  if (blocked && !blocked.ok && blocked.reason === 'bad_tags') {
    return item('loads', 'unchecked', '网址参数读不懂，没有打开')
  }
  if (blocked && !blocked.ok && blocked.reason === 'bad_url') {
    return item('loads', 'fail', '落地页地址读不懂，没有打开')
  }
  if (!read || read.status !== 200) {
    if (read?.error?.includes('别的网站')) return item('loads', 'fail', '打开时跳到了别的网站，已经停下')
    if (read?.error?.includes('超时') || read?.error?.includes('时限')) {
      return item('loads', 'fail', '页面没有在时限内打开')
    }
    if (read?.status) return item('loads', 'fail', `打开时不是正常页面（状态 ${read.status}）`)
    return item('loads', 'fail', '页面没有打开')
  }
  return item('loads', 'pass', '页面能打开')
}

function rightPage(requested: string | null, finalUrl: string | null, opened: boolean): LandingItem {
  if (!requested) return item('right_page', 'unchecked', '没有地址，对不上是不是这一页')
  if (!opened || !finalUrl) return item('right_page', 'unchecked', '页面没打开，对不上是不是这一页')
  const left = pageIdentity(requested)
  const right = pageIdentity(finalUrl)
  if (left && right && left === right) return item('right_page', 'pass', '打开的就是这条广告要去的那一页')
  return item('right_page', 'fail', '打开的不是这条广告要去的那一页')
}

function formItem(html: string | null, opened: boolean): LandingItem {
  if (!opened) return item('form_fields', 'unchecked', '页面没打开，表单字段没读到')
  if (html === null) return item('form_fields', 'unchecked', '页面打开了，但内容没读到')
  const fields = formSignals(html)
  if (!fields.hasForm) return item('form_fields', 'skip', '这一页没有表单')
  if (fields.hasName && fields.hasContact) {
    return item('form_fields', 'pass', '表单里有姓名，也有邮箱或电话')
  }
  return item('form_fields', 'fail', '表单里缺姓名，或没有邮箱和电话')
}

function utmItem(requested: string | null, finalUrl: string | null, opened: boolean): LandingItem {
  if (!requested) return item('utm', 'skip', '没有网址，不查追踪参数')
  if (utmPreserved(requested, requested) === null) return item('utm', 'skip', '这条广告没有带追踪参数')
  if (!opened || !finalUrl) return item('utm', 'unchecked', '页面没打开，追踪参数没核对')
  if (utmPreserved(requested, finalUrl)) return item('utm', 'pass', '追踪参数在打开后还在')
  return item('utm', 'fail', '打开之后追踪参数丢了')
}

export function judgeDestination(
  dest: Destination,
  target: RequestTarget | null,
  read: PageRead | null,
): LandingItem[] {
  if (dest.kind === 'lead_form') return leadItems()
  if (dest.kind === 'missing') return missingItems()
  const requested = target && target.ok ? target.url : dest.linkUrl
  const opened = read?.status === 200 && !read.error
  const blocked = target && !target.ok ? target : null
  return [
    loadDetail(blocked ? null : read, blocked),
    rightPage(requested, read?.finalUrl ?? null, opened),
    formItem(opened ? read?.html ?? null : null, opened),
    utmItem(requested, read?.finalUrl ?? null, opened),
  ]
}

export function needsPerson(items: readonly LandingItem[]): boolean {
  return items.some((row) => row.state === 'fail' || row.state === 'unchecked')
}

const LABELS: Record<ItemKey, string> = {
  loads: '打得开吗',
  right_page: '是不是这一页',
  form_fields: '表单字段',
  utm: '追踪参数',
}

const STATE_WORD: Record<ItemState, string> = {
  pass: '通过',
  fail: '没通过',
  unchecked: '要你看',
  skip: '这次不查',
}

export function explainLines(items: readonly LandingItem[]): string[] {
  return items.map((row) => `${LABELS[row.key]}：${STATE_WORD[row.state]}。${row.detail}`)
}
