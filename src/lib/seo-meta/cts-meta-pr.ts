/**
 * CTS meta executor (22.E.S17 · CTS 标题执行手).
 *
 * Gives CTS the same "auto-apply small title fixes" treatment Oztop already
 * enjoys — but through the code-repo channel, since CTS has no WordPress:
 *
 *   1. GSC top_pages: positions 4-20 with impressions ≥ 10 (real CTR upside)
 *   2. Best matching query from top_queries → AI (Haiku) writes a sharper
 *      title + description (NZ China-travel voice, "| CTS" suffix)
 *   3. THE NARROW LANE: edits ONLY title/description string literals inside
 *      src/lib/data/*.ts entries, located via a content-built slug index
 *      (filenames don't track URL slugs, and batch files hold many posts).
 *      Slugs found in no data file are skipped — no TSX logic is ever touched
 *   4. One PR per week (≤ MAX_PAGES_PER_RUN pages), CI must pass, the PM
 *      merges — same human gate as blog publishing (魏征 M2: PR + 人合).
 *   5. seo_meta_log rows drive the 30-day per-slug cooldown and the weekly
 *      report's 自动改动 column.
 *
 * CTS-specific constants live here on purpose: the repo path and meta-file
 * layout are properties of the chinatravel codebase, not FDE-editable
 * config (the FDE-visible switch stays seo_config.weekly_blog).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase'
import { parseJsonResponse } from '@/lib/anthropic/client'
import { getConnection } from '@/lib/cms/connection-store'
import { GithubClient } from '@/lib/cms/github-client'

export const CTS_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const DATA_DIR = 'src/lib/data'
const MAX_PAGES_PER_RUN = 3
const COOLDOWN_DAYS = 30
const MIN_POSITION = 4
const MAX_POSITION = 20
const MIN_IMPRESSIONS = 10

// ── Pure: narrow-lane source editing ────────────────────────────────────────────

function escapeSingle(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

const STRING_LITERAL = /'(?:[^'\\]|\\.)*'/

export interface MetaReplacement {
  updated: string
  oldTitle: string
  oldDesc: string
}

/**
 * Replace the title + description/excerpt literals of the entry whose
 * `slug: '<slug>'` appears in the source. Returns null when the slug isn't
 * in this file, or when the entry lacks either field (caller skips — the
 * executor never guesses).
 *
 * The edit window ends at whichever comes first: the NEXT entry's `slug:`
 * or the next `export const`. Batch files hold many posts inside ONE export,
 * so an export-only boundary would let an entry missing its own excerpt
 * silently overwrite the next post's (魏征-style neighbour corruption).
 */
export function replaceMetaForSlug(
  source: string,
  slug: string,
  newTitle: string,
  newDesc: string,
): MetaReplacement | null {
  const slugIdx = source.indexOf(`slug: '${slug}'`)
  if (slugIdx === -1) return null

  const bounds = [
    source.indexOf("slug: '", slugIdx + 1),
    source.indexOf('\nexport const', slugIdx),
  ].filter((i) => i !== -1)
  const windowEnd = bounds.length > 0 ? Math.min(...bounds) : source.length
  const window = source.slice(slugIdx, windowEnd)

  const titleRe = new RegExp(`(title:\\s*)${STRING_LITERAL.source}`)
  // Hub pages use `description`, blog posts use `excerpt` — both are the
  // rendered meta description in this repo. Detect, don't configure.
  const descField = /(\bdescription:\s*)'/.test(window) ? 'description' : 'excerpt'
  const descRe = new RegExp(`(${descField}:\\s*)${STRING_LITERAL.source}`)

  const titleMatch = window.match(titleRe)
  const descMatch = window.match(descRe)
  if (!titleMatch || !descMatch) return null

  const unquote = (m: string): string =>
    m.replace(/^[^']*'/, '').replace(/'$/, '').replace(/\\'/g, "'").replace(/\\\\/g, '\\')

  const oldTitle = unquote(titleMatch[0].slice(titleMatch[1].length))
  const oldDesc = unquote(descMatch[0].slice(descMatch[1].length))

  let newWindow = window.replace(titleRe, `$1'${escapeSingle(newTitle)}'`)
  newWindow = newWindow.replace(descRe, `$1'${escapeSingle(newDesc)}'`)

  return {
    updated: source.slice(0, slugIdx) + newWindow + source.slice(windowEnd),
    oldTitle,
    oldDesc,
  }
}

/**
 * slug → file path, built by scanning the data files' CONTENT.
 *
 * Filenames do not track URL slugs in this repo: /blog/liziba-station-
 * chongqing-guide lives in blogs-liziba-monorail-guide.ts, and four of CTS's
 * top-opportunity posts sit inside shared batch files (blogs-longtail-batch1
 * .ts etc). Guessing `blogs-<slug>.ts` found 2 of 6 — the first two runs
 * produced no PR for exactly this reason.
 */
export function buildSlugIndex(
  files: Array<{ path: string; source: string }>,
): Map<string, string> {
  const index = new Map<string, string>()
  const slugRe = /slug:\s*'([^']+)'/g
  for (const file of files) {
    let m: RegExpExecArray | null
    while ((m = slugRe.exec(file.source)) !== null) {
      if (!index.has(m[1])) index.set(m[1], file.path)
    }
  }
  return index
}

// ── Pure: GSC candidate picking ─────────────────────────────────────────────────

interface GscPageRow {
  page?: string
  impressions?: number
  position?: number
}
interface GscQueryRow {
  query?: string
  impressions?: number
}

export interface MetaCandidate {
  slug: string
  pageUrl: string
  keyword: string
  impressions: number
  position: number
}

export function pickCandidates(
  topPages: GscPageRow[],
  topQueries: GscQueryRow[],
  cooldownSlugs: Set<string>,
  max: number = MAX_PAGES_PER_RUN,
): MetaCandidate[] {
  const out: MetaCandidate[] = []

  const sorted = [...topPages]
    .filter(
      (p) =>
        p.page &&
        (p.position ?? 0) >= MIN_POSITION &&
        (p.position ?? 0) <= MAX_POSITION &&
        (p.impressions ?? 0) >= MIN_IMPRESSIONS,
    )
    .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))

  for (const page of sorted) {
    if (out.length >= max) break
    // Proper pathname parsing: the homepage ("https://site/") must not yield
    // the hostname as a garbage slug (first run burned a slot on exactly that).
    let slug = ''
    try {
      const path = new URL(page.page!).pathname.replace(/\/+$/, '')
      slug = path.split('/').pop() ?? ''
    } catch {
      continue
    }
    if (!slug || slug.includes('.') || cooldownSlugs.has(slug)) continue

    // Best query = shares the MOST meaningful slug tokens (len > 3), then
    // impressions. Token-count-first stops a generic token like "tours"
    // pulling another page's high-impression query onto this slug.
    const tokens = slug.split('-').filter((t) => t.length > 3)
    const match = topQueries
      .map((q) => ({
        q,
        score: q.query ? tokens.filter((t) => q.query!.toLowerCase().includes(t)).length : 0,
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || (b.q.impressions ?? 0) - (a.q.impressions ?? 0))[0]?.q

    out.push({
      slug,
      pageUrl: page.page!,
      keyword: match?.query ?? slug.replace(/-/g, ' '),
      impressions: page.impressions ?? 0,
      position: page.position ?? 0,
    })
  }
  return out
}

// ── AI meta generation ──────────────────────────────────────────────────────────

async function generateCtsMeta(
  keyword: string,
  pageUrl: string,
): Promise<{ title: string; desc: string }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    // 300 gives headroom for title (≤60 chars) + desc (≤155 chars) + JSON
    // wrapper tokens. 200 was occasionally truncating the response mid-JSON,
    // causing JSON.parse to throw and silently returning desc:''.
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: `You are an SEO specialist for a New Zealand-based China travel agency (Auckland, serving Kiwi travellers).

Target keyword: "${keyword}"
Page URL: ${pageUrl}

Rules:
- Title: max 60 chars, keyword near the start, mention New Zealand/NZ where natural, end "| CTS" if space allows
- Description: max 155 chars, include the keyword + a clear call to action, NZ English
- Factual tone — do NOT invent prices, dates or itinerary details
- No quotes inside the text

Respond ONLY with valid JSON: {"title":"...","desc":"..."}`,
      },
    ],
  })
  const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '{}'
  try {
    // parseJsonResponse handles markdown code-fence wrapping (```json...```)
    // and LLM quirks (trailing commas, unescaped quotes) via jsonrepair —
    // plain JSON.parse was the root cause of consistent ai_generation_failed
    // when the model wrapped its output in code fences (#1792).
    const p = parseJsonResponse<{ title?: string; desc?: string }>(text)
    return {
      title: (p.title ?? keyword).slice(0, 60),
      desc: (p.desc ?? '').slice(0, 155),
    }
  } catch {
    return { title: keyword.slice(0, 60), desc: '' }
  }
}

// ── Runner ──────────────────────────────────────────────────────────────────────

export interface CtsMetaPrResult {
  outcome: 'pr_opened' | 'no_candidates' | 'no_connection' | 'nothing_editable' | 'error'
  pr_url?: string
  pages?: Array<{ slug: string; keyword: string }>
  /** Per-candidate audit trail (slug → which step it stopped at). */
  attempts?: Array<{ slug: string; step: string }>
  error?: string
}

export async function runCtsMetaPr(
  supabase: SupabaseClient = supabaseAdmin,
): Promise<CtsMetaPrResult> {
  try {
    // 1. Cooldown + GSC signals
    const cutoff = new Date(Date.now() - COOLDOWN_DAYS * 86_400_000).toISOString()
    const [{ data: recent }, { data: gsc }] = await Promise.all([
      supabase
        .from('seo_meta_log')
        .select('page_slug')
        .eq('client_id', CTS_CLIENT_ID)
        .gte('optimised_at', cutoff),
      supabase
        .from('gsc_performance_snapshots')
        .select('top_pages, top_queries')
        .eq('client_id', CTS_CLIENT_ID)
        .order('period_end', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const cooldown = new Set(((recent ?? []) as Array<{ page_slug: string }>).map((r) => r.page_slug))
    const snapshot = gsc as { top_pages?: GscPageRow[]; top_queries?: GscQueryRow[] } | null
    // Wide pool: selection must not stop at MAX_PAGES_PER_RUN — a candidate
    // whose meta lives outside our lanes gets SKIPPED, and the next one takes
    // its slot (first run burned all 3 slots on 2 un-editable pages).
    const candidates = pickCandidates(
      snapshot?.top_pages ?? [],
      snapshot?.top_queries ?? [],
      cooldown,
      12,
    )
    if (candidates.length === 0) return { outcome: 'no_candidates' }

    // 2. Repo connection + meta source file
    const conn = await getConnection(CTS_CLIENT_ID)
    if (!conn || !('repoOwner' in conn)) return { outcome: 'no_connection' }
    const { repoOwner, repoName, branch, plainToken } = conn as unknown as {
      repoOwner: string
      repoName: string
      branch: string
      plainToken: string
    }
    const defaultBranch = branch || 'main'
    const github = new GithubClient(plainToken)

    // 3. Build the slug → file index by READING the data files, never by
    //    guessing filenames (filenames don't track URL slugs here, and batch
    //    files hold many posts each — see buildSlugIndex).
    const dir = await github
      .listDirectory(repoOwner, repoName, DATA_DIR, defaultBranch)
      .catch(() => [])
    const dataFiles = dir.filter(
      (e) => e.type === 'file' && /^(seo-pages|blogs).*\.ts$/.test(e.name),
    )

    const fileCache = new Map<string, { source: string; sha: string; dirty: boolean }>()
    for (const entry of dataFiles) {
      const f = await github
        .getFileContent(repoOwner, repoName, entry.path, defaultBranch)
        .catch(() => null)
      if (f) fileCache.set(entry.path, { source: f.decodedContent, sha: f.sha, dirty: false })
    }
    const slugIndex = buildSlugIndex(
      Array.from(fileCache.entries()).map(([path, v]) => ({ path, source: v.source })),
    )

    const applied: Array<{
      candidate: MetaCandidate
      newTitle: string
      newDesc: string
      oldTitle: string
      oldDesc: string
    }> = []

    // Per-candidate audit trail → cron summary, so the next "why no PR?"
    // is answerable from the DB in one query instead of a debugging session.
    const attempts: Array<{ slug: string; step: string }> = []

    for (const candidate of candidates) {
      if (applied.length >= MAX_PAGES_PER_RUN) break
      const path = slugIndex.get(candidate.slug)
      const entry = path ? fileCache.get(path) : undefined
      if (!entry) {
        attempts.push({ slug: candidate.slug, step: 'slug_not_in_any_data_file' })
        continue
      }

      const meta = await generateCtsMeta(candidate.keyword, candidate.pageUrl)
      if (!meta.desc) {
        attempts.push({ slug: candidate.slug, step: 'ai_generation_failed' })
        continue
      }

      const replaced = replaceMetaForSlug(
        entry.source,
        candidate.slug,
        meta.title,
        meta.desc,
      )
      if (!replaced) {
        attempts.push({ slug: candidate.slug, step: 'slug_not_in_file' })
        continue
      }
      entry.source = replaced.updated
      entry.dirty = true
      attempts.push({ slug: candidate.slug, step: 'applied' })
      applied.push({
        candidate,
        newTitle: meta.title,
        newDesc: meta.desc,
        oldTitle: replaced.oldTitle,
        oldDesc: replaced.oldDesc,
      })
    }
    if (applied.length === 0) return { outcome: 'nothing_editable', attempts }

    // 4. Branch + one commit per touched file + PR (CI gate + human merge)
    const day = new Date().toISOString().slice(0, 10)
    const prBranch = `feat/me-seo-meta-${day}`
    const baseSha = await github.getBranchSha(repoOwner, repoName, defaultBranch)
    await github.createBranch(repoOwner, repoName, prBranch, baseSha)
    for (const [path, entry] of Array.from(fileCache.entries())) {
      if (!entry.dirty) continue
      await github.commitFile(
        repoOwner,
        repoName,
        path,
        prBranch,
        entry.source,
        `seo: refresh meta for ${path.split('/').pop()} [Magic Engine]`,
        entry.sha,
      )
    }

    const body = applied
      .map(
        (a) =>
          `### /${a.candidate.slug}\n目标词:「${a.candidate.keyword}」(排名 #${a.candidate.position}, 曝光 ${a.candidate.impressions})\n- 标题: ${a.oldTitle}\n- → **${a.newTitle}**\n- 描述: ${a.oldDesc.slice(0, 80)}…\n- → **${a.newDesc}**`,
      )
      .join('\n\n')

    const pr = await github.createPullRequest(repoOwner, repoName, {
      title: `[Magic Engine] SEO 标题优化 ×${applied.length}`,
      body: `${body}\n\n> 巡逻发现这些页面排名在 4-20 名但标题点击力不足。只改了 meta 数据文件里的标题/摘要字符串（blog 的标题和摘要同时是页面可见文案，正是点击力要改的东西）。构建检查通过后合并即生效。`,
      head: prBranch,
      base: defaultBranch,
    })

    // 5. Audit log (drives cooldown + weekly report 自动改动 column)
    const rows = applied.map((a) => ({
      client_id: CTS_CLIENT_ID,
      content_type: 'meta',
      page_slug: a.candidate.slug,
      page_url: a.candidate.pageUrl,
      keyword: a.candidate.keyword,
      old_title: a.oldTitle,
      old_desc: a.oldDesc,
      new_title: a.newTitle,
      new_desc: a.newDesc,
      wp_updated: false,
      optimised_at: new Date().toISOString(),
    }))
    const { error: logErr } = await supabase.from('seo_meta_log').insert(rows)
    if (logErr) console.error('[cts-meta-pr] log insert failed:', logErr.message)

    return {
      outcome: 'pr_opened',
      pr_url: pr.html_url ?? undefined,
      pages: applied.map((a) => ({ slug: a.candidate.slug, keyword: a.candidate.keyword })),
      attempts,
    }
  } catch (err) {
    return { outcome: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}
