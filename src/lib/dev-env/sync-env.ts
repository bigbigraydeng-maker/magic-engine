import { readFile, writeFile, chmod, rename, readdir, unlink, realpath } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';

/** A single environment variable as returned by the Render API. */
export interface RenderEnvVar {
  key: string;
  value: string;
}

/** Default Render service id used when none is provided. */
export const DEFAULT_RENDER_SERVICE_ID = 'srv-d79s6d95pdvs73boptcg';

/** Default key prefixes that are considered safe to sync locally. */
export const DEFAULT_PREFIXES: readonly string[] = ['META_SYSTEM_USER_TOKEN_'];

/** Valid environment variable key shape. */
const KEY_PATTERN = /^[A-Z0-9_]+$/;

/** Every whitelist prefix must start with this root: the tool exists for Meta tokens only. */
export const ALLOWED_PREFIX_ROOT = 'META_SYSTEM_USER_TOKEN_';

/**
 * A value is only written when it is a single plain line: no control characters (newline injection
 * would create new variables), no quotes and no backslashes (they would need escaping that
 * other dotenv readers disagree about).
 */
const UNSAFE_VALUE_PATTERN = /[\u0000-\u001f\u007f"\\]/;

/** Throws when a prefix could widen the whitelist beyond Meta tokens (e.g. '' or 'DATABASE_'). */
export function assertSafePrefixes(prefixes: readonly string[]): void {
  if (prefixes.length === 0) throw new Error('at least one prefix is required');
  for (const p of prefixes) {
    if (typeof p !== 'string' || !p.startsWith(ALLOWED_PREFIX_ROOT)) {
      throw new Error(`prefix must start with ${ALLOWED_PREFIX_ROOT}`);
    }
  }
}

/** Matches a dotenv-style assignment line (optionally prefixed with `export`). */
const ASSIGNMENT_PATTERN = /^\s*(export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*?)\r?$/;

/** Values matching this pattern can be written unquoted. */
const SAFE_VALUE_PATTERN = /^[A-Za-z0-9_.\-+/=:@]+$/;

/** Maximum number of pages to fetch from the Render API. */
const MAX_PAGES = 20;

/** Page size requested from the Render API. */
const PAGE_LIMIT = 100;

/** Number of backups to keep on disk. */
const MAX_BACKUPS = 3;

/**
 * Keep only variables whose key starts with one of the given prefixes,
 * whose key matches the allowed shape, and whose value is a non-empty string.
 * Duplicates are collapsed with the last occurrence winning.
 */
export function selectWhitelisted(
  vars: RenderEnvVar[],
  prefixes: readonly string[],
): RenderEnvVar[] {
  const byKey = new Map<string, RenderEnvVar>();
  for (const v of vars) {
    if (typeof v.key !== 'string' || typeof v.value !== 'string') continue;
    if (!KEY_PATTERN.test(v.key)) continue;
    if (v.value.length === 0 || UNSAFE_VALUE_PATTERN.test(v.value)) continue;
    if (!prefixes.some((p) => v.key.startsWith(p))) continue;
    byKey.set(v.key, { key: v.key, value: v.value });
  }
  return Array.from(byKey.values());
}

/** Strip surrounding single or double quotes (or an inline ` # comment` on unquoted values) and trim. */
function stripQuotes(raw: string): string {
  let trimmed = raw.trim();
  if (!trimmed.startsWith('"') && !trimmed.startsWith("'")) {
    trimmed = trimmed.replace(/\s+#.*$/, '').trim();
  }
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/**
 * Read the effective value of `key` from dotenv-like content.
 * The last matching assignment wins. Returns null when missing or empty.
 */
export function readEnvValue(content: string, key: string): string | null {
  const lines = content.split(/\r?\n/);
  let found: string | null = null;
  for (const line of lines) {
    if (line.trimStart().startsWith('#')) continue;
    const m = ASSIGNMENT_PATTERN.exec(line);
    if (!m) continue;
    if (m[2] !== key) continue;
    const value = stripQuotes(m[3]);
    found = value.length > 0 ? value : null;
  }
  return found;
}

/** Format a value for writing into a dotenv file. */
function formatEnvValue(value: string): string {
  if (SAFE_VALUE_PATTERN.test(value)) return value;
  // Values reaching here contain no quote, backslash or control character (see selectWhitelisted).
  return `"${value}"`;
}

/** Result of applying updates to dotenv content. */
export interface ApplyResult {
  content: string;
  added: string[];
  updated: string[];
  unchanged: string[];
}

/**
 * Apply the given updates to dotenv content without removing or reordering
 * any other line. Values are never included in the returned metadata.
 */
export function applyEnvUpdates(
  content: string,
  updates: RenderEnvVar[],
): ApplyResult {
  const added: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];

  // Preserve original line endings by working on an array of lines.
  const hadTrailingNewline = content.endsWith('\n');
  const lines = content.length === 0 ? [] : content.split('\n');
  // Drop the trailing empty element produced by a final newline.
  if (hadTrailingNewline && lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  for (const update of updates) {
    const { key, value } = update;
    const formatted = `${key}=${formatEnvValue(value)}`;

    // Collect indices of all assignment lines for this key.
    const indices: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trimStart().startsWith('#')) continue;
      const m = ASSIGNMENT_PATTERN.exec(line);
      if (!m) continue;
      if (m[2] !== key) continue;
      indices.push(i);
    }

    if (indices.length === 0) {
      lines.push(formatted);
      added.push(key);
      continue;
    }

    // Determine whether every occurrence already holds the new value.
    let allEqual = true;
    for (const idx of indices) {
      const m = ASSIGNMENT_PATTERN.exec(lines[idx]);
      if (!m) {
        allEqual = false;
        break;
      }
      const current = stripQuotes(m[3]);
      if (current !== value) {
        allEqual = false;
        break;
      }
    }

    if (allEqual) {
      unchanged.push(key);
      continue;
    }

    // Rewrite every occurrence, preserving a leading `export ` if present.
    for (const idx of indices) {
      const m = ASSIGNMENT_PATTERN.exec(lines[idx]);
      if (!m) continue;
      const exportPrefix = m[1] ? 'export ' : '';
      lines[idx] = `${exportPrefix}${formatted}`;
    }
    updated.push(key);
  }

  // Ensure the file ends with exactly one newline when non-empty.
  let result = lines.join('\n');
  if (result.length > 0) {
    result += '\n';
  }

  return { content: result, added, updated, unchanged };
}

/** Shape of a single item returned by the Render env-vars endpoint. */
interface RenderEnvVarItem {
  envVar?: { key?: unknown; value?: unknown };
  key?: unknown;
  value?: unknown;
  cursor?: unknown;
}

/** Shape of a page returned by the Render env-vars endpoint. */
type RenderEnvVarPage = RenderEnvVarItem[];

/**
 * Fetch all environment variables for a Render service, following pagination.
 * Never includes the response body in thrown errors.
 */
export async function fetchRenderEnvVars(
  serviceId: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RenderEnvVar[]> {
  const results: RenderEnvVar[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const base = `https://api.render.com/v1/services/${encodeURIComponent(
      serviceId,
    )}/env-vars?limit=${PAGE_LIMIT}`;
    const url = cursor === null ? base : `${base}&cursor=${encodeURIComponent(cursor)}`;

    const res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(`Render API HTTP ${res.status}`);
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      // Do not surface the parser message: it may quote part of the body.
      throw new Error('Render API returned an unreadable payload');
    }
    if (!Array.isArray(json)) {
      throw new Error('Render API returned an unexpected payload');
    }
    const items = json as RenderEnvVarPage;

    let nextCursor: string | null = null;
    for (const item of items) {
      if (item === null || typeof item !== 'object') continue;
      const wrapped = item.envVar;
      const key =
        wrapped && typeof wrapped === 'object' && typeof wrapped.key === 'string'
          ? wrapped.key
          : typeof item.key === 'string'
            ? item.key
            : null;
      const value =
        wrapped && typeof wrapped === 'object' && typeof wrapped.value === 'string'
          ? wrapped.value
          : typeof item.value === 'string'
            ? item.value
            : null;
      if (key !== null && value !== null) {
        results.push({ key, value });
      }
      if (typeof item.cursor === 'string' && item.cursor.length > 0) {
        nextCursor = item.cursor;
      }
    }

    if (items.length < PAGE_LIMIT || nextCursor === null) {
      return results;
    }
    cursor = nextCursor;
  }

  // Never return a truncated list: a silently missing key looks exactly like "not on the service".
  throw new Error('Render API returned more pages than expected');
}

/**
 * Verdict of a read-only Meta `debug_token` call. Only a definite answer from Meta counts:
 * `invalid` means is_valid=false or error code 190; throttling or network trouble is `unreadable`.
 */
export type TokenVerdict = 'valid' | `invalid:${string}` | 'unreadable';

/** Ask Meta whether a token is still alive. Never returns or throws anything containing the token. */
export async function debugMetaToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenVerdict> {
  try {
    const url =
      'https://graph.facebook.com/v21.0/debug_token?' +
      new URLSearchParams({ input_token: token, access_token: token }).toString();
    const res = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' } });
    const json: unknown = await res.json();
    if (json === null || typeof json !== 'object') return 'unreadable';
    const root = json as { data?: { is_valid?: unknown; error?: { code?: unknown; subcode?: unknown } }; error?: { code?: unknown; subcode?: unknown } };
    const data = root.data;
    if (data && data.is_valid === true) return 'valid';
    const err = data?.error ?? root.error;
    const code = err && typeof err.code === 'number' ? err.code : null;
    if ((data && data.is_valid === false) || code === 190) {
      const sub = err && typeof err.subcode === 'number' ? String(err.subcode) : '-';
      return `invalid:${code === null ? '?' : String(code)}/${sub}`;
    }
    return 'unreadable';
  } catch {
    return 'unreadable';
  }
}

/** Options for {@link syncEnvFromRender}. */
export interface SyncOptions {
  envFile: string;
  serviceId: string;
  apiKey: string;
  prefixes: readonly string[];
  dryRun: boolean;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Process environment to compare against (a stale shell export shadows the file). Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** When true, ask Meta (read-only) whether each synced token is alive. */
  verify?: boolean;
}

/** Report returned by {@link syncEnvFromRender}. Contains no values. */
export interface SyncReport {
  backupPath: string | null;
  entries: Array<{ key: string; status: 'added' | 'updated' | 'unchanged'; verdict?: TokenVerdict }>;
  /** Whitelisted keys on the service that were NOT synced because the value is not a plain single line. */
  skipped: string[];
  /** Keys that the current shell environment defines with a different value: they would shadow the file. */
  shellOverrides: string[];
  dryRun: boolean;
}

/** Format a Date as YYYYMMDD-HHMMSS in local time. */
function formatTimestamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${y}${mo}${d}-${h}${mi}${s}`;
}

/** Remove all but the newest `MAX_BACKUPS` backup files for the given env file. */
async function pruneBackups(envFile: string): Promise<void> {
  const dir = dirname(envFile);
  const base = basename(envFile);
  const prefix = `${base}.bak-`;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  const backups = names
    .filter((n) => n.startsWith(prefix))
    .sort()
    .reverse();
  const toRemove = backups.slice(MAX_BACKUPS);
  for (const name of toRemove) {
    try {
      await unlink(join(dir, name));
    } catch {
      // Ignore pruning failures; they must not break the sync.
    }
  }
}

/**
 * Sync whitelisted environment variables from a Render service into a local
 * dotenv file. Never logs or returns variable values.
 */
export async function syncEnvFromRender(opts: SyncOptions): Promise<SyncReport> {
  const { serviceId, apiKey, prefixes, dryRun } = opts;
  assertSafePrefixes(prefixes);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => new Date());
  const shellEnv = opts.env ?? process.env;

  // Follow a symlinked .env.local so the real file is rewritten (and backed up) in place:
  // renaming over the link itself would replace the link with a regular file.
  let envFile: string;
  try {
    envFile = await realpath(opts.envFile);
  } catch {
    throw new Error('env file not found');
  }

  // Fetch first, read the local file afterwards: nothing edited meanwhile is overwritten.
  const remote = await fetchRenderEnvVars(serviceId, apiKey, fetchImpl);
  const selected = selectWhitelisted(remote, prefixes);
  const selectedKeys = new Set(selected.map((v) => v.key));
  const skipped = Array.from(
    new Set(
      remote
        .filter((v) => KEY_PATTERN.test(v.key) && prefixes.some((p) => v.key.startsWith(p)) && !selectedKeys.has(v.key))
        .map((v) => v.key),
    ),
  );
  if (selected.length === 0) {
    throw new Error(
      'no whitelisted variables found on the service; local file left untouched',
    );
  }

  let original: string;
  try {
    original = await readFile(envFile, 'utf8');
  } catch {
    throw new Error('env file not found');
  }

  const applied = applyEnvUpdates(original, selected);
  const shellOverrides = selected
    .filter((v) => typeof shellEnv[v.key] === 'string' && shellEnv[v.key] !== v.value)
    .map((v) => v.key);

  const entries: SyncReport['entries'] = [];
  for (const key of applied.added) entries.push({ key, status: 'added' });
  for (const key of applied.updated) entries.push({ key, status: 'updated' });
  for (const key of applied.unchanged) entries.push({ key, status: 'unchanged' });

  // Ask Meta (read-only) whether the synced tokens are alive; "synced" is not "works".
  if (opts.verify === true) {
    const valueByKey = new Map(selected.map((v) => [v.key, v.value] as const));
    for (const entry of entries) {
      entry.verdict = await debugMetaToken(valueByKey.get(entry.key) ?? '', fetchImpl);
    }
  }

  // Dry run: report only, no writes.
  if (dryRun) {
    return { backupPath: null, entries, skipped, shellOverrides, dryRun: true };
  }

  // Nothing changed: no write, no backup.
  if (applied.added.length === 0 && applied.updated.length === 0) {
    return { backupPath: null, entries, skipped, shellOverrides, dryRun: false };
  }

  // Back up the original content before modifying anything.
  const backupPath = `${envFile}.bak-${formatTimestamp(now())}`;
  // 'wx' refuses to overwrite: two syncs in the same second must not clobber the first backup.
  await writeFile(backupPath, original, { mode: 0o600, flag: 'wx' });
  await chmod(backupPath, 0o600);

  // Write atomically via a temp file then rename; never leave a temp file with secrets behind.
  const tmpPath = `${envFile}.tmp-${process.pid}`;
  try {
    await writeFile(tmpPath, applied.content, { mode: 0o600 });
    await rename(tmpPath, envFile);
  } catch {
    await unlink(tmpPath).catch(() => undefined);
    throw new Error('could not write the env file; the original was left in place');
  }

  // Keep only the newest backups.
  await pruneBackups(envFile);

  return { backupPath, entries, skipped, shellOverrides, dryRun: false };
}
