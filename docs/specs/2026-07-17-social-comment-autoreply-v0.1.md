# Facebook 评论 AI 全自动回复 — v0.1

> 归属：**社媒支柱 / DAPE 执行段**（Phase 20.D 子任务）
> PR：#607 · 分支 `claude/auto-reply-opportunity-48raix`
> 日期：2026-07-17 · 三审：魏征（架构）/ 板桥（C 端口吻）/ 狄仁杰（护栏攻击）

## 1. 背景 / 动机

客户（首个：CTS Tours）FB 帖子下大量真实互动评论（"An amazing experience" / "China is a fantastic country to visit"），官方零回复 = 热线索被晾。ME 全自动拉取评论 → AI 分类 → 回复（公开回帖 + 可选私信引导）/ 隐藏垃圾，数据回流社媒飞轮。

**PM 决策**：直接全自动 / 允许私信引导 / CTS 已有 page engagement 权限。

## 2. 红线（最高约束）

CLAUDE.md 硬约束：对外内容绝不编运营细节（价格/日期/时长/行程/折扣）。因此**「全自动」≠「AI 自动回答事实问题」**：

- LLM 只被信任写「夸赞」类暖回复。
- 问题/负面走**确定性安全模板** + 转人工，绝不 LLM 作答。
- 夸赞草稿必须过 `isPraiseReplySafe`（无数字/链接/@ + 无 claim）+ confidence ≥ 0.85 才用，否则回退安全模板。
- 最坏情况：一句零 claim 的感谢。

## 3. 架构

```
cron (*/30)  →  per enabled client
  → getMetaTokenForClient → getPageAccessToken
  → fetchPagePosts(lookback) → fetchPostComments
  → 每条评论:
      claimComment (UNIQUE(comment_id) 抢锁, 冲突→skip)   ← 幂等锁
      classifyComment (Haiku 分类 + 护栏)
      DM-first: 先私信 → 成功才用「已私信」公开话术
      replyToComment / hideComment
      finalise (回填 replied/dm_sent/hidden/failed + error_message)
      flywheel_actions 回流 (social.comment_auto_reply)
```

**幂等（魏征 P0）**：claim-first —— 发 FB 前先 insert `processing` 行，靠 `UNIQUE(comment_id)` 抢锁；冲突即 skip。杜绝重复公开回复 + 并发双发。失败写 `failed` + `attempts`，下轮重试（≤3）。

**DM-first（魏征/板桥）**：私信先发，成功才用「we've messaged you」公开措辞，否则用不含此声明的公开兜底 —— 杜绝「当众说了句假话」。

## 4. 分类 × 分级

| 类别 | 公开回复 | 私信 | 自动? |
|---|---|---|---|
| praise 夸赞 | AI 暖回复（过护栏）/ 轮换安全模板 | 有购买意向才发引导 | ✅ |
| question 提问 | 安全话术（含官网兜底），**不作答** | 引导 + 转人工 | 接住不作答 |
| complaint 负面 | 共情（不承诺弥补） | 转真人 | 可 per-client 关 |
| spam 垃圾 | 隐藏（默认关） | — | 半自动 |
| other | 不回，转人工 | — | ❌ |

## 5. 护栏（狄仁杰加固后）

- 入口 `NFKC` 归一化（折叠全角）。
- `detectUnverifiableClaims`：货币双向 + 多币种 + 文字数字 + minutes/week/month + 纯数字/相对日期 + percent 文字 + `included` 过去式 + arrange/pickup/guarantee/refund/cheapest。
- `isPraiseReplySafe` 白名单闸：LLM 夸赞回复含任意数字/链接/@ → 回退。
- praise confidence < 0.85 → 回退。

## 6. 文件

| 文件 | 职责 |
|---|---|
| `lib/meta/comments.ts` | Graph 读/回/私信/隐藏/删 |
| `lib/social/comment-guardrails.ts` | claim 过滤器 + 安全模板 |
| `lib/social/comment-classifier.ts` | Haiku 分类 + 决策 |
| `lib/social/comment-autoreply-engine.ts` | per-client 编排（claim-first） |
| `api/cron/social-comment-autoreply` | 每 30 分 cron |
| `api/clients/[id]/comment-autoreply-config` | 配置 GET/PATCH |
| `api/clients/[id]/comment-engagements` | 审计列表 + 撤回 |
| `api/clients/[id]/comment-autoreply-probe` | 权限探针（只读） |
| Settings §3.5 面板 + 审计列表 | FDE UI |
| migration `20260717000001_*` | config + engagements 双表 |

## 7. 安全件

- 全局 kill switch：`SOCIAL_COMMENT_AUTOREPLY_KILL=1`
- per-client `enabled` + 分类别开关（UI）
- 防自回复死循环：过滤 `from.id == page_id`
- 审计视图 + 一键撤回（删 FB 回复）

## 8. 待办 / 已知限制

- [ ] migration 待 PM `go apply`
- [ ] PR-0 探针在真 token 环境验证三 scope（面板按钮已就绪）
- [ ] 分页：`fetchPostComments` 50 条不翻页、`fetchPagePosts` 25 帖 —— 爆帖可能漏，SMB 量级可接受，后续加 paging
- [ ] webhook 实时化（Phase 2，回复更即时，需 App Review）
