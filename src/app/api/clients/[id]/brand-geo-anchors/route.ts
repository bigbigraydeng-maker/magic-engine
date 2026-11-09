/**
 * Brand geo anchors — single write entry for clients.brand_geo_anchors.
 *
 * GET   → returns the persisted FDE list.
 * PATCH → replaces it. All inputs normalised before persistence.
 *
 * Consumed by `src/lib/ai-tracker/client-brand-match.ts >
 * admissibleClientIdentifiers`: when the list is non-empty, evidence that
 * comes ONLY from a brand alias requires one of these words to appear in the
 * AI answer, so a same-named sibling abroad ("China Travel Service
 * (Australia) Pty Ltd") cannot claim a NZ-only client. The official brand
 * name and clients.domain are never gated.
 *
 * Mirrors src/app/api/clients/[id]/brand-aliases/route.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { normalizeForMatch } from '@/lib/ai-tracker/client-brand-match'

const MAX_ANCHORS   = 20
const MIN_ANCHOR_LEN = 2
/**
 * CJK anchors need 3+ characters. The matcher has no word boundaries to pin a
 * CJK string to (MIN_CJK_EVIDENCE_LEN in client-brand-match.ts), so a shorter
 * one would store fine, display fine, and then match nothing — silently
 * closing the gate on every answer for that client. Reject it at the door.
 */
const MIN_CJK_ANCHOR_LEN = 3
const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/

/**
 * Words that are not places. Each of these appears in ordinary prose or in
 * company suffixes often enough that using one as an anchor would leave the
 * gate permanently open while looking configured.
 *
 * Country codes like "nz" / "au" are deliberately NOT here: they are the
 * whole point of the feature. The reason they used to be unsafe — every
 * ".com.au" link handing over an "au" — is fixed in the matcher, which strips
 * links and hostnames before looking for an anchor.
 */
const NON_PLACE_ANCHORS = new Set([
  'com', 'co', 'net', 'org', 'edu', 'gov', 'govt', 'ac', 'io', 'info', 'biz',
  'www', 'http', 'https', 'ltd', 'limited', 'pty', 'inc', 'llc', 'group',
  'the', 'and', 'tours', 'travel',
])

interface PatchBody {
  anchors?: unknown
}

/**
 * Same normalisation the matcher applies at match time
 * (`client-brand-match.ts > normalizeForMatch`) — strips punctuation, not
 * just whitespace. Validating a looser form here (e.g. lowercase-only) would
 * let a value like "travel." or "the," through the `NON_PLACE_ANCHORS`
 * check, only for the matcher to later strip the trailing punctuation and
 * silently turn it back into a rejected word ("travel", "the") — the reject
 * list would look enforced while doing nothing.
 */
function normaliseAnchor(raw: string): string {
  return normalizeForMatch(raw)
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('brand_geo_anchors')
    .eq('id', clientId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const raw = (data as { brand_geo_anchors: unknown }).brand_geo_anchors
  const anchors = Array.isArray(raw)
    ? raw.filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
    : []

  return NextResponse.json({ anchors })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.anchors)) {
    return NextResponse.json(
      { error: 'Body must include `anchors: string[]`' },
      { status: 400 },
    )
  }

  const seen = new Set<string>()
  const cleaned: string[] = []
  for (const raw of body.anchors) {
    if (typeof raw !== 'string') continue
    const norm = normaliseAnchor(raw)
    if (norm.length < MIN_ANCHOR_LEN) continue
    if (CJK_RE.test(norm) && norm.length < MIN_CJK_ANCHOR_LEN) {
      return NextResponse.json(
        {
          error:
            `地域锚点「${norm}」太短：中日韩地名至少要 ${MIN_CJK_ANCHOR_LEN} 个字，` +
            '否则永远匹配不到文本，会把这个客户所有靠别名认出来的提及全部砍掉。',
        },
        { status: 400 },
      )
    }
    if (NON_PLACE_ANCHORS.has(norm)) {
      return NextResponse.json(
        {
          error:
            `「${norm}」不是地名，不能当地域锚点：它在普通句子和公司后缀里到处都是，` +
            '填了等于这道闸门看着开着、其实永远放行。请填客户真正所在的国家 / 地区 / 城市。',
        },
        { status: 400 },
      )
    }
    if (seen.has(norm)) continue
    if (cleaned.length >= MAX_ANCHORS) break
    seen.add(norm)
    cleaned.push(norm)
  }

  // Persist NULL when empty so the matcher reads it as "rule disabled"
  // (migration comment: NULL or empty array leaves matching unchanged).
  const { error: updateErr } = await supabaseAdmin
    .from('clients')
    .update({ brand_geo_anchors: cleaned.length === 0 ? null : cleaned })
    .eq('id', clientId)

  if (updateErr) {
    return NextResponse.json(
      { error: `Failed to update brand_geo_anchors: ${updateErr.message}` },
      { status: 500 },
    )
  }

  try {
    revalidatePath(`/dashboard/clients/${clientId}/settings`)
  } catch {
    // best-effort during dev / non-Next runtime
  }

  return NextResponse.json({
    success:  true,
    anchors:  cleaned,
    count:    cleaned.length,
    warnings: await buildWarnings(clientId, cleaned),
  })
}

/**
 * Non-blocking advice, shown next to the save confirmation.
 *
 * The gate is applied to the answer as written. A client whose aliases are in
 * Chinese will be recognised in Chinese answers — and a Chinese answer often
 * writes the country in Chinese too, so an anchor list that is English-only
 * would reject those answers with nothing to show for it. Today that costs
 * CTS almost nothing, but only because most of its Chinese answers happen to
 * also say "New Zealand" in English. That is luck, not design.
 */
async function buildWarnings(clientId: string, anchors: string[]): Promise<string[]> {
  if (anchors.length === 0) return []
  const { data } = await supabaseAdmin
    .from('clients')
    .select('brand_aliases')
    .eq('id', clientId)
    .single()

  const aliases = (data as { brand_aliases: unknown } | null)?.brand_aliases
  if (!Array.isArray(aliases)) return []

  const warnings: string[] = []
  const aliasHasCjk = aliases.some(a => typeof a === 'string' && CJK_RE.test(a))
  const anchorHasCjk = anchors.some(a => CJK_RE.test(a))
  if (aliasHasCjk && !anchorHasCjk) {
    warnings.push(
      '这个客户配了中文别名，但地域锚点全是英文。' +
        '中文回答里如果只写「新西兰」不写 “New Zealand”，靠中文别名认出来的提及会被判成「没提到」。' +
        '建议把中文地名也加进来。',
    )
  }
  return warnings
}
