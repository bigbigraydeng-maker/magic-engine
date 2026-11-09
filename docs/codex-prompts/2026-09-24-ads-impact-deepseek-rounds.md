# DeepSeek/aider 分轮派活手册 — 广告 IMPACT 闭环 WP0 / WP1 / WP2

> 派活日期：2026-09-24 · Build Control：广告构建控制窗口
> 合同：WP0 #1957 · WP1 #1958 · WP2 #1959 · Spec：`docs/specs/2026-09-24-ads-goal-driven-autonomous-impact-loop-v1.md`（PR #1956）
> 行号基于 `origin/main 5da5971a`；开工前 `git fetch origin` 后**先 grep 核对**，行号漂了以符号名为准。

## 0. 为什么要分轮（PR #1954 实测结论，别再踩）

DeepSeek（`deepseek/deepseek-chat`，128k 上下文）只接得住：**单文件 < 1000 行、改动范围明确、import 依赖已经写好**的活。跨文件推理、超 128k、要它"自己判断该怎么接"的活它会拒绝执行（回 `n`）或编造。所以：

- 每轮只给 1–3 个文件，每个要动的符号带**名字 + 行号**，新文件的 import 语句**完整写出**
- 提示词末尾必有 `RULES` 段：只许动列出的文件、不许动 `.gitignore`、保留 JSDoc
- `--no-auto-commits` 必带，commit 由 Claude Code 写
- 跨文件接线（cron 接线、页面、Kernel 核心三文件）**不派给 DeepSeek**，Claude Code 开发窗口做

## 1. 环境（每个 WP 一个 worktree，互不干扰）

```bash
cd /Users/raydeng/Projects/magic-engine
git fetch origin
git worktree add ../me-wp0 -b feat/ads-impact-wp0-goal-contract origin/main   # WP1: ../me-wp1 feat/ads-impact-wp1-patrol · WP2: ../me-wp2 feat/ads-impact-wp2-kernel-envelope
cd ../me-wp0 && cp ../magic-engine/.env.local .env.local && npm ci
export DEEPSEEK_API_KEY=<在 cmux 的 shell 里设，本手册不写值>
```

启动（每轮换文件清单）：

```bash
aider --model deepseek/deepseek-chat --no-auto-commits --map-tokens 0 \
  --read docs/specs/2026-09-24-ads-goal-driven-autonomous-impact-loop-v1.md \
  <本轮要改/新建的文件> --read <本轮模板文件>
```

每轮结束在 aider 里跑：`/run npx tsc --noEmit`（只看新增错误）→ `/run npx vitest run <本轮测试>` → `/run git diff --name-only` → `/run git status --short` → `/exit`。
Claude Code 收尾：核 diff 只动了该动的文件 → `git add <文件>` → `git commit`（带 Phase ID `[ADS-IMPACT.WPn]`）→ 全部轮次完成后 `npm run build` → push → Draft PR → 回 Issue 汇报。

---

## 2. WP0（#1957）· 7 轮 DeepSeek + 1 轮 Claude Code

### R0-1 · migration（新文件）
文件：`supabase/migrations/20260925000001_ad_strategy_configs_autonomy.sql`（新建）· 模板 `--read supabase/migrations/20260914000002_ad_strategy_configs_outcome_ladder.sql`
```
Create supabase/migrations/20260925000001_ad_strategy_configs_autonomy.sql following the header style of 20260914000002 (Chinese header comment; first line of header must say: ⚠️ 本文件只随 PR 提交，不在 PR 内 apply，apply 需 PM 显式 go).
ALTER TABLE public.ad_strategy_configs ADD COLUMN IF NOT EXISTS:
- daily_budget_cap_cents integer            -- NULL = 未设 → 自治一律 observe（spec §3 G1, M4）
- autonomy_mode text NOT NULL DEFAULT 'observe'
- creative_pool jsonb NOT NULL DEFAULT '[]'::jsonb
Add constraint ad_strategy_configs_autonomy_mode_chk CHECK (autonomy_mode IN ('observe','bounded_auto')) inside a DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$ block.
Add constraint ad_strategy_configs_daily_cap_chk CHECK (daily_budget_cap_cents IS NULL OR daily_budget_cap_cents > 0) the same way.
Add COMMENT ON COLUMN for all three (Chinese, one line each; creative_pool comment must state the element shape {kind:'meta_video'|'work_order', ref, status:'candidate'|'approved', approved_by?, approved_at?} and that approved_by is server-derived only).
Do NOT touch RLS (table already has TO service_role policy).
RULES: only create this one file. Do not modify any other file.
```

### R0-2 · 指标目录加 `messaging_started`
文件：`src/types/strategy.ts`（改）
```
In src/types/strategy.ts, PRIMARY_METRIC_CATALOG (starts line 293). Insert a new entry immediately after the 'leads_count' entry (lines 295-300), copying its exact shape:
{ key: 'messaging_started', label_en: 'Messaging conversations started', label_zh: '私信/WhatsApp 对话开启数',
  unit: 'count/mo', measurement: 'auto',
  recommended_for: ['acquisition'],
  recommended_for_sub_types: ['ongoing', 'event_driven'],
  default_direction: 'increase',
  note: 'Meta 广告 messaging_conversation_started 动作，按 outcome-ladder messaging_started 口径' },
If `measurement: 'auto'` is not a valid value for MetricCandidate.measurement, use the value the type allows that means "automatically fetched" and tell me which one you used.
RULES: only this file; only this insertion; do not reorder or reformat other entries.
```

### R0-3 · goal-pace 纯函数 + 测试（2 个新文件）
文件：`src/lib/ads-strategy/goal-pace.ts`（新）· `src/lib/ads-strategy/__tests__/goal-pace.test.ts`（新）· 模板 `--read src/lib/ads-strategy/baseline.ts`（看纯函数 + JSDoc 风格）
```
Create src/lib/ads-strategy/goal-pace.ts — a PURE function module, no imports from supabase, no side effects.

export type GoalPaceVerdict = 'on_track' | 'behind' | 'unreachable_within_caps' | 'unknown'
export interface GoalPaceInput {
  targetValue: number            // goals.target_value
  baselineValue: number          // goals.baseline_value（起点，进度按 target - baseline 算）
  periodStart: string            // 'YYYY-MM-DD'
  periodEnd: string              // 'YYYY-MM-DD'
  today: string                  // 'YYYY-MM-DD'
  actualToDate: number | null    // null = 归属数据不足（M2），不是 0
  dailyCapCents: number | null   // ad_strategy_configs.daily_budget_cap_cents
  medianCostPerResultCents7d: number | null   // 近 7 天每结果成本中位数（分）
}
export interface GoalPace {
  expectedToDate: number | null   // 线性节奏：(target-baseline) * elapsedDays / totalDays + baseline
  actualToDate: number | null
  gapPct: number | null           // (actual - expected) / expected * 100，expected<=0 时 null
  projectedEnd: number | null     // baseline + (actual-baseline)/elapsedDays * totalDays；elapsedDays=0 时 null
  verdict: GoalPaceVerdict
  reason: string                  // 中文一句话，给日报直接用
}
export function computeGoalPace(input: GoalPaceInput): GoalPace

Rules for verdict (spec §3 G2):
- any of actualToDate/periodStart/periodEnd/today invalid or actualToDate === null → 'unknown', reason '归属数据不足，未判'
- today < periodStart → 'unknown', reason '目标期未开始'
- today > periodEnd → treat elapsedDays = totalDays
- elapsedDays === 0 (first day) → 'unknown', reason '第 1 天，样本不足'
- if dailyCapCents !== null && medianCostPerResultCents7d !== null && medianCostPerResultCents7d > 0:
    remainingDays = totalDays - elapsedDays
    reachable = actualToDate + Math.floor(dailyCapCents / medianCostPerResultCents7d) * remainingDays
    if reachable < 0.8 * targetValue → 'unreachable_within_caps', reason `按当前日预算上限和近 7 天每结果成本，到期最多约 ${reachable}，不到目标的 80%`
- else if gapPct !== null && gapPct < -15 → 'behind'
- else → 'on_track'
Use whole-day arithmetic on UTC dates (Date.UTC), inclusive of periodStart, totalDays = daysBetween(periodStart, periodEnd) + 1. Round gapPct to 1 decimal, projectedEnd to integer.

Create src/lib/ads-strategy/__tests__/goal-pace.test.ts with vitest (import { describe, it, expect } from 'vitest'; import { computeGoalPace } from '../goal-pace'). At least 9 cases: on_track / behind / unreachable_within_caps / unknown(actual null) / unknown(before start) / unknown(first day) / after periodEnd clamps / medianCost 0 does not divide / expected<=0 gives gapPct null.
RULES: only these two files. No `any`. Functions < 50 lines each (split helpers).
```

### R0-4 · config.ts 读新三列
文件：`src/lib/ads-strategy/config.ts`（改）
```
In src/lib/ads-strategy/config.ts:
1. Add after line 10:
export type AutonomyMode = 'observe' | 'bounded_auto'
export type CreativePoolStatus = 'candidate' | 'approved'
export interface CreativePoolEntry {
  kind: 'meta_video' | 'work_order'
  ref: string
  status: CreativePoolStatus
  approved_by?: string
  approved_at?: string
}
2. Extend interface AdStrategyConfig (lines 12-16) with:
  daily_budget_cap_cents: number | null
  autonomy_mode: AutonomyMode
  creative_pool: CreativePoolEntry[]
3. defaultConfig (lines 27-29): add daily_budget_cap_cents: null, autonomy_mode: 'observe', creative_pool: [] — and update its JSDoc: "缺行 → autonomy_mode 一律 observe（spec §14 M4：缺行按锁定处理）".
4. In loadAdStrategyConfigWithSource: change the .select at line 45 to
   'client_id, enabled, digest_recipients, daily_budget_cap_cents, autonomy_mode, creative_pool'
   and in the mapping (lines 55-62) add:
   daily_budget_cap_cents: typeof data.daily_budget_cap_cents === 'number' && data.daily_budget_cap_cents > 0 ? data.daily_budget_cap_cents : null,
   autonomy_mode: data.autonomy_mode === 'bounded_auto' ? 'bounded_auto' : 'observe',
   creative_pool: parseCreativePool(data.creative_pool),
5. Add a private function parseCreativePool(raw: unknown): CreativePoolEntry[] that returns [] unless raw is an array; keeps only elements with kind in {'meta_video','work_order'}, string ref, status in {'candidate','approved'}; drops everything else silently. Export it (tests need it).
RULES: only this file. Keep every existing export and its signature. No `any` (use unknown + narrowing).
```

### R0-5 · auto-fetch.ts 加广告结果源
文件：`src/lib/strategy/auto-fetch.ts`（改）· 模板 `--read src/lib/ads-strategy/portfolio/outcome-ladder.ts`
```
In src/lib/strategy/auto-fetch.ts:
1. Add import at top (after line 41): import { countOutcome, isOutcomeStep, type OutcomeStep } from '@/lib/ads-strategy/portfolio/outcome-ladder'
2. Change AutoFetchResult (lines 43-45) to add a third variant:
  | { ok: false; reason: string; unknown: true }
  (unknown:true means "归属数据不足，不是 0" — callers must not display 0.)
3. In the switch (lines 59-73):
   - keep 'form_submissions' → fetchFormSubmissions as is
   - change 'leads_count' to: const ga = await fetchFormSubmissions(supabase, clientId); return ga.ok ? ga : fetchAdsOutcome(supabase, clientId, 'lead')
   - add case 'signups_count': return fetchAdsOutcome(supabase, clientId, 'lead')
   - add case 'messaging_started': return fetchAdsOutcome(supabase, clientId, 'messaging_started')
4. Add at the end of the file a new section:
// ── ads outcomes (spec 2026-09-24 ads IMPACT G1) ─────────────────────────
async function fetchAdsOutcome(supabase: SupabaseClient, clientId: string, step: OutcomeStep): Promise<AutoFetchResult>
   - read the client's active goal period: select period_start, period_end from goals where client_id = clientId and status = 'active' maybeSingle(); if none → { ok:false, reason:'no active goal', unknown:true }
   - read ad_daily_insights rows: select insight_date, actions, level, entity_id, parent_id, spend, results, optimization_goal where client_id = clientId and level = 'adset' and insight_date between period_start and period_end (page with .range in 1000-row pages until fewer than 1000 returned — never trust a single 1000-row response)
   - for each row call countOutcome(step, row, { messagingReferralAvailable: false, optimizationGoal: row.optimization_goal ?? null }); if ANY row returns value === null → return { ok:false, reason:'主结果归不到广告（M2）', unknown:true }
   - else sum values → { ok:true, value, source:'ad_daily_insights', snapshot_date: period_end, label: step }
   Split into helpers so no function exceeds 50 lines. If the DailyRow shape countOutcome expects differs from the columns above, read outcome-ladder.ts InsightForOutcome and map exactly — do not guess field names; tell me which fields you mapped.
RULES: only this file. Do not change fetchFormSubmissions or any other existing function.
```

### R0-6 · Settings 写入路由 + 批准路由
文件：`src/app/api/clients/[id]/ad-strategy-config/route.ts`（改）· `src/app/api/clients/[id]/ad-strategy-config/creative-pool/approve/route.ts`（新）· `--read src/lib/diagnostic/prescription-patch.ts`
```
FILE 1 — src/app/api/clients/[id]/ad-strategy-config/route.ts
1. Add import: import { parseCreativePool, type CreativePoolEntry } from '@/lib/ads-strategy/config'
2. Extend the body type at line 47 to: { enabled?: unknown; digest_recipients?: unknown; daily_budget_cap_cents?: unknown; autonomy_mode?: unknown; creative_pool?: unknown }
3. After the digest_recipients block (ends line 71) add three validation blocks, same style:
   - daily_budget_cap_cents: must be null or a positive integer → 400 'daily_budget_cap_cents must be a positive integer or null'
   - autonomy_mode: must be 'observe' | 'bounded_auto' → 400
   - creative_pool: must be an array; run parseCreativePool; then FORCE every entry to status:'candidate' and DELETE approved_by/approved_at (this route can never approve — spec §3 G1; 2026-08-04 incident in prescription-patch.ts). If the client sent any entry with status 'approved' or approved_by/approved_at present → return 400 'creative_pool approval must go through /creative-pool/approve'.
   Keep the existing guardGlobalAdmin at line 44 — do not move or weaken it.
FILE 2 — creative-pool/approve/route.ts (new), POST only:
   - same imports as FILE 1 plus loadAdStrategyConfig; export const dynamic = 'force-dynamic'
   - requirePaidClientAccess(clientId) then guardGlobalAdmin() (both, same as FILE 1 PATCH)
   - body: { ref: string } only; any other key (especially approved_by, approved_at, status) → 400 'only ref is accepted'
   - load config; find entry by ref; not found → 404; already approved → 200 idempotent
   - approved_by = the session identity: use whatever guardGlobalAdmin/requirePaidClientAccess exposes for the current user's email (read `access` return shape in src/lib/auth/client-access.ts; if it does not expose an email, STOP and tell me instead of inventing one)
   - write back the full creative_pool array with that entry set to status:'approved', approved_by, approved_at = now ISO; upsert on client_id like FILE 1
RULES: only these two files. No `any`.
```

### R0-7 · 日报"目标进度"段
文件：`src/lib/ads-strategy/portfolio/internal-digest.ts`（改）
```
In src/lib/ads-strategy/portfolio/internal-digest.ts:
1. Add import: import type { GoalPace } from '../goal-pace'
2. buildInternalDigest (line 130) opts gets an optional field: goal?: { title: string; label: string; target: number; dayIndex: number; totalDays: number; pace: GoalPace } | null
3. Add function goalSection(goal: NonNullable<typeof opts.goal> | null | undefined): string returning HTML for ONE line placed at the very top of the body (before leadLine output):
   - if goal is null/undefined → '<p>目标进度：这个客户还没有生效中的目标。</p>'
   - if pace.verdict === 'unknown' → `<p>目标进度：${esc(goal.title)} — 归属数据不足，未判（${esc(pace.reason)}）</p>`  (NEVER print 0 here)
   - else → `<p><b>目标进度</b>：${title} 目标 ${target} ${label}，第 ${dayIndex}/${totalDays} 天，已到 ${pace.actualToDate}（预计 ${pace.projectedEnd ?? '—'}，${gap}）</p>` where gap = pace.gapPct === null ? '差距未判' : (pace.gapPct >= 0 ? `超前 ${pace.gapPct}%` : `落后 ${Math.abs(pace.gapPct)}%`); if verdict === 'unreachable_within_caps' append ` — <b>按当前预算上限到不了目标，需要 PM 决定</b>`
4. Insert goalSection(opts.goal) at the top of the html body assembled inside buildInternalDigest.
RULES: only this file. Do not change subject logic, decideInternalSend, or persistAndSendInternalDigest signatures (persistAndSendInternalDigest may pass goal through as an optional field — add it as optional, default undefined).
```

### R0-8 · Claude Code（不派 DeepSeek）
- `dashboard/clients/[id]/ads-health/page.tsx` 顶部三块（目标链到 goals 页 / 日预算上限 / 素材池 + 批准按钮）；读失败显示"读不到"
- `google-data-pullback-daily/route.ts` 里给 `persistAndSendInternalDigest` 传 `goal`（读 active goal + `autoFetchMetricValue` + `computeGoalPace`；医治 7 天中位数从 `ad_daily_insights` 算）
- 路由测试（PATCH 传 approved 被拒 / approve 非 admin 403 / approved_by 不可覆盖）
- build / type-check / 截图 / Draft PR / Issue 回报

---

## 3. WP1（#1958）· 7 轮 DeepSeek + 1 轮 Claude Code

### R1-1 · migration `ads_growth_states`（新文件）
模板 `--read supabase/migrations/20260914000001_ad_entity_snapshots.sql`（看建表 + RLS 写法）
```
Create supabase/migrations/20260925000002_ads_growth_states.sql:
CREATE TABLE IF NOT EXISTS public.ads_growth_states (
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  date date NOT NULL,
  payload jsonb NOT NULL,
  problems_count integer NOT NULL DEFAULT 0,
  opportunities_count integer NOT NULL DEFAULT 0,
  goal_pace jsonb,
  data_completeness text NOT NULL DEFAULT 'complete' CHECK (data_completeness IN ('complete','partial')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, date)
);
ALTER TABLE public.ads_growth_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY ads_growth_states_service_role ON public.ads_growth_states FOR ALL TO service_role USING (true) WITH CHECK (true);   -- 🔴 必须 TO service_role
CREATE INDEX IF NOT EXISTS ads_growth_states_client_date_idx ON public.ads_growth_states (client_id, date DESC);
Header comment same style as the template; first header line: ⚠️ 本文件只随 PR 提交，不在 PR 内 apply，apply 需 PM 显式 go.
RULES: only this file.
```

### R1-2 · DiagnosisCode 扩 O1–O4
文件：`src/lib/ads-strategy/portfolio/diagnostics/types.ts`（改）
```
Line 15: change
export type DiagnosisCode = 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6' | 'D7' | 'D8' | 'D9'
to
export type DiagnosisCode = 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6' | 'D7' | 'D8' | 'D9' | 'O1' | 'O2' | 'O3' | 'O4'
and add a JSDoc line above it: /** D* = 问题（诊断）· O* = 机会（spec 2026-09-24 §3 G3），同一形状，同一日报 */
Add to NotComparableReason union: 'insufficient_days' | 'no_awareness_spend'
RULES: only this file, only these two edits.
```

### R1-3 · O1 潜在爆款
文件：`src/lib/ads-strategy/portfolio/opportunities/o1-hot-creative.ts`（新）· `.../opportunities/__tests__/o1-hot-creative.test.ts`（新）· `--read src/lib/ads-strategy/portfolio/diagnostics/d3-spend-no-result.ts --read src/lib/ads-strategy/portfolio/diagnostics/context.ts --read src/lib/ads-strategy/portfolio/diagnostics/__tests__/d3-spend-no-result.test.ts`
```
Create o1-hot-creative.ts modelled EXACTLY on d3-spend-no-result.ts (same imports style, same Diagnosis output shape, Chinese titles):
import type { AccountContext } from '../diagnostics/context'
import { adsetRows, sumSpend, unitOf } from '../diagnostics/context'
import type { Diagnosis } from '../diagnostics/types'
export const O1_CTR_MULTIPLE = 1.5
export const O1_MIN_DAYS = 3
export function findHotCreatives(ctx: AccountContext): Diagnosis[]
Logic (spec §3 G3 O1): for each adset not in ctx.experimentIds with spend > 0 on each of the last O1_MIN_DAYS days: compute daily CTR = clicks / impressions per day (skip days with impressions < 500 → if any of the 3 days skipped → not_comparable 'below_min_sample'); account median CTR per day over all adsets with impressions ≥ 500; hit if adset CTR > O1_CTR_MULTIPLE × median on all 3 days AND adset 3-day spend < account 3-day mean spend per adset. Output code 'O1', status 'hit', title `这条广告组连续 ${O1_MIN_DAYS} 天点击率是账户中位数的 1.5 倍以上但预算偏低，可能是潜在爆款`, evidence { ctr_day1..3, median_day1..3, spend_3d, account_mean_spend_3d }, sample [{label:'连续天数', value:3},{label:'账户参与比较的广告组', value:n}], clientVisible false, reasons ['建议 ads.scale_unit_budget（+≤20%）— 本 WP 只发现不出动作']. If fewer than 3 days of rows for the account → return [] (healthy day is empty, same convention as D3).
Test file: copy the fixture style of d3-spend-no-result.test.ts; ≥4 cases: hit / not hit (CTR high but spend also high) / not_comparable below_min_sample / experiment adset excluded.
RULES: only these two files. If AccountContext lacks a field you need (e.g. clicks), STOP and list what is missing — do not modify context.ts.
```

### R1-4 · O2 漏斗缺位
文件：`.../opportunities/o2-funnel-gap.ts` + test（新）· `--read .../diagnostics/d4-unharvested-audience.ts --read .../diagnostics/thresholds.ts`
```
Create o2-funnel-gap.ts: export function findFunnelGap(ctx: AccountContext): Diagnosis | null
Logic: awarenessSpend7d = sum spend of adsets whose ctx.roles role === 'awareness' over ctx.window; if awarenessSpend7d < D4_MIN_AWARENESS_SPEND (import from '../diagnostics/thresholds') → return null (healthy/no signal). If there is NO adset with role === 'retargeting' (any status) → hit: code 'O2', title '有破冰花费但账户里没有再营销广告组，看过视频的人没人接着追', evidence { awareness_spend_7d, awareness_adsets, retargeting_adsets: 0 }, sample [{label:'近 7 天破冰花费天数', value}], clientVisible false, reasons ['建议 ads.add_retargeting_adset — 本 WP 只发现不出动作']. If roleConfidence of all awareness adsets is 'low' → not_comparable with notComparableReason 'no_awareness_spend' is WRONG — use 'below_min_sample' and title '漏斗缺位判不了：破冰角色判定可信度低'.
Do not duplicate D4: D4 = "攒了人没收割（有再营销组但没覆盖）"; O2 = "根本没有再营销组". Add this distinction as a JSDoc line.
Test ≥4 cases.
RULES: only these two files.
```

### R1-5 · O3 预算错配
文件：`.../opportunities/o3-budget-mismatch.ts` + test（新）· `--read .../diagnostics/d5-budget-result-mismatch.ts`
```
Create o3-budget-mismatch.ts: export function findBudgetMismatch(ctx: AccountContext, input: DiagnosisInput): Diagnosis[]
Reuse D5's statistical machinery by IMPORTING its exported helpers from '../diagnostics/d5-budget-result-mismatch' (read the file first and list which helpers are exported; if the binomial test / BH correction are not exported, STOP and tell me — do not copy-paste them). Same-role comparison only (M6). Output the "reverse" of D5: a unit whose result share is significantly HIGHER than its budget share (D5 flags lower). code 'O3', title '同角色里这条广告组结果占比明显高于预算占比，预算可以往它倾斜', reasons ['建议 ads.budget_move_plan（总额不变）— 本 WP 只发现不出动作'], clientVisible false. Respect the same not_comparable reasons as D5 (primary_not_attributable, below_min_sample, single_unit, cbo_internal).
Test ≥4 cases mirroring D5's test fixtures.
RULES: only these two files.
```

### R1-6 · O4 剧本缺口
文件：`.../opportunities/o4-playbook-gap.ts` + test（新）· `--read src/lib/ads-strategy/play-vocabulary.ts --read src/lib/ads-strategy/playbooks/types.ts --read src/lib/ads-strategy/playbooks/travel.ts`
```
Create o4-playbook-gap.ts: export function findPlaybookGaps(ctx: AccountContext, playbook: AdsPlaybook, roles: ReadonlyMap<string, FunnelRole>): Diagnosis[]
Read play-vocabulary.ts PLAY_CATALOG first. Map each play to the funnel role it produces (thruplay_pool_build → awareness, lead_form_harvest/messenger_direct → acquisition, warm_pool_retarget → retargeting, reach_awareness → awareness, boost_organic_post → awareness). If AdsPlaybook does not declare an expected play list, STOP and tell me — do not invent a field on AdsPlaybook (industry facts belong in playbooks/, not here). If it does: for each expected play whose role has zero adsets in ctx → one Diagnosis code 'O4', status 'hit', clientVisible false, reasons ['只出建议，不出动作（spec G3 O4）'].
Test ≥3 cases.
RULES: only these two files.
```

### R1-7 · opportunities/run.ts 编排
文件：`.../opportunities/run.ts`（新）· `--read .../diagnostics/run.ts`
```
Create run.ts modelled on diagnostics/run.ts:
import { buildAccountContext } from '../diagnostics/context'
import { findHotCreatives } from './o1-hot-creative'
import { findFunnelGap } from './o2-funnel-gap'
import { findBudgetMismatch } from './o3-budget-mismatch'
import { findPlaybookGaps } from './o4-playbook-gap'
import type { Diagnosis, DiagnosisInput } from '../diagnostics/types'
import type { AdsPlaybook } from '../../playbooks/types'
export interface OpportunityRun { clientId: string; date: string; opportunities: Diagnosis[]; skippedReason: string | null }
export function runOpportunities(input: DiagnosisInput, playbook: AdsPlaybook, completeness: 'complete' | 'partial'): OpportunityRun
- if completeness === 'partial' → return { opportunities: [], skippedReason: '当日数据没拉全（campaign/adset/ad 三级或快照不完整），机会发现跳过（spec G6）' }
- for each account: ctx = buildAccountContext(account, input.date); if account.shared → push one not_comparable 'shared_account' Diagnosis with code 'O1' titled '共用账户不做机会发现' and continue (same as diagnostics/run.ts lines 39-46 style)
- else push O1, O2 (if non-null), O3, O4 results
- sort hits first then by code; return
RULES: only this file.
```

### R1-8 · Claude Code（不派 DeepSeek）
`agents/patrol.ts`（跨 evaluate / diagnostics / opportunities / goal-pace / Haiku）· cron 接线 + 三级完整性合成 · `GET /api/clients/[id]/ad-health` 扩展 · 看板页 · CTS 真实数据回放 · 变异（只查 campaign 级必红）· 截图交板桥 · Draft PR

---

## 4. WP2（#1959）· 先 Claude Code 核心，再 DeepSeek 6 轮

**顺序硬约束**：R2-0 合进分支之前，DeepSeek 一轮都不能开——它们都依赖新的 `authorization` 类型。

### R2-0 · Claude Code 核心（A 级，不派 DeepSeek）
`kernel/types.ts`（`OutwardAuthorization` → `authorization: {mode:'human_only'} | {mode:'bounded', envelope}`；ActionKey union 加 6 个键）· `kernel/outward-authorization.ts`（结构闸查声明完整合法）· `kernel/authorize.ts` ⑥b（实例闸）· `kernel/gateway.ts`（provider 前 `kernel_pre` 重算）· `kernel/autonomy-envelope.ts`（`isWithinEnvelope` 纯函数）· 现有两个定义迁 `human_only` · `runner.ts:714` 加 `outside_autonomy_envelope` · 现有 kernel 测试全绿。这一轮完成并自审后，再开下面各轮。

### R2-1 · 恢复码前向 migration（新文件）
`--read supabase/migrations/20260811040000_kernel_recovery_outward_requires_human_policy.sql --read src/lib/kernel/__tests__/architecture.test.ts`
```
Create supabase/migrations/20260925000003_kernel_recovery_outside_autonomy_envelope.sql that does for 'outside_autonomy_envelope' exactly what 20260811040000 did for 'outward_requires_human_policy' (same CREATE OR REPLACE of the RPC, whitelist extended by one code, forward-only, header says apply needs PM go). Then in architecture.test.ts extend the existing assertions around line 2011-2046 so the new file is in the "declares recoverable codes" list and the historical 20260808000003 is asserted NOT to contain 'outside_autonomy_envelope'.
RULES: only these two files.
```

### R2-2 · 6 个 ActionDefinition（新文件）
文件：`src/lib/kernel/registry-ads.ts`（新）· `src/lib/kernel/registry.ts`（改：DEFINITIONS 加 6 项）· `--read src/lib/kernel/registry.ts --read src/lib/kernel/types.ts`
```
Create src/lib/kernel/registry-ads.ts exporting six ActionDefinition constants, modelled on PAGE_APPLY_OPTIMIZATION_REQUEST (the outward example in registry.ts), for keys: ads.pause_unit, ads.cut_unit_budget, ads.scale_unit_budget, ads.budget_move_plan, ads.add_retargeting_adset, ads.swap_creative.
Every one: sideEffect:'outward', reversible:true, risk:'high', capability:'ads.<key suffix>', requiredCapabilityTier:'paid_client', allowedPurposes:['growth'], providerIdempotency:'unsupported', retryPolicy {maxAttempts:1, backoff:'fixed', baseMs:0}, verification: { method: 'ads_readback_integrity', delayMs: 600000 } (if VerificationMethod union does not include it, STOP and tell me — Claude Code adds it in R2-0),
authorization: { mode:'bounded', envelope: { maxBudgetDeltaRatio:0.2, respectDailyCapCents:true, minHoursSinceLastChange:72, excludeLearningPhase:true, excludeAdStudies:true, requiresRollbackHandler:true } }, declaredIn:'docs/specs/2026-09-24-ads-goal-driven-autonomous-impact-loop-v1.md §3 G5', rollback:'snapshot_restore' (budget/pause ones) or 'provider_native' (add_retargeting_adset, swap_creative).
idempotency.keyFields per action (scope:'client'): pause_unit/cut/scale → ['cycle_date','adset_id','delta_cents']; budget_move_plan → ['cycle_date','plan_hash']; add_retargeting_adset → ['cycle_date','campaign_id','audience_id']; swap_creative → ['cycle_date','ad_id','creative_ref'].
inputSchema/outputSchema: explicit required fields matching the keyFields plus ad_account_id; additionalProperties:false on input.
costModel: { kind:'fixed', estimate: () => 0 } with a comment "广告花费不进 Kernel 成本字段（K4），由 daily_budget_cap 管".
Then in registry.ts add the six to DEFINITIONS with an import from './registry-ads'.
RULES: only these two files. Chinese one-line title per action.
```

### R2-3 … R2-6 · capabilities 处理器（每轮一个动作，新文件）
`src/lib/capabilities/ads/{pause-unit,cut-unit-budget,scale-unit-budget,swap-creative}.ts` 各一轮 · `--read src/lib/capabilities/seo/build-publish-package.ts --read src/lib/ads-strategy/stop-loss.ts --read src/lib/meta/adsets.ts --read src/lib/kernel/types.ts`
```
Create src/lib/capabilities/ads/<name>.ts exporting createXxxCapability(sb: SupabaseClient): CapabilityImplementation modelled on build-publish-package.ts (steps keyed by definition.steps; first arg is AuthorizedExecutionContext). Wrap ONLY the existing executor: pause/cut → executeStopLoss from '@/lib/ads-strategy/stop-loss' with deps built from '@/lib/meta/adsets' (this directory is the only place allowed to import meta/adsets, K7); scale → setAdSetDailyBudget guarded by checkBudgetWithinSafeRange from '@/lib/meta/guardrails' (K10: read current budget first, abort if it differs from ctx.runInput.before_cents); swap_creative → the winner-sync path (read src/lib/winner-reel-sync/engine.ts and call its exported function; if none is suitable STOP and tell me).
Every capability registers a rollback handler (K1) that restores before_cents / re-activates (for pause) — read the OutwardRollbackHandler contract in page-apply-optimization/index.ts lines 683-700 and follow it; rollback must re-read live state first (K11), never use assumed values.
Token: getMetaTokenForClient from '@/lib/meta/token-manager' with the client-scoped variant only — never the shared fallback (K13). If the function signature has a fallback flag, pass the value that disables it and tell me which.
RULES: only this one new file per round. No `any`.
```
（`budget_move_plan` 与 `add_retargeting_adset` 涉及多腿回滚与 draft-and-gate 跨文件流程 → **Claude Code 做**。）

### R2-7 · 熔断 + 三件套（2 个文件）
`src/lib/ads-strategy/circuit-breaker.ts`（新）· `src/lib/pm-todo/manual-items.ts`（改：加 kind + push 函数）· `--read src/lib/pm-todo/manual-items.ts`
```
FILE 1 circuit-breaker.ts: export type BreakerReason = 'spend_spike' | 'daily_cap_exceeded' | 'rollback_failed' | 'jev_low_score_streak'; export interface BreakerInput {...}; export function evaluateBreaker(input): { tripped: boolean; reason: BreakerReason | null; detail: string } (pure) — rules spec §3 G11 first four; plus export async function tripBreaker(sb, clientId, reason, detail): sets ad_strategy_configs.autonomy_mode='observe' (update, not upsert) and inserts nothing else (the pm-todo item is derived, see FILE 2).
FILE 2 manual-items.ts: add 'ads_autonomy_frozen' to ManualItemKind; add export async function pushAdsAutonomyItems(supabase, items: ManualItem[], now: Date) that reads ad_strategy_configs rows with autonomy_mode='observe' AND a non-null breaker_reason column — if that column does not exist STOP and tell me (Claude Code decides whether to add it in the WP2 migration); what/how/href three-tuple in Chinese, href absolute to /dashboard/clients/<id>/ads-health; register it in loadManualItems with the same .catch pattern as the neighbours.
RULES: only these two files.
```

### R2-8 · Claude Code（不派 DeepSeek）
`budget_move_plan` / `add_retargeting_adset` 处理器 · `capabilities/index.ts` 装配 · eslint 受限清单（K7）· 架构测试（禁 import submitActionRun / recoverDeniedRun）· 变异测试 9 条 · 冻结 head 完整 mutation · Draft PR → 子牙 + 魏征 + 狄仁杰实施后复审

---

## 5. 每轮验收（Claude Code 收尾时逐条打勾）

- `git diff --name-only` 只含本轮列出的文件
- `npx tsc --noEmit` 新增错误 = 0（基线错误见 `project-typecheck-baseline-red`）
- 本轮测试全绿，贴完整 stdout（不是"通过了"三个字）
- 无 `any`；函数 < 50 行
- DeepSeek 若回 `n` / 说做不了 / 输出"总结"没有 diff → 记为该轮失败，Claude Code 接手，不重试第三次
