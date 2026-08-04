/**
 * Data freshness evaluation — layer 2 of the "system can say it went blind" defence.
 *
 * Principle: a cron that reports success while writing zero rows is
 * indistinguishable from a healthy one if you only read logs. So we ignore the
 * process entirely and look at the product: did the table actually get new rows
 * within the window it is supposed to?
 *
 * Everything here is pure. The cron route supplies observations; this module
 * decides what they mean. That keeps the judgement testable without a database.
 */

export type FreshnessStatus = 'fresh' | 'stale' | 'never';
export type FreshnessSeverity = 'warn' | 'critical';

/** One registered data stream, mirroring `data_freshness_expectations`. */
export interface FreshnessExpectation {
  id: string;
  table_name: string;
  timestamp_column: string;
  filter_column: string | null;
  filter_prefix: string | null;
  /** Column holding the owning client, or null for global streams. */
  client_column: string | null;
  label: string;
  pillar: string;
  max_age_hours: number;
  monitor_from: string | null;
  enabled: boolean;
  severity: FreshnessSeverity;
  notes?: string | null;
}

/** What the probe actually found in the database. */
export interface FreshnessObservation {
  lastWrittenAt: string | null;
  rowCount: number | null;
  /** Set when the probe itself failed (bad column, dropped table, ...). */
  error?: string | null;
}

export interface FreshnessResult {
  expectationId: string;
  streamKey: string;
  label: string;
  pillar: string;
  status: FreshnessStatus;
  severity: FreshnessSeverity;
  lastWrittenAt: string | null;
  ageHours: number | null;
  maxAgeHours: number;
  overdueHours: number | null;
  rowCount: number | null;
  probeError: string | null;
}

const MS_PER_HOUR = 3_600_000;

/**
 * Postgres identifiers are interpolated into PostgREST calls, and they come from
 * a database table rather than from code. Anything outside a plain lowercase
 * identifier is rejected rather than escaped — the registry has no legitimate
 * reason to contain anything else.
 */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export function isSafeIdentifier(value: string): boolean {
  return SAFE_IDENTIFIER.test(value) && value.length <= 63;
}

export function assertSafeIdentifier(value: string, kind: string): string {
  if (!isSafeIdentifier(value)) {
    throw new Error(`Unsafe ${kind} in freshness registry: ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Stable identity for a stream. Used as the daily-log unique key, so it must not
 * change when a label is edited.
 */
export function streamKey(expectation: Pick<FreshnessExpectation, 'table_name' | 'filter_column' | 'filter_prefix'>): string {
  if (expectation.filter_column && expectation.filter_prefix) {
    return `${expectation.table_name}:${expectation.filter_column}=${expectation.filter_prefix}`;
  }
  return expectation.table_name;
}

/** Registry rows that should actually be probed right now. */
export function selectActiveExpectations(
  expectations: FreshnessExpectation[],
  now: Date,
): FreshnessExpectation[] {
  return expectations.filter((expectation) => {
    if (!expectation.enabled) return false;
    if (expectation.monitor_from) {
      const from = new Date(`${expectation.monitor_from}T00:00:00Z`);
      if (!Number.isNaN(from.getTime()) && now < from) return false;
    }
    return true;
  });
}

/** Turn one observation into a verdict. */
export function evaluateFreshness(
  expectation: FreshnessExpectation,
  observation: FreshnessObservation,
  now: Date,
): FreshnessResult {
  const base = {
    expectationId: expectation.id,
    streamKey: streamKey(expectation),
    label: expectation.label,
    pillar: expectation.pillar,
    severity: expectation.severity,
    maxAgeHours: expectation.max_age_hours,
    rowCount: observation.rowCount,
  };

  // A probe that could not run is itself a failure worth reporting. Treating it
  // as "fresh" would recreate exactly the silent-success bug we are fixing.
  if (observation.error) {
    return {
      ...base,
      status: 'never',
      lastWrittenAt: null,
      ageHours: null,
      overdueHours: null,
      probeError: observation.error,
    };
  }

  if (!observation.lastWrittenAt) {
    return {
      ...base,
      status: 'never',
      lastWrittenAt: null,
      ageHours: null,
      overdueHours: null,
      probeError: null,
    };
  }

  const written = new Date(observation.lastWrittenAt);
  if (Number.isNaN(written.getTime())) {
    return {
      ...base,
      status: 'never',
      lastWrittenAt: null,
      ageHours: null,
      overdueHours: null,
      probeError: `Unparseable timestamp: ${observation.lastWrittenAt}`,
    };
  }

  const ageHours = Math.max(0, (now.getTime() - written.getTime()) / MS_PER_HOUR);
  const stale = ageHours > expectation.max_age_hours;

  return {
    ...base,
    status: stale ? 'stale' : 'fresh',
    lastWrittenAt: written.toISOString(),
    ageHours: round2(ageHours),
    overdueHours: stale ? round2(ageHours - expectation.max_age_hours) : null,
    probeError: null,
  };
}

export function evaluateAll(
  pairs: Array<{ expectation: FreshnessExpectation; observation: FreshnessObservation }>,
  now: Date,
): FreshnessResult[] {
  return pairs.map(({ expectation, observation }) => evaluateFreshness(expectation, observation, now));
}

export interface FreshnessSummary {
  total: number;
  fresh: number;
  stale: number;
  never: number;
  /** stale + never — everything that needs attention. */
  broken: number;
  criticalBroken: number;
  /** Most overdue stream, for the email subject line. */
  worst: FreshnessResult | null;
}

export function summarize(results: FreshnessResult[]): FreshnessSummary {
  const broken = results.filter((r) => r.status !== 'fresh');
  const worst = broken.reduce<FreshnessResult | null>((acc, r) => {
    if (!acc) return r;
    // "never" outranks any finite overdue window
    if (r.status === 'never' && acc.status !== 'never') return r;
    if (acc.status === 'never' && r.status !== 'never') return acc;
    return (r.overdueHours ?? 0) > (acc.overdueHours ?? 0) ? r : acc;
  }, null);

  return {
    total: results.length,
    fresh: results.filter((r) => r.status === 'fresh').length,
    stale: results.filter((r) => r.status === 'stale').length,
    never: results.filter((r) => r.status === 'never').length,
    broken: broken.length,
    criticalBroken: broken.filter((r) => r.severity === 'critical').length,
    worst,
  };
}

/**
 * Ops-wide pillar rollup across ALL clients, for an internal overview.
 * The per-client board strip uses `toClientPillars` below instead — it has a
 * different vocabulary ('not_connected' rather than 'never'), because for one
 * client "we never connected this" and "this broke" are different problems.
 */
export interface PillarFreshness {
  pillar: string;
  status: FreshnessStatus;
  streams: number;
  brokenStreams: number;
  /** Days since the oldest broken stream in this pillar last received data. */
  staleDays: number | null;
  lastWrittenAt: string | null;
}

export function toPillarFreshness(results: FreshnessResult[]): PillarFreshness[] {
  const byPillar = new Map<string, FreshnessResult[]>();
  for (const result of results) {
    const bucket = byPillar.get(result.pillar);
    if (bucket) bucket.push(result);
    else byPillar.set(result.pillar, [result]);
  }

  return Array.from(byPillar.entries())
    .map(([pillar, group]) => {
      const broken = group.filter((r) => r.status !== 'fresh');
      const status: FreshnessStatus = broken.some((r) => r.status === 'never')
        ? 'never'
        : broken.length > 0
          ? 'stale'
          : 'fresh';

      const staleDays = broken.length
        ? Math.max(...broken.map((r) => (r.ageHours === null ? Infinity : r.ageHours / 24)))
        : null;

      const written = group
        .map((r) => r.lastWrittenAt)
        .filter((v): v is string => Boolean(v))
        .sort();

      return {
        pillar,
        status,
        streams: group.length,
        brokenStreams: broken.length,
        staleDays:
          staleDays === null ? null : Number.isFinite(staleDays) ? Math.floor(staleDays) : null,
        lastWrittenAt: written.length ? written[written.length - 1] : null,
      };
    })
    .sort((a, b) => a.pillar.localeCompare(b.pillar));
}

/** Plain-language line for one broken stream. No jargon — the PM reads this. */
export function describeBreakage(result: FreshnessResult): string {
  if (result.probeError) {
    return `${result.label}：检查本身失败了（${result.probeError}）`;
  }
  if (result.status === 'never') {
    return `${result.label}：从来没有写入过任何数据`;
  }
  const days = Math.floor((result.ageHours ?? 0) / 24);
  const expected = describeWindow(result.maxAgeHours);
  return `${result.label}：已经 ${days} 天没有新数据（正常应该${expected}就有一次）`;
}

/** Turn an hour threshold into something a non-technical reader can picture. */
export function describeWindow(maxAgeHours: number): string {
  if (maxAgeHours < 48) return `${maxAgeHours} 小时内`;
  const days = Math.round(maxAgeHours / 24);
  return `${days} 天内`;
}

// ---------------------------------------------------------------------------
// Notification policy
//
// The replay against real history says 6-8 streams are broken on any given day,
// several of them for months. Mailing an identical list every morning is the
// fastest way to teach the reader to ignore it — and an alert nobody opens is
// the same blindness we are trying to cure, one layer up.
//
// So: mail on CHANGE (something newly broke, or something recovered), plus a
// standing Monday reminder so long-running breakage cannot quietly fade away.
// ---------------------------------------------------------------------------

/** Yesterday's verdict for one stream, read back from data_freshness_alerts. */
export interface PreviousStreamStatus {
  streamKey: string;
  status: FreshnessStatus;
}

export interface NotificationDecision {
  send: boolean;
  /** Machine-readable reason, logged into the cron summary. */
  reason: 'first-run' | 'newly-broken' | 'recovered' | 'weekly-reminder' | 'all-fresh' | 'unchanged';
  newlyBroken: FreshnessResult[];
  /** Labels of streams that were broken last time and are fine now. */
  recovered: string[];
  /** Broken today and broken last time too. */
  ongoing: FreshnessResult[];
}

const MONDAY = 1;

export function decideNotification(
  results: FreshnessResult[],
  previous: PreviousStreamStatus[] | null,
  now: Date,
): NotificationDecision {
  const brokenNow = results.filter((r) => r.status !== 'fresh');
  const previousBroken = new Map<string, FreshnessStatus>();
  const previousKnown = new Set<string>();

  for (const entry of previous ?? []) {
    previousKnown.add(entry.streamKey);
    if (entry.status !== 'fresh') previousBroken.set(entry.streamKey, entry.status);
  }

  const hasHistory = (previous?.length ?? 0) > 0;

  // A stream is "newly broken" only if we have a previous verdict saying it was
  // fine. A stream we have never seen before is not news on its own — otherwise
  // adding a registry row would page the PM.
  const newlyBroken = hasHistory
    ? brokenNow.filter((r) => previousKnown.has(r.streamKey) && !previousBroken.has(r.streamKey))
    : brokenNow;

  const ongoing = brokenNow.filter((r) => previousBroken.has(r.streamKey));

  const freshKeys = new Set(results.filter((r) => r.status === 'fresh').map((r) => r.streamKey));
  const recovered = Array.from(previousBroken.keys()).filter((key) => freshKeys.has(key));

  const isMonday = now.getUTCDay() === MONDAY;

  if (!hasHistory) {
    return {
      send: brokenNow.length > 0,
      reason: brokenNow.length > 0 ? 'first-run' : 'all-fresh',
      newlyBroken,
      recovered,
      ongoing,
    };
  }

  if (newlyBroken.length > 0) {
    return { send: true, reason: 'newly-broken', newlyBroken, recovered, ongoing };
  }
  if (recovered.length > 0) {
    return { send: true, reason: 'recovered', newlyBroken, recovered, ongoing };
  }
  if (brokenNow.length === 0) {
    return { send: false, reason: 'all-fresh', newlyBroken, recovered, ongoing };
  }
  if (isMonday) {
    return { send: true, reason: 'weekly-reminder', newlyBroken, recovered, ongoing };
  }
  return { send: false, reason: 'unchanged', newlyBroken, recovered, ongoing };
}

function sortBroken(results: FreshnessResult[]): FreshnessResult[] {
  return [...results].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
    if (a.status !== b.status) return a.status === 'never' ? -1 : 1;
    return (b.overdueHours ?? 0) - (a.overdueHours ?? 0);
  });
}

/** The alert email. Plain language, what-changed first, no jargon. */
export function renderFreshnessEmail(
  results: FreshnessResult[],
  decision: NotificationDecision,
  now: Date,
): { subject: string; text: string; html: string } {
  const summary = summarize(results);
  const dateLabel = now.toISOString().slice(0, 10);

  // Everything healthy again — only reachable when something just recovered.
  if (summary.broken === 0) {
    const subject = `✅ 数据全部恢复更新 · ${summary.total} 条数据线都正常 · ${dateLabel}`;
    const body = `之前停摆的 ${decision.recovered.length} 条数据线已经恢复。现在 ${summary.total} 条数据线全部在按预期更新。`;
    return {
      subject,
      text: `${dateLabel}\n\n${body}`,
      html: `<p>${dateLabel}</p><p>${escapeHtml(body)}</p>`,
    };
  }

  const newly = sortBroken(decision.newlyBroken);
  const ongoing = sortBroken(
    results.filter((r) => r.status !== 'fresh' && !newly.some((n) => n.streamKey === r.streamKey)),
  );

  const subject =
    decision.reason === 'first-run'
      ? `⚠️ 首次体检：${summary.broken} 条数据线已经停止更新 · ${dateLabel}`
      : newly.length > 0
        ? `⚠️ 新增 ${newly.length} 条数据线停止更新（共 ${summary.broken} 条）· ${dateLabel}`
        : decision.reason === 'recovered'
        ? `📋 有数据线恢复了，还剩 ${summary.broken} 条没更新 · ${dateLabel}`
        : `⚠️ 每周提醒：${summary.broken} 条数据线仍未更新 · ${dateLabel}`;

  const textParts: string[] = [dateLabel, ''];
  const htmlParts: string[] = [`<p>${dateLabel}</p>`];

  if (newly.length > 0) {
    textParts.push('🔴 这次新发现停摆的：', '');
    textParts.push(...newly.map((r) => `• ${describeBreakage(r)}`));
    textParts.push('');
    htmlParts.push('<p><b style="color:#b91c1c">🔴 这次新发现停摆的：</b></p><ul>');
    htmlParts.push(...newly.map((r) => `<li>${escapeHtml(describeBreakage(r))}</li>`));
    htmlParts.push('</ul>');
  }

  if (decision.recovered.length > 0) {
    const line = `✅ 已恢复：${decision.recovered.join('、')}`;
    textParts.push(line, '');
    htmlParts.push(`<p style="color:#15803d">${escapeHtml(line)}</p>`);
  }

  if (ongoing.length > 0) {
    textParts.push('⏳ 之前就停了、目前还没修的：', '');
    textParts.push(...ongoing.map((r) => `• ${describeBreakage(r)}`));
    textParts.push('');
    htmlParts.push('<p><b>⏳ 之前就停了、目前还没修的：</b></p><ul>');
    htmlParts.push(...ongoing.map((r) => `<li>${escapeHtml(describeBreakage(r))}</li>`));
    htmlParts.push('</ul>');
  }

  textParts.push(
    `一共检查了 ${summary.total} 条数据线，正常的有 ${summary.fresh} 条。`,
    '',
    '注：这个检查看的是数据库里最后一次写入的时间，不是任务有没有「跑成功」。',
    '任务跑完并报告成功、但一行数据都没写，这里照样会报警；任务因为密钥不对被拒、',
    '连一条失败记录都没留下，这里也照样会报警。',
  );
  htmlParts.push(
    `<p>一共检查了 <b>${summary.total}</b> 条数据线，正常的有 ${summary.fresh} 条。</p>`,
    '<p style="color:#666;font-size:12px">注：这个检查看的是数据库里最后一次写入的时间，不是任务有没有「跑成功」。任务跑完并报告成功、但一行数据都没写，这里照样会报警；任务因为密钥不对被拒、连一条失败记录都没留下，这里也照样会报警。</p>',
  );

  return { subject, text: textParts.join('\n'), html: htmlParts.join('\n') };
}

// ---------------------------------------------------------------------------
// Per-client view — feeds the "数据新鲜度" strip at the top of a client board.
//
// Scoping rule (matters for Type B clients such as 30 Kiteroa Rothesay Bay):
// a stream that has NEVER received a row for this client is reported as
// `not_connected`, never as stale. A property-listing client that does not run
// SEO / GEO / social therefore shows those pillars as "未接入" and can never
// raise a false alarm — with no per-client configuration to maintain and no
// client-type flag to keep in sync. New Type B clients are covered on day one.
// ---------------------------------------------------------------------------

export type ClientStreamStatus = 'fresh' | 'stale' | 'not_connected';

/** The six pillars, always rendered so the strip has a stable shape. */
export const SIX_PILLARS = [
  'seo',
  'social',
  'ads',
  'reputation',
  'ai_visibility',
  'competitor',
] as const;

export const PILLAR_LABELS: Record<string, string> = {
  seo: 'SEO 搜索',
  social: '社媒',
  ads: '广告',
  reputation: '口碑',
  ai_visibility: 'AI 可见度',
  competitor: '竞品',
  ops: '系统内务',
};

export interface ClientStreamFreshness {
  streamKey: string;
  label: string;
  pillar: string;
  status: ClientStreamStatus;
  lastWrittenAt: string | null;
  /** Whole days since this client last received a row. */
  daysSinceLastWrite: number | null;
  /** How many days past the expectation. Only set when status is 'stale'. */
  daysOverdue: number | null;
  expectedEveryDays: number;
  rowCount: number | null;
}

export interface ClientPillarFreshness {
  pillar: string;
  label: string;
  status: ClientStreamStatus;
  freshStreams: number;
  staleStreams: number;
  notConnectedStreams: number;
  /** Days since the *worst* stale stream in this pillar last had data. */
  staleDays: number | null;
  /** Most recent write across the pillar, or null if never connected. */
  lastWrittenAt: string | null;
  streams: ClientStreamFreshness[];
}

const HOURS_PER_DAY = 24;

/** One client-scoped stream verdict. Never returns 'stale' for a stream this client never had. */
export function evaluateClientStream(
  expectation: FreshnessExpectation,
  observation: FreshnessObservation,
  now: Date,
): ClientStreamFreshness {
  const expectedEveryDays = Math.round(expectation.max_age_hours / HOURS_PER_DAY);
  const base = {
    streamKey: streamKey(expectation),
    label: expectation.label,
    pillar: expectation.pillar,
    expectedEveryDays,
    rowCount: observation.rowCount,
  };

  const written = observation.lastWrittenAt ? new Date(observation.lastWrittenAt) : null;

  // No row has ever existed for this client (or the probe failed) — that is a
  // connection question, not a staleness alarm.
  if (observation.error || !written || Number.isNaN(written.getTime())) {
    return {
      ...base,
      status: 'not_connected',
      lastWrittenAt: null,
      daysSinceLastWrite: null,
      daysOverdue: null,
    };
  }

  const ageHours = Math.max(0, (now.getTime() - written.getTime()) / MS_PER_HOUR);
  const stale = ageHours > expectation.max_age_hours;

  return {
    ...base,
    status: stale ? 'stale' : 'fresh',
    lastWrittenAt: written.toISOString(),
    daysSinceLastWrite: Math.floor(ageHours / HOURS_PER_DAY),
    daysOverdue: stale ? Math.floor((ageHours - expectation.max_age_hours) / HOURS_PER_DAY) : null,
  };
}

/** Roll client-scoped streams up into the six-pillar strip. */
export function toClientPillars(streams: ClientStreamFreshness[]): ClientPillarFreshness[] {
  const byPillar = new Map<string, ClientStreamFreshness[]>();
  for (const pillar of SIX_PILLARS) byPillar.set(pillar, []);
  for (const stream of streams) {
    const bucket = byPillar.get(stream.pillar);
    if (bucket) bucket.push(stream);
    else byPillar.set(stream.pillar, [stream]);
  }

  return Array.from(byPillar.entries()).map(([pillar, group]) => {
    const stale = group.filter((s) => s.status === 'stale');
    const fresh = group.filter((s) => s.status === 'fresh');
    const notConnected = group.filter((s) => s.status === 'not_connected');

    const status: ClientStreamStatus =
      stale.length > 0 ? 'stale' : fresh.length > 0 ? 'fresh' : 'not_connected';

    const written = group
      .map((s) => s.lastWrittenAt)
      .filter((v): v is string => Boolean(v))
      .sort();

    return {
      pillar,
      label: PILLAR_LABELS[pillar] ?? pillar,
      status,
      freshStreams: fresh.length,
      staleStreams: stale.length,
      notConnectedStreams: notConnected.length,
      staleDays: stale.length
        ? Math.max(...stale.map((s) => s.daysSinceLastWrite ?? 0))
        : null,
      lastWrittenAt: written.length ? written[written.length - 1] : null,
      streams: group,
    };
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
