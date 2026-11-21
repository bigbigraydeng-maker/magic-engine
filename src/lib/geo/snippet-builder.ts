/**
 * GEO Composer — snippet builder.
 *
 * Wraps the HTML block with platform-specific installation instructions,
 * producing a ready-to-share Copy-Paste guide for the client.
 *
 * Personal IP clients (`client_kind === 'personal_ip'`) also get schema.org Person
 * JSON-LD and AI-tracking question lines that name the person when profile fields exist.
 *
 * Reference: ROADMAP.md P7.2.4, ARCHITECTURE.md §11.7
 */

import { readClientKind } from '@/lib/huatuo/personal-ip'

export type SnippetPlatform = 'generic' | 'wordpress' | 'webflow'

export interface InstallSnippet {
  platform: SnippetPlatform
  html: string
  instructions: string[]
}

/** Fields already stored on the client / active brief; no invented defaults. */
export interface GeoSnippetProfileFields {
  client_kind?: unknown
  contact_name?: string | null
  persona_name?: string | null
  persona_role?: string | null
  facebook_page_url?: string | null
  tiktok_handle?: string | null
  youtube_channel_id?: string | null
}

export interface BuildSnippetsOptions {
  profile?: GeoSnippetProfileFields | null
  aiTrackingQuestions?: readonly string[] | null
}

const GEO_BLOCK_END = '</div>\n<!-- End Instructions for AI Agents -->'

/**
 * Build installation snippets for all supported platforms.
 */
export function buildSnippets(html: string, options?: BuildSnippetsOptions): InstallSnippet[] {
  const siteHtml = enrichSiteSnippetHtml(html, options)
  return [
    buildGeneric(siteHtml),
    buildWordPress(siteHtml),
    buildWebflow(siteHtml),
  ]
}

/** Append personal-IP identity markup; standard clients and unreadable kind pass through unchanged. */
export function enrichSiteSnippetHtml(baseHtml: string, options?: BuildSnippetsOptions): string {
  const profile = options?.profile
  if (!profile || readClientKind(profile.client_kind) !== 'personal_ip') {
    return baseHtml
  }

  const innerLines: string[] = []
  const questions = (options?.aiTrackingQuestions ?? []).filter((q) => q.trim().length > 0)
  const personName = resolvePersonDisplayName(profile)

  if (questions.length > 0) {
    innerLines.push('')
    innerLines.push('AI visibility tracking questions:')
    const listed = personName ? personalizeAiTrackingQuestions(questions, personName) : questions
    listed.forEach((q, i) => innerLines.push(`${i + 1}. ${q}`))
  }

  const jsonLd = buildPersonJsonLdScript(profile)
  const innerBlock = innerLines.length > 0 ? `${innerLines.join('\n')}\n` : ''
  if (!innerBlock && !jsonLd) return baseHtml

  if (baseHtml.includes(GEO_BLOCK_END)) {
    const replacement = `${innerBlock}</div>\n${jsonLd ? `${jsonLd}\n` : ''}<!-- End Instructions for AI Agents -->`
    return baseHtml.replace(GEO_BLOCK_END, replacement)
  }
  return `${baseHtml}\n${[innerBlock, jsonLd].filter(Boolean).join('\n')}`
}

export function resolvePersonDisplayName(profile: GeoSnippetProfileFields): string | null {
  for (const raw of [profile.persona_name, profile.contact_name]) {
    const name = typeof raw === 'string' ? raw.trim() : ''
    if (name) return name
  }
  return null
}

export function buildPersonJsonLd(profile: GeoSnippetProfileFields): Record<string, unknown> | null {
  const name = resolvePersonDisplayName(profile)
  if (!name) return null

  const node: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name,
  }
  const jobTitle = typeof profile.persona_role === 'string' ? profile.persona_role.trim() : ''
  if (jobTitle) node.jobTitle = jobTitle

  const sameAs = collectSameAs(profile)
  if (sameAs.length > 0) node.sameAs = sameAs

  return node
}

function buildPersonJsonLdScript(profile: GeoSnippetProfileFields): string | null {
  const node = buildPersonJsonLd(profile)
  if (!node) return null
  return `<script type="application/ld+json">${JSON.stringify(node)}</script>`
}

export function collectSameAs(profile: GeoSnippetProfileFields): string[] {
  const urls: string[] = []
  const fb = normaliseHttpUrl(profile.facebook_page_url)
  if (fb) urls.push(fb)

  const tiktok = tiktokProfileUrl(profile.tiktok_handle)
  if (tiktok) urls.push(tiktok)

  const yt = youtubeChannelUrl(profile.youtube_channel_id)
  if (yt) urls.push(yt)

  return urls
}

export function personalizeAiTrackingQuestions(
  questions: readonly string[],
  personName: string,
): string[] {
  const needle = personName.trim().toLowerCase()
  if (!needle) return [...questions]
  return questions.map((q) => {
    if (q.toLowerCase().includes(needle)) return q
    return `${q} (include whether ${personName} is mentioned)`
  })
}

function normaliseHttpUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.startsWith('https://')) return null
  return trimmed
}

function tiktokProfileUrl(handle: string | null | undefined): string | null {
  if (typeof handle !== 'string') return null
  const h = handle.trim().replace(/^@+/, '')
  if (!h) return null
  return `https://www.tiktok.com/@${h}`
}

function youtubeChannelUrl(channelId: string | null | undefined): string | null {
  if (typeof channelId !== 'string') return null
  const id = channelId.trim()
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(id)) return null
  return `https://www.youtube.com/channel/${id}`
}

/**
 * Generic HTML snippet — works on any website.
 */
function buildGeneric(html: string): InstallSnippet {
  return {
    platform: 'generic',
    html,
    instructions: [
      'Copy the HTML block below.',
      'Paste it inside the <body> tag of your page — ideally near the top, before </body>.',
      'Publish the page. AI crawlers will read it on their next visit.',
      'Repeat for each page you want to optimise (homepage, service pages, blog posts).',
    ],
  }
}

/**
 * WordPress-specific installation guide.
 */
function buildWordPress(html: string): InstallSnippet {
  return {
    platform: 'wordpress',
    html,
    instructions: [
      'In WordPress Admin, go to Appearance → Theme Editor (or use a Code Snippet plugin).',
      'To add to ALL pages: edit your theme\'s footer.php and paste before </body>.',
      'To add to a SINGLE page: edit the page in the Block Editor → add a "Custom HTML" block → paste the snippet.',
      'Alternatively, install the "Insert Headers and Footers" plugin and paste into the Footer Scripts box.',
      'Save changes and visit the page — view source to confirm the block is present.',
    ],
  }
}

/**
 * Webflow-specific installation guide.
 */
function buildWebflow(html: string): InstallSnippet {
  return {
    platform: 'webflow',
    html,
    instructions: [
      'Open your Webflow project in the Designer.',
      'For SITE-WIDE installation: go to Project Settings → Custom Code → paste into "Footer Code".',
      'For a SINGLE PAGE: select the page → Page Settings → Custom Code → paste into "Before </body> tag".',
      'Publish your site. The snippet will appear in the rendered HTML.',
    ],
  }
}
