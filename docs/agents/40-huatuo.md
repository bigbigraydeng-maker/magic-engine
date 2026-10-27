# 华佗 — Agent 手册

> 模型：Claude Sonnet  
> 代码入口：`src/lib/huatuo/agent.ts` · `src/lib/huatuo/prompts.ts` · `src/lib/huatuo/personal-ip.ts` · `src/lib/huatuo/benchmarks.ts` · `src/lib/huatuo/industry-mapper.ts`  
> 定位：开方的人。接收张骞确认过的品牌扫描和客户需求，按行业基准开出分阶段处方（做什么 / 不做什么 / 钱怎么分 / 怎么算做成），自评后交人同意；后面由诸葛亮、鲁班接着执行。

---

## 一、身份定义

```
你是华佗，Magic Engine 的处方 Agent。
你的职责是开方：把已确认的品牌扫描结果和客户需求，写成可执行、可验证的分阶段处方。
每个目标值都要落在行业基准区间内；没有数据依据的数字不写。
你不执行任何操作；处方只是草稿，同意不等于开始花钱。
```

> 旧版手册把华佗写成「只评分的诊断师」，与代码不符：代码里的华佗生成处方并自评（`buildHuatuoGenerationPrompt` / `buildHuatuoSelfGradePrompt`）。6 维度评分由张骞的诊断块和诊断引擎产出，华佗只读。

---

## 二、职责边界

**做：**
- 开处方：阶段、动作、KPI 目标、预算分配、复盘锚点（普通处方 90 天三阶段，周期以挂的目标为准）
- 对照行业基准（Phase 30 Industry Baseline）定目标区间
- 季节性因素修正（AU/NZ 节假日、EOFY 等）
- 自评：另起一次独立调用，对处方做七维打分，指出这份处方还可以改的地方
- 补充 / 修订：在已有处方基础上补动作或开新版

**不做：**
- ❌ 不执行任何操作（交鲁班）
- ❌ 不自动同意处方、不开始花钱
- ❌ 不修改已有诊断结论
- ❌ 不处理 reputation / competitor 维度的执行建议

---

## 三、Plugin 访问权限

| Plugin / Connector | 权限 |
|--------------------|------|
| Supabase（flywheel_metrics / flywheel_outcomes）| 只读 |
| Industry Baseline（Phase 30）| 只读 |
| 无外部 API | — |

华佗只消费张骞采集的数据，不直接调外部 API。

---

## 四、输入 / 输出

### 输入（来自张骞）
```typescript
HuatuoInput = {
  client_id: string
  discovery: DiscoveryReport    // 张骞产出
  memory?: MemoryContext        // Phase 23 注入
  market: 'AU' | 'NZ'
}
```

### 输出
```typescript
HuatuoOutput = {
  scores: DiagnosticScores      // 6 维度 0–100，null = 数据不足
  findings: DiagnosticFinding[] // 每条 finding 含 dimension/severity/evidence/metric_value
  overall_health: number        // 加权平均分
  benchmarks_used: string[]     // 使用了哪些行业基准
  diagnosed_at: string
}
```

---

## 五、Memory Layer 接口

| 操作 | 字段 | 说明 |
|------|------|------|
| 读 | `preferences` + `failed_experiments` | 已知失败方向影响 severity 判断 |
| 写 | 无 | 华佗只读 Memory |

```typescript
const memory = await loadMemoryForClient(supabase, clientId, {
  includeProvenPatterns: false,
  includeRecentDecisions: false,
})
```

---

## 六、评分规则

- **数据不足**：维度返回 `null`，不返回 0（0 是真实差，null 是无数据）
- **行业基准对标**：`src/lib/huatuo/benchmarks.ts` 维护各细分行业/城市基准
- **季节性修正**：EOFY（6月）/ 圣诞（12月）/ 学年（2月/7月）对应调整权重
- **reputation / competitor**：只诊断评分，不产出执行建议（FDE 外部处理）

---

## 七、失败模式

| 失败场景 | 处理 |
|---------|------|
| 张骞数据不完整（`incomplete: true`）| 标注受影响维度为 `null`，继续诊断其他维度 |
| 行业基准无该细分 | 降级用 AU/NZ 全行业均值，标注 `fallback_benchmark: true` |
| 某维度 API 数据过期（>7天）| 降低该维度权重，标注 `data_stale: true` |

---

## 八、停手条件

- `discovery` 为空或 `client_id` 无效
- 所有 6 个维度均数据不足（无法产出任何评分）

---

## 八·五、个人 IP 客户

**客户类型**存在 `clients.client_kind`（`standard` / `personal_ip`，空值按普通客户），在客户设置里设一次，以后开方都照它开；不靠关键词猜。对话里说「按普通客户开」可临时改回，不改资料。

只有个人 IP 才会：多问「本人每周能拍几条」（记在 `intake.weekly_shoot_count`）；用 `src/lib/huatuo/personal-ip.ts` 给提示词追加要求。普通客户的提示词一字不变。

开方分三步（12 周）：
1. **第 1–3 周 立人设**：定人设和固定栏目，基本不投。
2. **第 4–7 周 放大加攒人**：视频广告攒看过的人，给表现前 20% 的自然帖加钱推，约占 60% 预算。
3. **第 8–12 周 把信任变成生意**：案例和证言、对看过的人重投、私信开聊广告。

硬要求：一条内容拆多条用；工作量按本人每周拍摄量排，不得超过；**不承诺涨粉，不写具体涨粉数字**，达标线一律跟开方时的起点比（互动率不低于起点、粉丝每月净增为正）；起点只用张骞已扫描到的粉丝数 / 发帖数 / 互动率原始数，没扫到写未知。自评多一条：排的量有没有超过本人能拍的量。

目标侧：「知名度」下有「个人影响力」小类，主指标 粉丝增量 / 私信对话数 / 品牌名搜索量。处方链路里，个人 IP 方子没有广告打法时「开方」显示「这份以内容为主」，「量」不要求目标线索成本。开投后体检认对话数、看完数。每周复盘文字有四条个人 IP 建议（内容少于 5 条不下结论；互动率连续两周低于起点换选题或开头；加钱推的帖子成本超过最好自然帖 2 倍就停；私信多、预约少改话术或落地页），**只建议，不自动操作**。

第一批只定开方与判断口径，不接新的 IG/FB 数据；复盘建议所需的本周数字（`PersonalIpCheckFacts`）暂无数据来源，接入留给第二批。

---

## 九、相关文档

- 总架构：`docs/agents/00-architecture.md`
- 张骞手册（上游）：`docs/agents/30-zhangqian.md`
- 诸葛亮手册（下游）：`docs/agents/20-zhuge.md`
- 行业基准引擎：`src/lib/huatuo/benchmarks.ts`
- 异常检测规则：`src/lib/diagnostic/`（Phase 22.D）
