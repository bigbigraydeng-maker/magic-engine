# 素材流程改为「数据驱动」· 设计 v0.4（增量，仅供讨论）· 只设计，未写代码 · 119 号 · 2026-10-21

> 在 v0.1–v0.3 之上：冲突处以本稿为准。吸收魏征第二份报告的三点 + 放大幅度问题。**本稿不构成对 `bounded_auto` 或任何自动花钱的授权。**

## 1. 质检回执：入池前唯一一道对外文案合规（魏征①）
- 工厂 + 苏东坡质检的结论必须是**机器可读回执**，字段至少：工单 id、**成片 `final_mp4_sha256`**、质检结论（pass/fail）、质检人/角色、时间、质检规则版本。**回执绑定成片哈希**：哈希变了，旧回执作废。
- **缺回执 = fail-closed**：没有绑定当前哈希的 pass 回执 → 不得入 `test_queue`，已入池的回退 `pending_qc`。
- **事后撤销**：质检被撤（苏东坡/PM 撤回 pass）或哈希变 → 素材退出池、对应测试组**立刻自动停**（收类，永远放行），出待办；已在 `scaling` 的同样停并通知 PM。
- 本流程**不新增文案生产**（v0.2 §5），所以质检回执就是文案合规的唯一入口，不得绕过。

## 2. 「自动停/退役」是否需要 `bounded_auto`（魏征②、③，已读库+读码核实）
**核实时间 2026-10-21，方式：服务端只读脚本读 `ad_strategy_configs` 与 `client_automation_policies`；读码 `kernel/authorize.ts`、`registry-ads.ts`、`autonomy/sync-policy.ts`。**
- Kernel 唯一认的权威源是 `client_automation_policies.mode`；`autonomy_mode` 只是单向同步的「意向」（`observe → require_approval`，`bounded_auto → auto_approve`）。
- **全部 9 个 `ads.*` 动作都是 `sideEffect:'outward'`**：`require_approval` 下任何 AI 发起的动作都走「等人批准」（`authorize.ts` 约 555–601 行），不会自己执行；`auto_approve` 也只在动作自己声明的 `bounded` 信封内放行。
- **当前状态（读库）**：CTS Tours NZ（`c0000000…`）`autonomy_mode=observe`，9 个 `ads.*` 键**全是 `require_approval`**（同步自 10-20，`updated_by` 为 `autonomy-sync:…`）→ **切换前内核路径只会产生「待批准」，不会自动执行。** 这一前提现在是**证实的**，不是印象。
- **但有一个客户是 `bounded_auto`：New Asian Logistics（`4ae76381…`），9 个 `ads.*` 键全是 `auto_approve`（日上限 10000 分，`autopilot_enabled=false`，`dry_run=true`）。** 收类动作（暂停/降预算）对它本来就永远放行。→ **新流程对它的影响必须显式隔离**：新流程加一个**逐客户开关** `creative_flow_enabled`（默认 `false`，只有 PM 本人能开）；开关未开的客户（含 NAL）不受任何新规则影响。
- 结论：**自动停/退役仅在 `creative_flow_enabled=true` 且（对加钱类）`bounded_auto` 时生效；** 对 CTS，两者都不满足 → 只出建议与待办。
- 非内核路径提醒：CTS `autopilot_enabled=true`、`dry_run=true`（读库）——D3 自动暂停在演练模式下不实际写；本流程不依赖它。

## 3. 「赢了却放不动」：晋升的动作形态（放大幅度）
单次改预算 ≤ 20%、72h 冷却（内核）。若把测试组（小额）直接加到放大池的绝对额，会永远被内核拦。**晋升不改测试组预算**，而是：
1. 对排名胜出的素材，**新建一个放大组**（`new_spend`，新对象，不受 20% 改幅限制）；
2. 初始日预算 = `min(放大总预算 × 30%, 测试组日预算 × 3)`（初值，计划/配置可调更小）——既不一步冲满，也不让测试组被拉升；
3. 之后每次加预算 ≤ 20%、72h 冷却、复核仍显著领先才走下一步（v0.2 §3）；
4. 测试组到时自然结束（`retired`），不与放大组叠花同一素材同一受众（受众互斥规则沿用）。
- `new_spend` 仍受 2999 日预算闸、3010 计划闸、`clientCap` 约束（取最小，见 v0.3 §3）；放大组在学习期内的加预算仍会被信封拒（v0.3 §3 死路，未解之前放大只出建议）。
- 边界表补一行：**「晋升 = new_spend，初始额 ≤ 放大总预算×30%」**，并在验收里加：好广告能从测试走到放大第一步而不被 20% 规则拦。

## 4. 验收补充
①无绑定哈希的质检回执 → 不入池；②质检被撤 → 对应测试/放大组自动停；③NAL（`bounded_auto`）在 `creative_flow_enabled=false` 时不受影响；④CTS（`require_approval`）下新流程只产出待批准请求，零自动写；⑤晋升用新建放大组、初始额 ≤ 放大总预算×30%，不触发 20% 拦截。

**本稿不构成对 `bounded_auto` 或任何自动花钱的授权。**
