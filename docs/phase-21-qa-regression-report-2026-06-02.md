# Phase 21 QA 回归报告（打印版）

> 日期：2026-06-02  
> 环境：线上 `https://app.magicengine.com.au`  
> 测试账号：`bigbigraydeng@gmail.com`  
> 测试客户：`[QA] CTS Tours NZ`  
> Client ID：`aaaaaaaa-0000-0000-0000-000000000001`

---

## 1. 本轮结论

- `G2 / V1 fan-out`：**已恢复**
  - 真实量产已跑通，成功生成 `5/5` 平台内容
  - `production_packages` 成功落库
  - `content_posts` 新增
  - AI Gateway 监控有日志
- `G3 / V2 生图`：**已恢复**
  - 对带 `visual_brief` 的真实帖子，生图链路成功返回 `asset_id + storage_url`
  - `visual_asset_url` 后续变为非空
- `诸葛亮工作台反馈链路`：**已恢复**
  - 线上缺失的 `zhuge_feedback_events` 表已补齐
  - `Launch Hub` 真实点击 `已处理` 后，`待补发` 提示不再长时间挂住
  - 数据库事件计数可增长
- `Production Package -> 查看 →`：**仍有残留问题**
  - 链接地址已修正确认为 `Launch Hub` 深链
  - 线上真实点击已确认可跳转
  - 但跳到 `Launch Hub` 后，`highlight` 仍未自动切换状态 / 打开目标帖子
  - 当前问题已收敛为“目标上下文没有真正带到 FDE 眼前”

---

## 2. 测试范围

本轮回归覆盖以下链路：

1. 社媒内容量产 `fan-out`
2. 社媒图片生成
3. AI Gateway 监控
4. 诸葛亮工作台反馈补发
5. Production Package 社媒产物跳转

---

## 3. 测试时间线与结果

### 3.1 第一阶段：G2 / G3 初始失败

#### G2 一键量产

- 初始表现：失败
- 现象：
  - 预算闸曾拦截
  - 后续又出现 `401 Unauthorized`
  - 再往后定位到 `CF_AIG_TOKEN` 被错误配置为整段 `curl ...` 文本

#### G3 图片生成

- 初始表现：失败
- 现象：
  - 一开始是 `No visual_brief on this post`
  - 后续变成 `401 [{"code":2009,"message":"Unauthorized"}]`
  - 再往后变成 invalid header value，说明网关 token 配置不正确

---

### 3.2 第二阶段：AI Gateway 修复后复测

#### V1 fan-out

- 成功标准：
  - `HTTP 201`
  - `success: true`
  - `successCount = 5`
  - `failures = []`
  - `budget.spent > 5000`

- 最终结果：**通过**
  - 成功包：
    - `e96bf43a-fcb7-45a7-8a1a-0817b29ad33d`
    - `e41299bc-cd37-4a15-b52b-dadb2705961f`
  - 两次成功包各产出 `5` 条帖子
  - `content_posts` 新增 `10` 条
  - 月度扣费后端账本累计到 `5050 MTC`

#### V2 生图

- 成功标准：
  - 无 `401`
  - 返回 `success: true`
  - 返回 `asset_id + storage_url`
  - `30-60s` 后 `visual_asset_url` 非空

- 最终结果：**通过**
  - 对 `post_id=899c8a8b-014e-423d-a8a4-09a1ad568b1b` 点击 `生成图片`
  - 返回成功
  - `visual_asset_url` 后续变为非空

#### V3 AI Gateway 监控

- 成功标准：
  - `total_count > 0`
  - 可看到文本生成与图片生成日志

- 最终结果：**通过**
  - 监控页出现 `Anthropic v1/messages`
  - 监控页出现 `OpenAI images/generations`

---

### 3.3 第三阶段：诸葛亮工作台 beta 上线回归

#### 观察点

- 右下角出现 `诸 / 工作台`
- 可打开工作台抽屉
- 可见：
  - 当前工作线程
  - 待处理摘要
  - 下一步建议 Beta
  - `已处理 / 稍后再看 / 不相关`

#### 首次发现的问题

- 点击 `已处理` 后
  - 建议会隐藏
  - `恢复建议` 会出现
  - 但页面长期显示：
    - `还有 1 条反馈事件待补发`

#### 根因定位

- 生产 Supabase 缺少表：
  - `public.zhuge_feedback_events`
- 因此：
  - 前端反馈事件无法写入
  - pending 队列无法清空

#### 修复动作

1. 线上补齐 `zhuge_feedback_events` migration
2. 前端队列增加自动重试逻辑：
   - `15s` 定时重试
   - `online` 触发重试
   - `focus` 触发重试
   - `visibilitychange` 触发重试

#### 修复后结果

- `Launch Hub` 真实点击 `已处理`
  - 页面不再出现 `待补发`
  - 建议会隐藏
  - `恢复建议` 可用
- 数据库验证：
  - `zhuge_feedback_events` 事件数从 `2 -> 3`

结论：**诸葛亮工作台反馈补发主问题已恢复**

---

### 3.4 第四阶段：Production Package 回归

#### 包页可用性

- 可正常打开有效包页：
  - `/dashboard/clients/aaaaaaaa-0000-0000-0000-000000000001/production/e41299bc-cd37-4a15-b52b-dadb2705961f`
- 页面内可见：
  - 社媒产物卡
  - `查看 →`
  - 右下角 `诸 / 工作台`

#### 链接目标校验

- DOM 中 `查看 →` 的目标已正确变为：

```text
/dashboard/content?client=aaaaaaaa-0000-0000-0000-000000000001&pkg=e41299bc-cd37-4a15-b52b-dadb2705961f&highlight=4fbee7b5-ae2d-4aa1-b0de-bc3267be06b5
```

这说明：

- 深链地址已经修对
- 会带上 `pkg`
- 会带上 `highlight`

#### 真实点击结果

- 在线上包页真实点击 `查看 →`
- 页面已成功跳到：
  - `/dashboard/content?client=...&pkg=...&highlight=...`
- 说明真实导航已成立

#### 目标页直开结果

- 直接打开上面的目标 URL
- `Launch Hub` 可正常加载
- `pkg` 参数存在
- `highlight` 参数存在

#### 真实落地体验

- 进入 `Launch Hub` 后
  - URL 中存在 `pkg`
  - URL 中存在 `highlight`
  - 但页面当前筛选仍停在 `草稿（待审批）`
  - 详情抽屉没有自动打开
  - 目标帖子没有被明确带到第一视野

#### 额外验证

- 直接访问：
  - `/dashboard/content?client=aaaaaaaa-0000-0000-0000-000000000001&highlight=dddddddd-0000-0000-0000-000000000801`
- 页面仍显示：
  - 状态筛选值为 `draft`
  - 详情抽屉未自动打开

结论：**当前残留问题不是“包页点不动”，而是 Launch Hub 没有真正消费 `highlight` 上下文**

---

## 4. 数据证据

### 4.1 生产包

- 成功生产包：
  - `e96bf43a-fcb7-45a7-8a1a-0817b29ad33d`
  - `e41299bc-cd37-4a15-b52b-dadb2705961f`

### 4.2 社媒帖子

- 两次 fan-out 共新增：
  - `10` 条 `content_posts`

### 4.3 扣费

- 成功 fan-out 扣费记录：
  - `dc002325-1d62-401f-9e90-09760f694b53`
  - `595e61ac-87ec-40a2-a779-83238335295a`
- 月度已花：
  - `5050 MTC`

### 4.4 反馈事件

- `zhuge_feedback_events`
  - 修表后可查询
  - 本轮补测期间事件数从 `2 -> 3`

---

## 5. 当前状态总表

| 项目 | 状态 | 备注 |
|---|---|---|
| G2 / V1 fan-out | ✅ | 5/5 成功，量产可用 |
| G3 / V2 生图 | ✅ | 对带 `visual_brief` 的真实帖子已恢复 |
| V3 AI Gateway 监控 | ✅ | 已有日志，不再是 0 |
| 诸葛亮工作台反馈补发 | ✅ | 缺表已补，待补发不再长挂 |
| Production Package 包页可打开 | ✅ | 有效包页可访问 |
| Production Package `查看 →` 深链地址 | ✅ | `href` 正确 |
| Production Package `查看 →` 真实点击 | ✅ | 真实点击可跳到 Launch Hub |
| Launch Hub `highlight` 上下文消费 | ❌ | 未自动切换状态 / 打开目标帖子 |

---

## 6. 建议下一步

1. 修 `Launch Hub` 的 `highlight` 消费闭环
   - 目标：从 `Production Package` 或任意深链进来时，自动切换到目标帖子状态并打开详情
   - 当前问题已从“路径错误 / 点击不导航”收敛为“落地后仍要自己找内容”

2. 部署前端自动重试代码
   - 目前生产库缺表问题已解
   - 自动重试代码已提交，但仍需部署后做一次真实回归

3. 部署后再补一轮诸葛亮工作台回归
   - 重点验证：
     - 离线后恢复网络是否自动补发
     - 页面失焦再回焦是否自动补发
     - `15s` 重试是否如预期生效

---

## 7. 适合 PM 的一句话结论

Phase 21 主链路已经大体恢复，AI 量产、生图、监控、工作台反馈补发都已跑通；当前最主要的剩余问题，不再是 `Production Package` 点不动，而是进入 `Launch Hub` 后没有把目标帖子自动带到 FDE 眼前。
