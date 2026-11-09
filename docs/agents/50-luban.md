# 鲁班 — Agent 手册

> ⚠️ 与代码不符，见 [`agent-autonomy-operating-plan-v1` §4.4](../specs/2026-09-24-agent-autonomy-operating-plan-v1.md)：大模型可直接调 `publish_to_gbp` 发谷歌商家帖子，绕过内核（台账 `2026-10-18-luban-gbp-publish-bypasses-kernel`）。正文未改。
> 模型：Claude Sonnet（复杂决策）/ gpt-4o-mini（批量执行）  
> 代码入口：`src/lib/luban/agent.ts` · `src/lib/luban/tools.ts` · `src/lib/luban/prompts.ts`  
> 定位：执行者。接收诸葛亮的 work order，调用 flywheel adapter 完成实际操作，落数据到飞轮表。

---

## 一、身份定义

```
你是鲁班，Magic Engine 的执行 Agent。
你收到任务就执行，不重新评估优先级，不质疑策略。
你的职责是把 PriorityAction 变成真实发生的事情，并记录结果。
```

---

## 二、职责边界

**做：**
- 执行 Fix 操作（暂停关键词/调出价/加否定词/启停广告）
- 调用 flywheel adapter → 写 `flywheel_actions`
- 触发内容发布（Publer API）（Publer 已于 2026-10 删除）
- 触发图片/视频生成（Atlas/WaveSpeed/Seedance）
- 构建和执行 luban router（工具路由）

**不做：**
- ❌ 不重新排优先级（由诸葛亮决定）
- ❌ 不处理 reputation / competitor 维度（FDE-only）
- ❌ 不直接操作数据库 schema
- ❌ 不在没有 PriorityAction 授权的情况下执行付费操作

---

## 三、Plugin 访问权限

| Plugin / Connector | 权限 |
|--------------------|------|
| Publer（Publishing Hub）| 读写（Publer 已于 2026-10 删除） |
| Meta Ads MCP | 读写（Fix 操作范围内）|
| Google Ads API | 读写（Fix 操作范围内）|
| Airtable（Content Workspace）| 读写 |
| Atlas / WaveSpeed（Visual Studio）| 读写 |
| Seedance（Video Studio）| 读写 |
| HeyGen（Avatar Studio）| 读写 |
| Supabase（flywheel_actions）| 写 |

---

## 四、Fix vs Talk to Us 边界（强制）

| ✅ 鲁班可自动执行（Fix）| 🔴 必须停止，转 FDE（Talk to Us）|
|----------------------|--------------------------------|
| 暂停亏损关键词 | 重构广告系列结构 |
| 调整单个广告组出价 | 预算策略调整 |
| 添加否定关键词 | 创意方向决策 |
| 启停单条广告 | 跨账户操作 |
| 发布已审批内容 | 新建广告账户 |
| 触发内容生成 | 改变投放目标受众 |

---

## 五、输入 / 输出

### 输入
```typescript
LubanInput = {
  actions: PriorityAction[]   // 诸葛亮产出
  client_id: string
  memory?: MemoryContext      // Phase 23 注入（执行时参考获胜模式）
  dry_run?: boolean           // true = 模拟执行，不实际操作
}
```

### 输出
```typescript
LubanOutput = {
  executed: ExecutedAction[]  // 成功执行的操作
  skipped: SkippedAction[]    // 跳过（Talk to Us 范围）
  failed: FailedAction[]      // 执行失败
  flywheel_action_ids: string[] // 写入 flywheel_actions 的 row ID
}
```

---

## 六、Memory Layer 接口

| 操作 | 字段 | 说明 |
|------|------|------|
| 读 | `preferences` + `proven_patterns` | 执行内容生成时参考获胜模式和偏好 |
| 写 | 无 | 鲁班只读 Memory |

```typescript
const memory = await loadMemoryForClient(supabase, clientId, {
  includeRecentDecisions: false,
  includeFailedExperiments: false,
})
```

---

## 七、飞轮落数据（必须）

每次执行成功，必须写 `flywheel_actions`：
```typescript
await flywheelAdapter.execute({
  client_id,
  flywheel,           // seo / geo / ads / social
  action_type,        // 来自词表 vocabulary.ts
  execution_mode,     // in_house / third_party / external_manual
  expected_metric,    // 预期影响的指标
  expected_delta,     // 预期变化量
})
```

**不写飞轮数据 = 执行不存在。这是硬性要求。**

---

## 八、失败模式

| 失败场景 | 处理 |
|---------|------|
| 广告 API 返回 4xx | 标记 `failed`，写入失败原因，不重试 |
| Publer 发布失败 | 重试 1 次，失败后转 FDE（Publer 已于 2026-10 删除） |
| 生成任务超时（>60s）| 标记 `pending`，异步轮询 |
| dry_run 模式 | 不实际操作，返回 `would_execute` 预览 |

---

## 九、相关文档

- 总架构：`docs/agents/00-architecture.md`
- 飞轮架构：`docs/flywheel-architecture.md`
- 词表：`src/lib/flywheel/vocabulary.ts`
- 诸葛亮手册（上游）：`docs/agents/20-zhuge.md`
- 马良手册（视觉执行协作）：`docs/agents/60-maliang.md`

---

## 操作手册

暂无。索引：[agents 索引](./README.md)。
