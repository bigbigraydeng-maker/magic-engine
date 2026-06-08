# FB Sprint 2026-06-08 — PM 每日同步协议 + ME Kanban action UUID 速查

> 子牙是 **CTS Kanban 同步官**。PM 每天结束时按本文档把"今天哪个窗口干完什么"报给子牙，子牙立刻 SQL 批量改 ME 数据库 action 状态。
> 这避免了 ME UI 上 Kanban 卡片永远 pending、verdict 看不到真实进展的盲区。

---

## 📋 PM 每日同步报告模板

> 每天结束时（或会话切换前）粘贴这段给子牙。**没干的不用写**，只列今天有动的。

```
子牙同步官 — 2026-MM-DD 进展

【ChinaTravel 落地页窗口】
- C5+ great-wall: [W1 done / W1 半完 / 还没开]
- C5+ terracotta: [...]
- (其他 C5 / C3 落地页改动)

【FB Sprint 窗口】
- C4 W1 7 篇 post: [done / N/7 / 没开]
- C1 Best of China 8 个 ad creative: [done / N/8 / 没开]
- C1 Tale of Two Cities 5 个: [...]
- C1 Shanghai 5 个: [...]

【Sonnet Google Ads 窗口】
- C2 账户健康检查: [done / 半完]
- C2 conversion tracking: [...]
- C2 4 Ad Group 建好: [...]
- C2 4 套 RSA: [...]

【PM 自己手动操作】
- C1 Meta SOP Token 配 Render: [done / 还没跑]
- C1 上传客户名单 Lookalike: [...]
- 等等

【子牙后台 ME 改动】
- 子牙自己今天动的，子牙自己写 SQL 改 status，不用 PM 报
```

子牙收到后**当场**：
1. SQL 把对应 action `status` 改成 `completed` / `in_progress`
2. 跑一次 SELECT 给 PM 看现在 G1/G2/G3 整体进度
3. 标记当前 blockers（依赖 Token / 等其他战线 / 等 PM 操作）

---

## 🗂️ ME Kanban Action UUID 速查表

### C1 Best of China 主推 + Oct 两团 — Facebook 广告冲刺 (9 actions)

| sort | action_id | title | 谁负责 |
|---|---|---|---|
| 10 | `02a0312c-e52b-4287-b2d7-799d0d298da7` | 健康检查 — Meta Pixel + form_submit 转化事件 | PM (Meta Business UI) |
| 20 | `1e14e0b5-c26d-43c5-a0ab-957f0348ffc2` | 创建 3 个 FB Campaign 骨架（Best of China 主推 + Oct 两团）| **FB Sprint 窗口** (写 spec / 出 creative) → Token 到位后推到 Meta |
| 30 | `d7f61501-ad49-4d53-8a8d-7dc71cf5579f` | Best of China (Essentials 主推) — 8 个 ad creative (图+文案) | **FB Sprint 窗口** (Wave 2 Campaign A 6 creative，但 ME 里写 8 个 — Wave 2 实际产出按 spec 6 个) |
| 40 | `1013038d-70d7-4e9f-9618-59d5f0cb7f7b` | Tale of Two Cities (Oct 两团 #1) — 5 个 ad creative | **FB Sprint 窗口** (Wave 2 Campaign B 6 creative) |
| 50 | `6604b6de-4b71-46c0-8bd2-5b2fb9e6174c` | Shanghai & Surroundings (Oct 两团 #2) — 5 个 ad creative | **FB Sprint 窗口** (Wave 2 Campaign C 6 creative) |
| 60 | `0c74cf45-2ee7-4462-b25e-d4874934dbf6` | 上传 CTS 历史客户名单 → 创建 Lookalike Audience | PM (Wave 3 R1 — PII PM 自己上传) |
| 70 | `cd1d6b02-d753-42df-ac21-92cfdaa4cd5f` | Best of China 立即启动 + Oct 两团 6/15 转 ACTIVE | PM + ME 后台 (Token 到位后) |
| 80 | `70ff6e40-aa8f-4ee8-af29-5dcac162f5f1` | 每周一 FDE 复盘 — CPA/CTR/Leads + 调整 | FDE / PM 周度 |
| 90 | `b2ed00e9-92d0-4e07-b442-bfb2918ce69d` | [B3] 验证 G1 leads_count cron 自动回写 | 子牙 (代码已改，等 cron 跑一次) |

### C2 Best of China 主推 + Oct 两团 — Google 广告冲刺 (6 actions)

| sort | action_id | title | 谁负责 |
|---|---|---|---|
| 110 | `f1088b1a-a9b2-454e-abd1-6e7584bb1b41` | CTS Google Ads 账户健康检查 + GA4 link 验证 | **左窗口 Sonnet** (Google Ads UI) |
| 120 | `d07476fe-75b6-4ee5-99f3-06fece1b731d` | 安装 Google Ads conversion tracking (form_submit) | **左窗口 Sonnet** |
| 130 | `646c0363-f970-4875-ae42-a54baa702b5e` | PM 在 Google Ads UI 建 4 Ad Group Search Campaign | **左窗口 Sonnet** (按子牙 ME 数据库 C2 plan_data 配) |
| 140 | `eafbcf7e-ba14-4080-9cee-79b1e78f01a6` | 写 4 套 RSA (Responsive Search Ads) — 每 Ad Group 1 套 | **左窗口 Sonnet** + 子牙提供 headlines + descriptions |
| 150 | `d79b70bb-1cab-44ab-88e8-5003be9294da` | 6/15 Campaign 启动 ACTIVE | PM (Google Ads UI 改 ENABLED) |
| 160 | `7d37f1d2-238f-4c8d-b63f-3e977a240ee2` | 每周一 FDE 手填 outcome 数据回 ME 后台 | FDE / PM 周度 |

### C3 Best of China 主推 + Oct 两团 — 落地页转化冲刺 (5 actions)

| sort | action_id | title | 谁负责 |
|---|---|---|---|
| 210 | `129f988f-a369-4341-b59d-9f7d26592142` | Best of China 主推 + Oct 两团 GA4 转化率 baseline 取数 | **PM** (GA4 UI 取数) |
| 220 | `71b4ee75-0d23-4f52-a57c-725759b68127` | 3 落地页 CRO mockup 设计 spec | **子牙** (已落到 ChinaTravel/docs/me-landing-page-sprint-2026-06-08/02-wave2) → 已 done |
| 230 | `9f0f0bc0-eb29-4cb4-9618-06e671042582` | PM 找开发实现 3 落地页改造 | **落地页窗口** (ChinaTravel `blissful-dijkstra-f81bd3` worktree) |
| 240 | `7a13d212-cee9-4f5d-aee7-fc2e18d2504b` | GA4 form_submit event + UTM 配置 | PM (GA4 + 落地页埋 UTM) |
| 250 | `94230a23-86ac-41b7-8fb1-bf294cd8172c` | 6/15 上线后 7 天 daily CR check | PM 每天 5 分钟 |

### C4 CTS 品牌曝光引擎 — FB+IG 30 天内容矩阵 (7 actions)

| sort | action_id | title | 谁负责 |
|---|---|---|---|
| 310 | `bf2a158f-4c8f-47f2-8511-f05152b82a81` | 4 周 28 篇 post 排期表（5 pillar 配比）| **FB Sprint 窗口** (Wave 1 选题表) |
| 320 | `0ecab45e-a131-4760-b536-1e9943e4a72b` | 第 1 周 7 篇 post 生成（文字+图）| **FB Sprint 窗口** (Wave 1 W1) |
| 330 | `a4a99f7b-661d-44ec-84c3-b8d58cd2a246` | 第 2 周 7 篇 post 生成 | **FB Sprint 窗口** (Wave 1 W2) |
| 340 | `3d909454-b9ac-45ab-811a-d70851ceaa3d` | 第 3 周 7 篇 post 生成 | **FB Sprint 窗口** (Wave 1 W3) |
| 350 | `17641f7d-b735-4d83-8741-3daccf13408c` | 第 4 周 7 篇 post 生成 | **FB Sprint 窗口** (Wave 1 W4) |
| 360 | `4ef08f52-69b5-4fcc-92e9-fc874bba9bb4` | 通过 ME → Publer 自动发布 + FDE 周度 review | PM + **FB Sprint 窗口** Wave 3 |
| 370 | `7094d5ef-0edc-45b3-8e6d-dcbf65e97303` | [B3] 验证 G3 brand_search_volume cron 自动回写 | 子牙 |

### C5 CTS SEO 内容地基 — 中国旅游专家阵地 (10 actions)

| sort | action_id | title | 谁负责 |
|---|---|---|---|
| 410 | `2417e89b-1d9d-4188-8ee7-5911ba7f06b7` | DataForSEO 跑 15 keyword_seeds 真实 ROI 排序 | 子牙 (cron 自动 Mon 02:00 UTC) |
| 415 | `4a942148-fb6b-426d-baa0-c8235e8645d7` | 落地页: /great-wall-tours-nz（机会词 #10 → P1） | **落地页窗口** Wave 1 |
| 418 | `95e9eebe-ec52-4be7-ba02-8b7dca0d159b` | 落地页: /terracotta-warriors-tour-nz（机会词 #14 → P5） | **落地页窗口** Wave 1 |
| 420 | `55b97116-ee9c-4016-b363-caa88d1136fa` | 5 个 SEO 落地页生成 | **落地页窗口** Wave 3 |
| 430 | `964485a3-a0f4-481a-9e6f-3f29e6206b78` | 6 双信号博客 W1-W6 生成 | **落地页窗口** Wave 3 (PM 之前问过博客是否一起做，本表暂归落地页窗口) |
| 440 | `9d27c967-11b3-4f1e-916c-55f7e7d1d2a1` | 5 落地页 ⇄ 6 博客 ⇄ tour 落地页 交叉内链 | **落地页窗口** Wave 3 |
| 450 | `d9dbefe6-2b63-4b35-a180-653fea571a3d` | 全部页面注入 TouristTrip + FAQ schema | **落地页窗口** Wave 1+3 (Wave 1 spec 已要求注入 TouristTrip) |
| 460 | `50233204-bbe9-48ff-93d4-026d74377710` | GSC 周度排名 snapshot + GA4 organic landing 监控 | 子牙 (cron 自动) |
| 470 | `f37fa760-2237-454b-bc90-ee09f35448d0` | 每 30 天 FDE 复盘对照 verdict 标准 | PM / FDE 月度 |
| 480 | `283c1c64-8815-40ea-be4e-248e45e348d8` | [B3] 验证 G2 organic_traffic 新算法回写 | 子牙 |

---

## 🎯 子牙同步官 SOP

### PM 报告后子牙做的事

1. **SELECT 查现状** — 拿当前每个 action 的 status
2. **UPDATE 改状态** — 按 PM 报告改成 `completed` / `in_progress`
3. **跑 verdict 健康总览**：
   ```sql
   SELECT g.title, g.primary_metric_key, g.baseline_value, g.current_value, g.target_value, g.current_value_source
   FROM goals g 
   WHERE g.client_id='c0000000-0000-0000-0000-000000000000' AND g.status='active';
   ```
4. **回 PM**：
   - X 个 action 改 completed / Y 个 in_progress
   - 当前 G1/G2/G3 指标进度
   - 高优先级 blocker (例 META_SYSTEM_USER_TOKEN_CTS 卡 5 个 action)
   - 明天建议优先级

### 子牙不主动改 ME Kanban

子牙不会**自己推断** "今天 Sonnet 应该跑了 C2 健康检查" 然后改 `completed`。**只按 PM 报告改**。

如果 PM 漏报了，PM 下次想起来报，子牙补改。

---

## ⚠️ 子牙边界

- ✅ 子牙改 ME 数据库 action status
- ✅ 子牙跑 verdict 健康总览
- ✅ 子牙提示 blocker
- ❌ 子牙**不主动**问"今天 Sonnet 跑了什么" — 等 PM 报
- ❌ 子牙**不替** PM 操作外部 UI (Meta / Google Ads / Render / Publer)
- ❌ 子牙**不写**外部窗口该写的代码或文案 (那是 FB Sprint / 落地页窗口的事)

---

## 📅 节奏

- **每日**：PM 会话切换前或晚上结束时报一次
- **每周一**：子牙做周度 verdict snapshot — G1 leads_count / G2 organic_traffic / G3 brand_search_volume 变化趋势
- **每月初**：子牙做 30 天 verdict review — 对照 90 天 verdict 标准看是否需要调战线
