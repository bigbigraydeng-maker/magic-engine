/**
 * Blog HTML Builder
 *
 * Assembles the copyable HTML package from generator output:
 *   1. Article JSON-LD Schema (for Google rich results)
 *   2. Article body HTML
 *   3. GEO hidden directive block (for AI crawlers)
 *
 * The output is "paste-ready" for WordPress / Webflow / any CMS.
 *
 * Reference: ROADMAP.md P7.3.5, ARCHITECTURE.md §13.4
 */

import type { BlogPost } from '@/types/magic-engine'

export interface BuiltBlogHtml {
  /** Full copyable HTML (schema + body + GEO block) */
  full_html: string
  /** Body only — for CMS paste without schema */
  body_only: string
  /** Article JSON-LD string */
  schema_json_str: string
}

type BlogBodyPost = Pick<BlogPost, 'html_body' | 'geo_html_snapshot' | 'featured_image_url' | 'title'>

/**
 * Assemble the complete HTML package for a blog post.
 */
export function buildBlogHtml(post: BlogPost, siteUrl = ''): BuiltBlogHtml {
  const schema = buildArticleSchema(post, siteUrl)
  const schemaStr = JSON.stringify(schema, null, 2)

  const schemaBlock = `<script type="application/ld+json">\n${schemaStr}\n</script>`

  const bodyOnly = buildBlogBodyHtml(post)

  const fullHtml = [schemaBlock, '', bodyOnly]
    .filter(Boolean)
    .join('\n\n')

  return { full_html: fullHtml, body_only: bodyOnly, schema_json_str: schemaStr }
}

export function buildBlogBodyHtml(post: BlogBodyPost): string {
  const parts = [
    buildHeroFigure(post),
    post.html_body,
    post.geo_html_snapshot ?? '',
  ]

  return parts.filter(Boolean).join('\n\n')
}

function buildHeroFigure(post: BlogBodyPost): string {
  if (!post.featured_image_url) return ''

  const src = escapeHtmlAttribute(post.featured_image_url)
  const alt = escapeHtmlAttribute(post.title || 'Blog hero image')

  return [
    '<figure class="me-blog-hero">',
    `  <img src="${src}" alt="${alt}" loading="lazy" />`,
    '</figure>',
  ].join('\n')
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * P14.C.4 — Build the <script type="application/ld+json"> block for a blog post.
 * Used by all publish routes (WP / Shopify / GitHub) so every published page
 * carries the BlogPosting schema for Google rich-results eligibility.
 *
 * Returns an empty string when minimum data is missing rather than throwing,
 * so publishing never breaks because of metadata gaps.
 */
export function buildArticleSchemaScript(
  post: ArticleSchemaPost,
  siteUrl: string,
  publisherName?: string,
): string {
  if (!post.title && !post.meta_title) return ''

  const url = siteUrl && post.slug ? joinUrl(siteUrl, `/blog/${post.slug}`) : undefined
  const schema: Record<string, unknown> = {
    '@context':     'https://schema.org',
    '@type':        'BlogPosting',
    'headline':     post.meta_title || post.title,
    'description':  post.meta_description ?? undefined,
    'url':          url,
    'image':        post.featured_image_url ?? undefined,
    'datePublished': post.published_at ?? post.created_at,
    'dateModified': post.updated_at,
  }

  if (publisherName) {
    schema.author    = { '@type': 'Organization', 'name': publisherName }
    schema.publisher = { '@type': 'Organization', 'name': publisherName }
  }

  // Drop undefined fields so the JSON-LD output stays clean.
  const clean = Object.fromEntries(
    Object.entries(schema).filter(([, v]) => v !== undefined),
  )

  return `<script type="application/ld+json">\n${JSON.stringify(clean, null, 2)}\n</script>`
}

export type ArticleSchemaPost = Pick<
  BlogPost,
  | 'title'
  | 'meta_title'
  | 'meta_description'
  | 'slug'
  | 'featured_image_url'
  | 'published_at'
  | 'created_at'
  | 'updated_at'
>

function joinUrl(base: string, path: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base
  const p = path.startsWith('/') ? path : `/${path}`
  return b + p
}

/**
 * Build Article JSON-LD schema for SEO rich results.
 */
function buildArticleSchema(
  post: BlogPost,
  siteUrl: string
): Record<string, unknown> {
  const url = siteUrl && post.slug ? `${siteUrl}/blog/${post.slug}` : undefined

  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    'headline': post.meta_title || post.title,
    'description': post.meta_description,
    'url': url,
    'image': post.featured_image_url ?? undefined,
    'datePublished': post.published_at ?? post.created_at,
    'dateModified': post.updated_at,
    'author': {
      '@type': 'Organization',
      'name': undefined,   // filled by the CMS / client
    },
    'publisher': {
      '@type': 'Organization',
      'name': undefined,
    },
  }
}

/**
 * GEO checklist — computed from a blog post.
 * Returns the 4 checks used in the blog viewer UI.
 */
export interface GeoCheck {
  key: string
  label: string
  pass: boolean
  detail?: string
}

export function computeGeoChecklist(post: BlogPost, brandName: string): GeoCheck[] {
  const bodyText = post.html_body.replace(/<[^>]+>/g, ' ')
  const brandMentions = countOccurrences(bodyText, brandName)
  const hasH1 = /<h1[\s>]/i.test(post.html_body)
  const hasFaq = /class=["']faq|<section[^>]*faq|<h[23][^>]*>.*?FAQ/i.test(post.html_body)

  return [
    {
      key: 'geo_block',
      label: 'GEO directive injected',
      pass: !!post.geo_html_snapshot,
      detail: post.geo_html_snapshot ? 'Hidden AI instruction block present' : 'No active GEO directive — activate one in GEO Composer',
    },
    {
      key: 'brand_mentions',
      label: `Brand mentioned ≥3×`,
      pass: brandMentions >= 3,
      detail: `"${brandName}" appears ${brandMentions} time${brandMentions !== 1 ? 's' : ''} in body text`,
    },
    {
      key: 'h1_present',
      label: 'H1 heading present',
      pass: hasH1,
      detail: hasH1 ? 'Article has an H1 heading' : 'Missing H1 — add one for AI snippet extraction',
    },
    {
      key: 'word_count',
      label: 'Word count ≥600',
      pass: (post.word_count ?? 0) >= 600,
      detail: `${post.word_count ?? 0} words`,
    },
    {
      key: 'faq_section',
      label: 'FAQ section present',
      pass: hasFaq,
      detail: hasFaq ? 'FAQ helps AI extract Q&A pairs' : 'Consider adding a FAQ section',
    },
    {
      key: 'meta_title',
      label: 'Meta title ≤60 chars',
      pass: post.meta_title.length > 0 && post.meta_title.length <= 60,
      detail: `${post.meta_title.length} chars`,
    },
    {
      key: 'meta_description',
      label: 'Meta description ≤155 chars',
      pass: post.meta_description.length > 0 && post.meta_description.length <= 155,
      detail: `${post.meta_description.length} chars`,
    },
  ]
}

function countOccurrences(text: string, term: string): number {
  if (!term) return 0
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return (text.match(new RegExp(escaped, 'gi')) ?? []).length
}
