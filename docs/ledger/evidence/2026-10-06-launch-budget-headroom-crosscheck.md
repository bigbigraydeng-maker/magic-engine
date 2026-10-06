# launch-budget-headroom 独立重写对拍（2026-10-06）

**结论：一致。** DeepSeek 只看接口说明（`--spec.md`，没给它看 Claude 写的实现）独立写了一份；Claude 原来的 13 个测试对它全过；两份在 3,005 组样本上逐项输出完全一致。

## 怎么做的
1. 接口说明（`2026-10-06-launch-budget-headroom-crosscheck--spec.md`）→ DeepSeek（aider one-shot，1 轮，花费约 $0.003）写出 `launch-budget-headroom-ds.ts`（237 行）；
2. 我原来的 13 个测试，只把导入路径指到 DeepSeek 版：**13 通过 / 0 失败**，`tsc` 对它 0 报错；
3. 对拍脚本（下面代码块）把两份在同一批输入上跑，比较 `ok`、全部数值字段（在投合计、分账户、潜在预算、投影、余量、是否放得下）、`latentUnits` 与 `committed`；失败时只比「失败与否」（原因文字不比）。

## 样本
- **3,000 组固定种子的随机样本**：随机状态（含空值/未知状态）、预算（含空/0/负/小数）、预算层级、币种（含混币/空）、`disappeared`、同一实体多条快照、非系列/广告组层的行、上限（含空/0/负/小数）、已承诺增量（含负数/小数）。其中成功（`ok:true`）630 组、放得下 599 组、含暂停潜在预算 135 组——**不是都在早早失败**；
- 5 组边界（空输入、最新一条是 disappeared、旧的 disappeared 被新记录覆盖、刚好等于上限、超 1 分）；
- 另外用 2026-10-05 的 CTS 真实快照（69 行）把试跑脚本分别对两份跑了一遍：输出逐字一致，唯一差别是「传负数」时拒绝原因的文字（两边措辞不同，函数不比较原因文字）。

## 结果
```
样本 3005 组，两份输出一致 3005 组，不一致 0 组
```

## 对拍脚本能不能抓到差异（变异检验）
把 DeepSeek 版的 `projectedMinor <= capMinor` 改成 `<` 再跑：**5 组不一致**（刚好等于上限那几组），改回后恢复 0。

## 没覆盖的
- 原因文字、错误判定的先后顺序（两版可能先报不同的错，都是失败）不比；
- 两份的口径与 Kernel 的 `envelope-facts.ts`、诊断的 `diagnostics/context.ts` 之间**仍没有自动对账**（见函数头注释）。

## 对拍脚本
```ts
// 对拍：Claude 自写版 vs DeepSeek 只看接口说明独立写的版本。比较 ok / 全部数值字段 / latentUnits / committed；失败时只比 ok（原因文字不比）。
import { computeLaunchHeadroom as A, type HeadroomRow } from '/Users/raydeng/Projects/magic-engine/.claude/worktrees/kind-nobel-b6b748/src/lib/ads-strategy/launch-budget-headroom'
import { computeLaunchHeadroom as B } from '/Users/raydeng/Projects/magic-engine/.claude/worktrees/kind-nobel-b6b748/src/lib/ads-strategy/launch-budget-headroom-ds'

const norm = (r: ReturnType<typeof A>) => (r.ok ? JSON.stringify({ ...r, latentUnits: [...r.latentUnits] }) : 'FAIL')
let n = 0, same = 0, okCount = 0, fitsCount = 0, latentCount = 0
const diffs: string[] = []
const cmp = (name: string, args: Parameters<typeof A>[0]) => {
  n++
  const ra = A(args); if (ra.ok) { okCount++; if (ra.fits) fitsCount++; if (ra.latentUnits.length) latentCount++ }
  const a = norm(ra), b = norm(B(args))
  if (a === b) same++
  else diffs.push(`${name}\n  A=${a.slice(0, 300)}\n  B=${b.slice(0, 300)}`)
}

// 1) 随机样本（固定种子）
let seed = 20261006
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]
const STAT = ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'PENDING_BILLING_INFO', 'ARCHIVED', 'DELETED', 'PENDING_REVIEW', null] as const
const REAS = ['daily', 'changed', 'first_seen', 'disappeared'] as const
const BUD = [null, 0, -5, 500, 1500, 4000, 6000, 12.5] as const
const T0 = Date.parse('2026-10-01T00:00:00Z')
for (let i = 0; i < 3000; i++) {
  const rows: HeadroomRow[] = []
  const nc = 1 + Math.floor(rnd() * 4)
  for (let c = 0; c < nc; c++) {
    const acct = pick(['A', 'B', 'C'])
    const cid = `c${i}-${c}`
    const bl = pick(['cbo', 'abo', 'abo', null] as const)
    const cur = rnd() < 0.03 ? pick(['AUD', '', null, ' nzd ']) : 'NZD'
    const mk = (level: 'campaign' | 'adset', id: string, camp: string | null, b: typeof bl) => {
      const k = 1 + (rnd() < 0.2 ? 1 : 0)
      for (let r = 0; r < k; r++) rows.push({ ad_account_id: acct, level, entity_id: id, campaign_id: camp, budget_level: b, daily_budget_minor: pick(BUD), effective_status: pick(STAT), currency: cur as string | null, capture_reason: pick(REAS), captured_at: new Date(T0 + Math.floor(rnd() * 5) * 3600_000).toISOString() })
    }
    mk('campaign', cid, cid, bl)
    const na = Math.floor(rnd() * 3)
    for (let a = 0; a < na; a++) mk('adset', `${cid}-s${a}`, cid, pick(['abo', 'cbo', null] as const))
    if (rnd() < 0.1) rows.push({ ad_account_id: acct, level: pick(['ad', 'account', 'audience'] as const), entity_id: `x${i}-${c}`, campaign_id: cid, budget_level: null, daily_budget_minor: 999, effective_status: 'ACTIVE', currency: 'NZD', capture_reason: 'daily', captured_at: new Date(T0).toISOString() })
  }
  const cap = pick([null, 0, -1, 15000, 3000, 100000, 1.5] as const)
  const committed = rnd() < 0.8 ? [] : [{ label: 'x', minor: pick([0, 800, 3000, -1, 2.5] as const) }]
  cmp(`rand-${i}`, { rows, capMinor: cap, committed })
}

// 2) 单元测试里的构造样例已由 13 个测试覆盖；再加边界
const base = (over: Partial<HeadroomRow>): HeadroomRow => ({ ad_account_id: 'A', level: 'adset', entity_id: 'e', campaign_id: null, budget_level: 'abo', daily_budget_minor: 1000, effective_status: 'ACTIVE', currency: 'NZD', capture_reason: 'daily', captured_at: '2026-10-05T00:00:00Z', ...over })
cmp('empty rows', { rows: [], capMinor: 100, committed: [] })
cmp('disappeared newest', { rows: [base({ captured_at: '2026-10-01T00:00:00Z' }), base({ capture_reason: 'disappeared', captured_at: '2026-10-02T00:00:00Z' })], capMinor: 100, committed: [] })
cmp('disappeared older than live', { rows: [base({ capture_reason: 'disappeared', captured_at: '2026-10-01T00:00:00Z' }), base({ captured_at: '2026-10-02T00:00:00Z' })], capMinor: 5000, committed: [] })
cmp('exactly at cap', { rows: [base({})], capMinor: 1000, committed: [] })
cmp('one over', { rows: [base({})], capMinor: 1000, committed: [{ label: 'x', minor: 1 }] })
console.log(`其中成功(ok:true) ${okCount} 组、放得下 ${fitsCount} 组、含暂停潜在预算 ${latentCount} 组`)
console.log(`样本 ${n} 组，两份输出一致 ${same} 组，不一致 ${n - same} 组`)
for (const d of diffs.slice(0, 8)) console.log('\nDIFF', d)
if (diffs.length > 8) console.log(`\n… 另有 ${diffs.length - 8} 组`)
```
