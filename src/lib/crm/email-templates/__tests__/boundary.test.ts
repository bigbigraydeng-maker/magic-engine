/**
 * 平台边界：邮件模板这套机制是平台共享的，旅游 / CTS 的词汇只能出现在「内容来源提供者」里
 * （`facts/published-tours.ts`）和客户私有的种子 / 配置里（`scripts/…`、`docs/clients/…`）。
 *
 * 钉死两件事：
 *  1. 共享文件（除 facts/ 外）里一个客户名、客户员工名、旅游占位符名都不能有；
 *  2. 「已发布团目录」这个提供者的名字只能出现在下面登记过的几个文件里——这是已知的、登记在案的耦合
 *     （共享闸目前只认一个提供者）。以后第二个提供者（例如地产房源）来了，要把它改成按提供者登记的 map；
 *     在那之前，任何新文件再提它都会让这条测试变红，逼着先想清楚该放哪层。
 */

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '..')
const REPO = path.resolve(ROOT, '../../../..')

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'facts' ? [] : walk(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

const SHARED: string[] = [
  ...walk(ROOT),
  path.join(REPO, 'src/lib/inngest/crm-email-events.ts'),
  path.join(REPO, 'src/lib/inngest/functions/crm-email-send-receipt.ts'),
]

const rel = (file: string): string => path.relative(REPO, file)

// Travel placeholders and customer / staff names. Case-sensitive on purpose (`CTS` the company, not "cts" inside a word).
const FORBIDDEN = /tour_name|tour_price|tour_url|tour_cards|tour_highlights|tour_inclusions|tour_duration|departure_date|ctstours|\bCTS\b|Lisa|Roman|Oztop/

// The ONE provider setting that is spelled out in the shared settings parser (its key names are the stored contract).
const ALLOWED_PROVIDER_KEYS: Record<string, RegExp> = {
  'src/lib/crm/email-templates/settings.ts': /all_tours_url/,
}

const PROVIDER_NAME = /published_tours|publishedTours|PublishedTour/
// Known coupling (see the header): the shared gates and the settings contract name the single provider that exists today.
const PROVIDER_NAME_ALLOWED = new Set([
  'src/lib/crm/email-templates/types.ts',
  'src/lib/crm/email-templates/settings.ts',
  'src/lib/crm/email-templates/send-gates.ts',
  'src/lib/crm/email-templates/send-gates-prod.ts',
  'src/lib/crm/email-templates/template-preview.ts',
])

describe('email template platform boundary', () => {
  it('scans the shared files it is meant to protect', () => {
    const names = SHARED.map(rel)
    expect(names).toContain('src/lib/crm/email-templates/render.ts')
    expect(names).toContain('src/lib/crm/email-templates/send-gates.ts')
    expect(names).toContain('src/lib/inngest/crm-email-events.ts')
    expect(names.some((n) => n.includes('/facts/'))).toBe(false)
  })

  it('no shared file names a customer, a staff member or a travel placeholder', () => {
    const offenders: string[] = []
    for (const file of SHARED) {
      const text = fs.readFileSync(file, 'utf8').replace(ALLOWED_PROVIDER_KEYS[rel(file)] ?? /$^/g, '')
      const hit = FORBIDDEN.exec(text)
      if (hit) offenders.push(`${rel(file)}: ${hit[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('only the registered shared files name the tour-catalog provider', () => {
    const offenders = SHARED.filter((file) => PROVIDER_NAME.test(fs.readFileSync(file, 'utf8')) && !PROVIDER_NAME_ALLOWED.has(rel(file))).map(rel)
    expect(offenders).toEqual([])
  })

  it('the registered files still need their entry (an entry that no longer applies is removed)', () => {
    const stale = Array.from(PROVIDER_NAME_ALLOWED).filter((file) => !PROVIDER_NAME.test(fs.readFileSync(path.join(REPO, file), 'utf8')))
    expect(stale).toEqual([])
  })

  it('the shared screens (src/app/dashboard/.../crm) do not name a customer or a staff member either', () => {
    const crm = path.join(REPO, 'src/app/dashboard/clients/[id]/crm')
    const files = [
      'templates/page.tsx',
      ...['TemplateEmailPanel', 'PostCallEmailBar', 'TemplateEditor', 'TemplatesAdmin', 'EmailSettingsPanel', 'RecentSends'].map((n) => `_components/${n}.tsx`),
    ]
    const offenders = files.filter((f) => FORBIDDEN.test(fs.readFileSync(path.join(crm, f), 'utf8')))
    expect(offenders).toEqual([])
  })

  it('the provider module itself is where the travel vocabulary lives', () => {
    const provider = fs.readFileSync(path.join(ROOT, 'facts/published-tours.ts'), 'utf8')
    for (const name of ['tour_name', 'tour_price', 'tour_url', 'tour_cards', 'departure_date', 'all_tours_url']) expect(provider).toContain(name)
  })

  it('the customer-private seed text is not part of the shared code', () => {
    const seed = path.join(REPO, 'scripts/crm-email-template-seeds/cts.ts')
    expect(fs.existsSync(seed)).toBe(true)
    expect(SHARED.map(rel)).not.toContain(rel(seed))
    expect(fs.readFileSync(seed, 'utf8')).toContain('CTS Tours')
  })
})
