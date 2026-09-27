// Shared guards for the free website check (Tools Lab step 2):
// visitor keys, atomic quotas, safe homepage fetch, "is this a real page" checks, HTML escaping.
// Design: docs/specs/2026-09-27-tools-lab-step2-site-diagnosis-design.md §6.
// No route handlers are exported, so Cloudflare Pages does not serve this file as an endpoint.

export const LIMITS = {
  checkPerVisitorPerDay: 3,
  checkPerMonth: 1500,
  reportPerVisitorPerDay: 5,
};

export const MAX_URL_CHARS = 500;
export const MAX_FIELD_CHARS = 200;
const MAX_PAGE_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const MIN_TEXT_CHARS = 300;

const ALLOWED_ORIGINS = [/^https:\/\/magicengine\.com\.au$/, /^https:\/\/www\.magicengine\.com\.au$/, /^https:\/\/[a-z0-9-]+\.magic-engine\.pages\.dev$/];

export class QuotaUnavailable extends Error {}

/** Only the official site and its Cloudflare previews may call the paid endpoints. */
export function isAllowedOrigin(request) {
  const origin = request.headers.get('origin') || '';
  return ALLOWED_ORIGINS.some((re) => re.test(origin));
}

export function dayStartUtc(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export function monthStartUtc(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function ipv6Prefix64(ip) {
  const parts = ip.split('::');
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length > 1 && parts[1] ? parts[1].split(':') : [];
  const full = [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail];
  return full.slice(0, 4).map((h) => h.toLowerCase().padStart(4, '0')).join(':');
}

async function hmacHex(keyMaterial, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(keyMaterial), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * One-way, day-scoped visitor key from Cloudflare's own client address (visitors cannot set it).
 * IPv6 is keyed by its /64. The raw address is never stored. Returns null when no address is available.
 */
export async function visitorKey(request, env, now = new Date()) {
  const ip = (request.headers.get('cf-connecting-ip') || '').trim();
  if (!ip || !env.SUPABASE_SERVICE_KEY) return null;
  const subject = ip.includes(':') ? `v6:${ipv6Prefix64(ip)}` : `v4:${ip}`;
  // Key material derived from an existing server secret with a fixed label (no new environment variable).
  const material = await hmacHex(env.SUPABASE_SERVICE_KEY, 'site-check-visitor-key-v1');
  return hmacHex(material, `${dayStartUtc(now).slice(0, 10)}|${subject}`);
}

/**
 * Atomic check-and-consume through the existing database function (zhangqian_rate_limit_consume).
 * Returns true when allowed. Any failure throws QuotaUnavailable: callers refuse rather than allow.
 */
export async function consumeQuota(env, bucketType, bucketKey, windowStart, cap) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) throw new QuotaUnavailable('quota store not configured');
  let res;
  try {
    res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/zhangqian_rate_limit_consume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ p_bucket_type: bucketType, p_bucket_key: bucketKey, p_window_start: windowStart, p_cap: cap }),
    });
  } catch (err) {
    throw new QuotaUnavailable(String(err));
  }
  if (!res.ok) throw new QuotaUnavailable(`quota store ${res.status}`);
  const rows = await res.json().catch(() => null);
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row || typeof row.allowed !== 'boolean') throw new QuotaUnavailable('quota store returned no decision');
  return row.allowed;
}

/** Best-effort removal of visitor-key rows older than two days (privacy: keys are kept at most 2 days). */
export async function pruneOldVisitorKeys(env, now = new Date()) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return;
  const cutoff = new Date(Date.parse(dayStartUtc(now)) - 2 * 86_400_000).toISOString();
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/zhangqian_scan_rate_limits?bucket_type=in.(site_check_ip,site_report_ip)&window_start=lt.${encodeURIComponent(cutoff)}`, {
      method: 'DELETE',
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, Prefer: 'return=minimal' },
    });
  } catch { /* best effort */ }
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Registrable-ish site identity: hostname without a leading www. */
export function siteHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '');
}

/** Parse and vet a visitor-supplied address. Returns a URL or null. */
export function vetUrl(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw || raw.length > MAX_URL_CHARS) return null;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.port && url.port !== '80' && url.port !== '443') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.startsWith('[') || host.endsWith('.local') || host.endsWith('.internal') || host === 'localhost') return null;
  return url;
}

const TITLE_CHALLENGE = [/robot\s+challenge\s+screen/i, /siteground.{0,20}security/i, /just\s+a\s+moment\.\.\./i, /wordfence/i, /sucuri.{0,40}firewall/i];
const TITLE_GENERIC = [/^attention\s+required/i, /access\s+denied/i, /security\s+check/i];
const BODY_CHALLENGE = [/sg[-_]?captcha/i, /\bsgs[-_]?block\b/i, /checking\s+the\s+site\s+connection\s+security/i, /cf[-_]chl[-_](?:jschl|opt)/i, /enable\s+javascript\s+and\s+cookies\s+to\s+continue/i, /generated\s+by\s+wordfence/i, /sucuri\s+website\s+firewall/i];

/** Mirrors src/lib/site-audit/antibot-detector.ts: firewall / challenge pages are not the site. */
export function looksLikeChallenge(title, text, rawHtml) {
  const t = String(title || '').trim();
  if (TITLE_CHALLENGE.some((re) => re.test(t))) return true;
  if (TITLE_GENERIC.some((re) => re.test(t)) && String(text || '').trim().length <= 200) return true;
  const scan = String(rawHtml || '').slice(0, 8192);
  return BODY_CHALLENGE.some((re) => re.test(scan));
}

export function extractTitle(html) {
  const m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

export function extractText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function readCapped(res) {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  while (size < MAX_PAGE_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  try { await reader.cancel(); } catch { /* ignore */ }
  const all = new Uint8Array(Math.min(size, MAX_PAGE_BYTES));
  let offset = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, all.length - offset);
    all.set(c.subarray(0, take), offset);
    offset += take;
    if (offset >= all.length) break;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(all);
}

/**
 * Fetch the homepage only if it is a real, readable page of the same site.
 * Returns { ok: true, text, title, finalUrl } or { ok: false, reason } where reason is one of
 * 'invalid_url' | 'unreachable' | 'not_html' | 'challenge' | 'too_little_text' | 'redirected_away'.
 */
export async function fetchRealHomepage(input, { fetchImpl = fetch, timeoutMs = 12000 } = {}) {
  let url = vetUrl(input);
  if (!url) return { ok: false, reason: 'invalid_url' };
  const startHost = siteHost(url.hostname);
  let res;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    try {
      res = await fetchImpl(url.toString(), {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': 'MagicEngineSiteCheck/1.0 (+https://magicengine.com.au/cn/lab/)', Accept: 'text/html' },
      });
    } catch {
      return { ok: false, reason: 'unreachable' };
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      const nextUrl = next ? vetUrl(new URL(next, url).toString()) : null;
      if (!nextUrl) return { ok: false, reason: 'unreachable' };
      if (siteHost(nextUrl.hostname) !== startHost) return { ok: false, reason: 'redirected_away' };
      url = nextUrl;
      continue;
    }
    break;
  }
  if (!res || res.status < 200 || res.status >= 300) return { ok: false, reason: 'unreachable' };
  const type = res.headers.get('content-type') || '';
  if (!/text\/html|application\/xhtml\+xml/i.test(type)) return { ok: false, reason: 'not_html' };
  const html = await readCapped(res);
  const title = extractTitle(html);
  const text = extractText(html);
  if (looksLikeChallenge(title, text, html)) return { ok: false, reason: 'challenge' };
  if (text.length < MIN_TEXT_CHARS) return { ok: false, reason: 'too_little_text' };
  return { ok: true, text: text.slice(0, 8000), title, finalUrl: url.toString() };
}
