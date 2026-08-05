export const MANAGED_CONTENT_START = '<!-- ME:PAGE-CONTENT:START -->'
export const MANAGED_CONTENT_END = '<!-- ME:PAGE-CONTENT:END -->'

export type StaticHtmlPathResult =
  | { ok: true; filePath: string }
  | { ok: false; reason: string }

export type StaticHtmlPatchResult =
  | {
      ok: true
      content: string
      updatedFields: string[]
      bodyApplied: boolean
    }
  | { ok: false; reason: string }

export interface StaticHtmlUpgrade {
  metaTitle: string
  metaDescription: string
  htmlBody?: string
}

export function resolveStaticHtmlPath(
  pageUrl: string,
  configuredPaths: string[],
): StaticHtmlPathResult {
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(pageUrl).pathname)
  } catch {
    return { ok: false, reason: 'Invalid page URL.' }
  }

  const safePaths = configuredPaths
    .map(path => path.trim().replace(/^\/+/, ''))
    .filter(path => path.length > 0 && /\.html?$/i.test(path) && !path.split('/').includes('..'))

  if (safePaths.length === 0) {
    return {
      ok: false,
      reason: 'No HTML page paths are configured for this GitHub connection.',
    }
  }

  const slugPath = pathname.replace(/^\/+|\/+$/g, '')
  const suffixes = slugPath
    ? [`${slugPath}.html`, `${slugPath}.htm`, `${slugPath}/index.html`, `${slugPath}/index.htm`]
    : ['index.html', 'index.htm']

  const matches = safePaths.filter(path =>
    suffixes.some(suffix => path === suffix || path.endsWith(`/${suffix}`)),
  )

  if (matches.length === 1) return { ok: true, filePath: matches[0] }
  if (matches.length === 0) {
    return {
      ok: false,
      reason: `No configured HTML file matches URL path "${pathname}". Add the page file in Settings → 网站连接.`,
    }
  }
  return {
    ok: false,
    reason: `More than one configured HTML file matches URL path "${pathname}". Keep one unambiguous target.`,
  }
}

export function patchStaticHtmlPage(
  source: string,
  upgrade: StaticHtmlUpgrade,
): StaticHtmlPatchResult {
  if (!/<html\b/i.test(source) || !/<head\b/i.test(source)) {
    return { ok: false, reason: 'Target file is not a complete HTML document.' }
  }

  let content = source
  const updatedFields: string[] = []

  const titleResult = replaceTitle(content, upgrade.metaTitle)
  if ('reason' in titleResult) return { ok: false, reason: titleResult.reason }
  content = titleResult.content
  if (titleResult.changed) updatedFields.push('meta_title')

  const descriptionResult = replaceMetaDescription(content, upgrade.metaDescription)
  if ('reason' in descriptionResult) return { ok: false, reason: descriptionResult.reason }
  content = descriptionResult.content
  if (descriptionResult.changed) updatedFields.push('meta_description')

  let bodyApplied = false
  if (upgrade.htmlBody) {
    const start = content.indexOf(MANAGED_CONTENT_START)
    const end = content.indexOf(MANAGED_CONTENT_END)
    if ((start === -1) !== (end === -1)) {
      return { ok: false, reason: 'Managed content markers are incomplete; refusing to patch body.' }
    }
    if (start !== -1 && end > start) {
      const bodyStart = start + MANAGED_CONTENT_START.length
      const currentBody = content.slice(bodyStart, end).trim()
      const nextBody = upgrade.htmlBody.trim()
      if (currentBody !== nextBody) {
        const before = content.slice(0, bodyStart)
        const after = content.slice(end)
        content = `${before}\n${nextBody}\n${after}`
        bodyApplied = true
        updatedFields.push('content_html')
      }
    }
  }

  if (content === source) {
    return { ok: false, reason: 'The generated upgrade does not change the configured HTML file.' }
  }

  return { ok: true, content, updatedFields: Array.from(new Set(updatedFields)), bodyApplied }
}

type ReplaceResult =
  | { ok: true; content: string; changed: boolean }
  | { ok: false; reason: string }

function replaceTitle(source: string, newTitle: string): ReplaceResult {
  const pattern = /(<title\b[^>]*>)([\s\S]*?)(<\/title\s*>)/i
  const match = pattern.exec(source)
  if (!match) return { ok: false, reason: 'Target HTML has no <title> element.' }
  const escaped = escapeHtml(newTitle.trim())
  if (match[2] === escaped) return { ok: true, content: source, changed: false }
  return {
    ok: true,
    content: source.replace(pattern, (_full, open: string, _old: string, close: string) => `${open}${escaped}${close}`),
    changed: true,
  }
}

function replaceMetaDescription(source: string, newDescription: string): ReplaceResult {
  const tagPattern = /<meta\b[^>]*>/gi
  const tags = source.match(tagPattern) ?? []
  const descriptionTag = tags.find(tag => /\bname\s*=\s*(['"])description\1/i.test(tag))
  const escaped = escapeAttribute(newDescription.trim())

  if (!descriptionTag) {
    const headClose = /<\/head\s*>/i
    if (!headClose.test(source)) return { ok: false, reason: 'Target HTML has no closing </head> tag.' }
    return {
      ok: true,
      content: source.replace(headClose, `  <meta name="description" content="${escaped}">\n</head>`),
      changed: true,
    }
  }

  const contentAttr = /\bcontent\s*=\s*(['"])([\s\S]*?)\1/i
  const current = contentAttr.exec(descriptionTag)
  let nextTag: string
  if (current) {
    if (current[2] === escaped) return { ok: true, content: source, changed: false }
    nextTag = descriptionTag.replace(contentAttr, `content="${escaped}"`)
  } else {
    nextTag = descriptionTag.replace(/\s*\/?\s*>$/, ` content="${escaped}">`)
  }
  return { ok: true, content: source.replace(descriptionTag, nextTag), changed: true }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;')
}
