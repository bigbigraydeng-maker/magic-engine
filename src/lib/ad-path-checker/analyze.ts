import { detectTrackingSignals } from '@/lib/prospecting/tracking-detector'
import type { Check, ScanReport, Suggestion } from './types'

export interface SourceDocument { text: string; source: string; kind: 'page' | 'script' }

/** Static structure only: do not expose input values, source text or contact identities. */
export function cleanMarkup(html: string): string {
  // A missing closer consumes the remaining input instead of retrying each
  // nested opener. [^<>] also prevents malformed open tags from rescanning.
  return html.replace(/<!--[\s\S]*?(?:-->|$)/g, '').replace(/<(script|style|template)\b[^<>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
}

function trackingHints(text: string) {
  const signals = detectTrackingSignals('')
  let inspected = 0
  // Reuse the detector on at most 64 short contexts, never the full hostile
  // document: its unrelated email extractor can backtrack on long tokens.
  for (const match of text.matchAll(/gtag|GTM-|connect\.facebook\.net|fbq|facebook\.com\/tr/g)) {
    const hint = detectTrackingSignals(text.slice(Math.max(0, match.index! - 2), match.index! + 298))
    signals.ga4 ||= hint.ga4
    signals.gtm ||= hint.gtm
    signals.meta_pixel ||= hint.meta_pixel
    if (++inspected >= 64) break
  }
  return signals
}

function* formMarkup(html: string): Generator<string> {
  const opening = /<form\b[^<>]*>/gi
  const closing = /<\/form\s*>/gi
  let match: RegExpExecArray | null
  while ((match = opening.exec(html))) {
    closing.lastIndex = opening.lastIndex
    const end = closing.exec(html)
    if (!end) return // An unclosed form is unknown, never retry all openers.
    yield html.slice(match.index, closing.lastIndex)
    opening.lastIndex = closing.lastIndex
  }
}

export function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(1).find(value => value !== undefined)?.replace(/&amp;/gi, '&')
}

export function linkedResources(html: string, base: URL): { scripts: string[]; contact?: string } {
  const scripts: string[] = []
  const source = html.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
  for (const tag of source.match(/<script\b[^<>]*>/gi) ?? []) {
    try {
      const src = attribute(tag, 'src')
      if (!src) continue
      const url = new URL(src, base)
      // No third-party beacons, tag managers or dynamic endpoints are fetched.
      if (url.origin === base.origin && /\.js$/i.test(url.pathname) && !url.search && !url.username && !url.password) scripts.push(url.href)
    } catch { /* malformed links are not scan targets */ }
  }
  const priority = (url: string) => /(?:layout|tracking|analytics)/i.test(url) ? 0 : /(?:app|main)/i.test(url) ? 1 : 2
  const selected = [...new Set(scripts)].sort((a, b) => priority(a) - priority(b)).slice(0, 3)
  let contact: string | undefined
  for (const tag of cleanMarkup(source).match(/<a\b[^<>]*>/gi) ?? []) {
    try {
      const href = attribute(tag, 'href')
      if (!href) continue
      const url = new URL(href, base)
      if (url.origin === base.origin && /^\/(?:[a-z]{2}\/)?(?:contact|contact-us|contactus|联系我们)\/?$/i.test(decodeURI(url.pathname)) && !url.search && url.pathname !== base.pathname) {
        contact = url.href
        break
      }
    } catch { /* malformed links are not scan targets */ }
  }
  return { scripts: selected, contact }
}

function uniqueMatches(text: string, regex: RegExp): string[] {
  const values = new Set<string>()
  for (const match of text.matchAll(regex)) {
    values.add(match[1])
    if (values.size === 8) break
  }
  return [...values]
}

export function analyzeDocuments(input: {
  documents: SourceDocument[]
  sourceUrl: string
  scannedAt: string
  https: boolean
  status: number
  incomplete: boolean
  ad: 'omitted' | 'unreadable' | 'readable'
  utm: 'absent' | 'preserved' | 'changed'
}): ScanReport {
  const { documents, sourceUrl, scannedAt } = input
  const pages = documents.filter(doc => doc.kind === 'page')
  const checks: Check[] = []
  const add = (id: string, title: string, state: Check['state'], detail: string, evidence: string[], sources = [sourceUrl]) => checks.push({ id, title, state, detail, evidence, sources })
  add('page', '页面能否打开', 'detected', '已读取公开网页。浏览器里的加载速度和交互体验仍需实际查看。', [`网页返回 HTTP ${input.status}。`])
  add('https', '连接是否加密', input.https ? 'detected' : 'not_detected', input.https ? '最终页面使用 HTTPS。' : '最终页面使用 HTTP，建议网站维护人员开启 HTTPS。', [input.https ? '最终 URL 使用 https 协议。' : '最终 URL 使用 http 协议。'])

  const tracking = documents.map(doc => ({ doc, signals: trackingHints(doc.text) }))
  const tagChecks: { id: string; title: string; regex: RegExp; match: (text: string, signals: ReturnType<typeof detectTrackingSignals>) => boolean }[] = [
    { id: 'ga4', title: '网站访问统计（GA4）', regex: /\b(G-[A-Z0-9]{6,20})\b/g, match: (text, signals) => signals.ga4 || /\bG-[A-Z0-9]{6,20}\b/.test(text) },
    { id: 'gtm', title: '追踪管理工具（GTM）', regex: /\b(GTM-[A-Z0-9]{4,20})\b/g, match: (_text, signals) => signals.gtm },
    { id: 'pixel', title: 'Facebook 广告追踪（Meta Pixel）', regex: /(?:fbq\(\s*["']init["']\s*,\s*["']|facebook\.com\/tr\?id=)(\d{8,20})/g, match: (text, signals) => signals.meta_pixel || /facebook\.com\/tr\?id=\d{8,20}/.test(text) },
    { id: 'google_ads', title: 'Google 广告追踪', regex: /\b(AW-\d{6,20})\b/g, match: text => /\bAW-\d{6,20}\b/.test(text) },
  ]
  for (const tag of tagChecks) {
    const hits = tracking.filter(({ doc, signals }) => tag.match(doc.text, signals))
    const ids = [...new Set(hits.flatMap(({ doc }) => uniqueMatches(doc.text, tag.regex)))].slice(0, 8)
    add(tag.id, tag.title, hits.length ? 'detected' : 'not_detected', hits.length
      ? '发现相关代码线索；不代表已经触发、归属正确，或询盘已被准确记录。'
      : '本次读取范围内未找到相关代码。代码可能由同意设置或其他脚本动态加载，不能据此断定未安装。',
    hits.length ? (ids.length ? ids.map(id => `公开代码编号：${id}`) : ['公开源代码含相关加载或初始化片段。']) : ['仅检查已读取的 HTML 和最多三个同源脚本。'],
    hits.length ? [...new Set(hits.map(({ doc }) => doc.source))] : [sourceUrl])
  }

  const contactKinds = new Set<string>()
  const contactSources = new Set<string>()
  let forms = 0
  let qualification = false
  let consent = false
  for (const doc of pages) {
    const markup = cleanMarkup(doc.text)
    for (const tag of markup.match(/<a\b[^<>]*>/gi) ?? []) {
      const href = attribute(tag, 'href')?.trim()
      if (!href) continue
      let kind: string | undefined
      if (/^mailto:[^?\s]+@/i.test(href)) kind = '邮箱'
      else if (/^tel:\+?[\d()\s-]{5,}/i.test(href)) kind = '电话'
      else {
        try {
          const url = new URL(href, doc.source)
          if (url.protocol !== 'https:') continue
          if (url.hostname === 'wa.me' && /^\/\d{6,15}\/?$/.test(url.pathname) || url.hostname === 'api.whatsapp.com' && url.pathname === '/send' && /^\d{6,15}$/.test(url.searchParams.get('phone') ?? '')) kind = 'WhatsApp'
          if (url.hostname === 'm.me' && /^\/[\w.-]+\/?$/.test(url.pathname)) kind = 'Messenger'
        } catch { /* do not interpret arbitrary strings as contact links */ }
      }
      if (kind) { contactKinds.add(kind); contactSources.add(doc.source) }
    }
    for (const form of formMarkup(markup)) {
      const fieldTags = form.match(/<(?:input|select|textarea)\b[^<>]*>/gi) ?? []
      const opening = form.slice(0, form.indexOf('>') + 1)
      if (!/contact|enquir|inquir|quote/i.test(opening) && !fieldTags.some(tag => /^(?:email|tel)$/i.test(attribute(tag, 'type') ?? ''))) continue
      forms++
      contactSources.add(doc.source)
      // Inspect field names/labels, never values or textarea content.
      const fields = fieldTags.map(tag => `${attribute(tag, 'name') ?? ''} ${attribute(tag, 'id') ?? ''} ${attribute(tag, 'placeholder') ?? ''}`).join(' ')
      if (/product|interest|country|quantity|budget|timeline|purchase|产品|国家|数量|预算|采购/i.test(fields)) qualification = true
    }
    consent ||= /(?:cookie|consent)[-_ ]?(?:banner|notice|dialog)|(?:accept|reject|manage)[\s\S]{0,30}cookies|cookie[\s\S]{0,30}(?:accept|preferences)|同意[\s\S]{0,12}(?:cookie|隐私)/i.test(markup)
  }
  if (forms) contactKinds.add('联系表单')
  const contacts = [...contactKinds]
  add('contact', '客户能从哪里联系你', contacts.length ? 'detected' : 'not_detected', contacts.length
    ? `公开页面中发现${contacts.join('、')}入口。这里只检查入口结构，没有拨号、发消息或提交表单。`
    : '本次读取的页面里未发现可识别的联系入口。动态按钮或图片中的联系方式可能无法识别。',
  contacts.length ? contacts.map(kind => `发现${kind}入口结构。`) : ['未匹配到可识别的电话、邮件、聊天链接或联系表单。'], contactSources.size ? [...contactSources] : [sourceUrl])
  add('form', '表单是否帮助筛选询盘', forms ? 'detected' : 'unknown', forms
    ? (qualification ? '发现产品、国家、预算等资格字段线索；是否足以筛选买家，需要结合业务确认。' : '发现联系表单，但未识别到产品、国家、数量等资格字段。可考虑补充一个对业务最有用的问题。')
    : '没有读取到可识别的联系表单，无法判断字段和提交后的流程。', forms ? [`发现 ${forms} 个含联系字段或联系标识的表单。`, qualification ? '存在资格字段名称线索。' : '未找到资格字段名称线索。', '未提交表单，未验证收件或提交后页面。'] : ['动态表单、平台内表单不在当前读取范围。'], [...contactSources])
  add('consent', '隐私选择提示', consent ? 'detected' : 'not_detected', consent ? '发现与 Cookie 选择提示相关的结构线索；未验证实际弹出、标签拦截或法律合规。' : '本次未识别到 Cookie 选择提示。它可能按地区或访问状态显示；这不是法律合规结论。', ['仅检查网页标记，不执行同意或拒绝操作。'])
  add('utm', '广告来源参数', input.utm === 'absent' ? 'unknown' : input.utm === 'preserved' ? 'detected' : 'unknown', input.utm === 'absent'
    ? '输入链接没有 UTM 参数，本次无法检查广告来源参数是否保留。'
    : input.utm === 'preserved' ? '输入链接中的 UTM 参数保留到了最终网页地址；无法证明表单或聊天继续传递了来源。' : '输入与最终网页地址的 UTM 参数不同；是否另有来源记录方式，需要进一步确认。', ['只比较输入地址和最终地址，不展示参数值。'])
  add('ad', '广告实际把客户带到哪里', 'unknown', input.ad === 'omitted'
    ? '本次只提供了网站，尚未确认广告指向网站、平台表单还是聊天。'
    : input.ad === 'readable' ? '可以读取部分 Facebook 公开页面，但不足以证明某条广告的真实点击去向或完整文案。' : 'Facebook 公开页面本次无法完整读取，网站结果仍然有效。', ['没有登录广告账户，没有点击广告或提交平台表单。'])
  add('alignment', '广告与承接页面的信息是否一致', 'unknown', '没有取得可对应到同一条广告的完整文案和点击目标，本次不判断价格、日期或产品信息是否一致。', ['需要补充可核对的单条广告素材，并人工确认实际承接页面。'])
  add('capi', '询盘是否正确回传给广告平台', 'needs_connection', 'CAPI、事件去重和匹配质量需要账户授权后的数据，公开网页无法证明。', ['本版不连接广告账户或发送转化事件。'])
  add('quality', '流量和询盘是否来自真实买家', 'unknown', '网页代码无法判断访客或聊天对象是否为真人，更不能证明采购意向。', ['需要访问行为、询盘和后续业务结果；本次未收集这些数据。'])

  const suggestions: Suggestion[] = []
  if (!input.https) suggestions.push({ title: '先为网站开启加密连接', reason: '最终访问页面仍使用 HTTP。', action: '让网站维护人员配置 HTTPS，并检查原链接是否正确跳转。', checkIds: ['https'] })
  if (!contacts.length) suggestions.push({ title: '先确认客户能在哪里找到你', reason: '已读取的页面里没有识别到清晰的联系入口。', action: '用手机打开页面，确认咨询按钮能看见、能打开，并说明联系后会发生什么。', checkIds: ['contact'] })
  const pixel = checks.find(check => check.id === 'pixel')!
  if (pixel.evidence.filter(e => e.startsWith('公开代码编号')).length > 1) suggestions.push({ title: '确认多个广告追踪编号的归属', reason: '页面中发现多个 Meta Pixel 编号。这可能是正常安排，本次不判为错误。', action: '把检测依据交给负责投放的人，核对这些编号对应的业务和广告账户。', checkIds: ['pixel'] })
  if (forms && !qualification) suggestions.push({ title: '让表单多帮你了解一步需求', reason: '联系表单里未识别到产品、国家或采购数量等资格字段。', action: '选择一个最有用的问题，例如想采购什么产品；保持表单简短。', checkIds: ['form'] })
  if (!suggestions.length) suggestions.push({ title: '走一遍客户联系你的最后一步', reason: contacts.length ? '已发现联系入口，但公开扫描无法验证消息能否送达。' : '公开页面提供的信息有限。', action: '从手机打开页面，手动确认咨询入口、接收方和回复安排。若要提交测试询盘，请先由业务负责人同意。', checkIds: ['contact', 'ad'] })
  return {
    version: 1, mode: 'live', scannedAt, sourceUrl, site: new URL(sourceUrl).hostname,
    headline: contacts.length ? '联系入口找到了，\n再确认客户能走到最后一步。' : '先让客户找到你，\n再让广告带来更多机会。',
    summary: contacts.length ? '已读取网站并发现联系入口。下面这件事，值得先确认。' : '已读取网站，部分入口仍需人工确认。先看看最值得处理的地方。',
    path: [{ label: '广告去向待确认', confirmed: false }, { label: '你提供的网站', confirmed: true }, { label: contacts.length ? contacts.join(' / ') : '联系入口待确认', confirmed: !!contacts.length }, { label: '实际送达待确认', confirmed: false }],
    checks, suggestions: suggestions.slice(0, 3),
    coverage: { pages: pages.length, scripts: documents.length - pages.length, incomplete: input.incomplete },
  }
}
