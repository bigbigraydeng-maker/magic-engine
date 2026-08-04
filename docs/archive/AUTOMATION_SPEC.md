# Magic Engine × Airtable × Zapier × Publer

> 🗄️ **已归档 2026-07-25 — 不要按这份做。**
> 描述的 Airtable × Zapier × Publer 链路已废：Zapier 完全不在代码里，Airtable 正在退役
> （代码仅剩 3 处引用，审核已搬到 `/dashboard/factory`）。现状见 [../STATE.md](../STATE.md)。

## 自动化集成规格文档

**版本：** v1.0  
**日期：** 2026-04-27  
**状态：** 待 Cowork 审阅后开发

---

## 一、系统全景

```
Magic Engine（内部管理后台）
        │
        ├─ 生成关键词 ──────────────► Airtable Keywords 表
        │                                     │
        │                          人工审核 → Status = Approved
        │                                     │
        │         ◄────── Zapier Zap 1 ───────┘
        │         自动调用 /api/content/route-a
        │
        ├─ 生成内容帖子 ─────────────► Airtable Content Calendar 表
        │                                     │
        │                          人工审核 → Status = Approved
        │                                     │
        ├─ 生成视觉素材（图片/视频）               │
        │   生成完成 → 自动回写 Image_URL           │
        │           → Visual_Status = Ready   │
        │                                     │
        │         ◄────── Zapier Zap 2 ───────┘
        │         Status=Approved AND Visual_Status=Ready
        │         自动调用 /api/publer/create-post
        │
        └─ Publer 定时发布到 Facebook / Instagram / TikTok
```

---

## 二、核心组件说明

| 组件 | 角色 | 当前状态 |
|------|------|---------|
| **Magic Engine**（CrazyContent Next.js App）| 内容生产中枢：生成关键词、内容、视觉素材 | ✅ 已开发，本地运行 |
| **Supabase** | 主数据库：存储所有业务数据 | ✅ 已接通 |
| **Airtable** | 人工审核界面 + 自动化触发源 | ✅ 已接通，结构已补齐 |
| **Zapier** | 监听 Airtable 变化 → 触发 Magic Engine API | ❌ 待配置 |
| **Publer** | 社交媒体调度发布工具 | ✅ API Key 已录入 |
| **SEMrush** | 关键词数据来源 | ✅ 已接通 |
| **Atlas Cloud** | 图片生成（Flux-dev）+ 视频生成（Seedance）| ✅ 已接通 |

---

## 三、Airtable 表结构（CTS 客户，Base: appEqUz46L20wy3JX）

### 3.1 Keywords 表（tbloisDvMTVjxAll7）

| 字段名 | 类型 | 用途 |
|--------|------|------|
| Keyword | 文本 | 关键词内容 |
| Status | 单选 | New / Approved / Rejected |
| Opportunity Score | 数字 | SEMrush 机会分 |
| Volume | 数字 | 月搜索量 |
| KD | 数字 | 关键词难度 |
| CPC (USD) | 货币 | 点击成本 |
| Intent | 单选 | informational / commercial / transactional |
| Source | 单选 | SEMrush Related / Gap / Batch |
| Supabase ID | 文本 | 关键词在 Supabase 的 UUID |
| **Client_Supabase_ID** | **文本** | **客户 UUID，Zapier 触发内容生成时使用** ✅新增 |
| Created At | 日期 | 创建时间 |

> **Zapier 触发条件：** Status 变为 `Approved`  
> **Zapier 执行动作：** POST `/api/content/route-a`，Body: `{keyword, client_id, platforms}`

---

### 3.2 Content Calendar 表（tblXzXnPAcM1Y28Ws）

| 字段名 | 类型 | 用途 |
|--------|------|------|
| Title | 文本 | 内容标题 |
| Status | 单选 | Draft / Approved / Published |
| Route | 单选 | Route A / B / C |
| Platforms | 文本 | facebook, instagram, tiktok |
| Script | 长文本 | 视频脚本 |
| Caption | 长文本 | 社交媒体文案 |
| Hashtags | 文本 | 标签组 |
| Visual Brief | 长文本 | 图片生成描述 |
| Source URL | URL | 来源视频链接（Route B）|
| Revision Notes | 长文本 | 修改备注 |
| Supabase ID | 文本 | 帖子在 Supabase 的 UUID |
| **Image_URL** | **URL** | **生成的图片地址，图片完成后自动回写** ✅新增 |
| **Video_URL** | **URL** | **生成的视频地址，视频完成后自动回写** ✅新增 |
| **Visual_Status** | **单选** | **Pending / Generating / Ready / Failed** ✅新增 |
| Published At | 日期 | 发布日期 |
| Published URL | URL | 已发布的社交媒体链接 |

> **Zapier 触发条件：** Status = `Approved` **AND** Visual_Status = `Ready`  
> **Zapier 执行动作：** POST `/api/publer/create-post`，Body: `{post_id}`

---

### 3.3 Visual Assets 表（新建）

| 字段名 | 类型 | 用途 |
|--------|------|------|
| Asset_ID | 文本 | Supabase visual_assets.id |
| Asset_Type | 单选 | image / video / avatar |
| Status | 单选 | generating / ready / failed |
| Asset_URL | URL | 素材存储地址 |
| Content_Post_Title | 文本 | 关联帖子标题 |
| Provider | 文本 | wavespeed / seedance |
| Prompt | 长文本 | 生成 prompt |
| Cost_USD | 货币 | 生成费用 |
| Created_At | 日期 | 创建时间 |

> 用途：追踪所有生成素材，可通过 Dashboard 手动同步或图片生成完成时自动写入

---

## 四、Zapier Zap 配置规格

### Zap 1 — 关键词审批 → 自动生成内容

```
名称: Magic Engine: Keyword Approved → Generate Content

[Trigger]
App:    Airtable
Event:  "Updated Record"（记录更新）
Base:   appEqUz46L20wy3JX（CTS）
Table:  Keywords
Filter: Status = "Approved"

[Filter]（Zapier 内置过滤步骤）
只在 Status 刚变为 Approved 时执行（防止重复）
条件: Status = "Approved"

[Action]
App:    Webhook by Zapier（或 HTTP）
Event:  POST
URL:    https://[APP_DEPLOYED_URL]/api/content/route-a
Headers:
  Content-Type: application/json
Body（JSON）:
{
  "keyword":   "{{Keyword}}",
  "client_id": "{{Client_Supabase_ID}}",
  "platforms": ["facebook", "instagram", "tiktok"]
}
```

**效果：** Airtable 里批准一个关键词 → Magic Engine 自动生成 V1/V2 内容帖子 → 帖子同步回 Airtable Content Calendar（Status: Draft）

---

### Zap 2 — 内容审批 + 视觉就绪 → Publer 发布

```
名称: Magic Engine: Approved + Visual Ready → Publer

[Trigger]
App:    Airtable
Event:  "Updated Record"（记录更新）
Base:   appEqUz46L20wy3JX（CTS）
Table:  Content Calendar

[Filter]（Zapier 内置过滤步骤）
条件（两个条件同时满足）:
  Status        = "Approved"
  Visual_Status = "Ready"

[Action]
App:    Webhook by Zapier（或 HTTP）
Event:  POST
URL:    https://[APP_DEPLOYED_URL]/api/publer/create-post
Headers:
  Content-Type: application/json
Body（JSON）:
{
  "post_id":     "{{Supabase ID}}"
}
```

**效果：** Content Calendar 里的帖子 Status=Approved 且图片生成完成 → 自动推送到 Publer → Publer 按预设时间发布到 Facebook/Instagram/TikTok → 发布后回写 Publer Post ID

---

## 五、Magic Engine API 接口说明（Zapier 调用）

### POST `/api/content/route-a`
**触发者：** Zap 1  
**鉴权：** 无（内网部署，通过 Zapier IP 白名单控制；或后续加 Bearer Token）  
**Request Body：**
```json
{
  "keyword":   "New Zealand travel packages",
  "client_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "platforms": ["facebook", "instagram", "tiktok"]
}
```
**Response：**
```json
{
  "success": true,
  "saved_posts": [
    { "id": "...", "title": "...", "caption": "..." },
    { "id": "...", "title": "...", "caption": "..." }
  ]
}
```

---

### POST `/api/publer/create-post`
**触发者：** Zap 2  
**Request Body：**
```json
{
  "post_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```
**后端逻辑：**
1. 查询 Supabase `content_posts` 获取 caption、hashtags、platforms
2. 查询 `visual_assets` 获取 ready 状态的图片/视频 URL
3. 调用 Publer API 创建定时帖子
4. 更新 Supabase `content_posts.status = 'scheduled'`
5. 回写 Airtable Content Calendar：Status = Published，Published URL = Publer Post ID

**Response：**
```json
{
  "success": true,
  "publer_post": { "post_id": "...", "status": "scheduled" }
}
```

---

## 六、每日工作流（部署后的完整链路）

```
┌────────────────────────────────────────────────────────┐
│                    每日工作流（30-45 分钟）               │
├────────────────────────────────────────────────────────┤
│                                                        │
│  9:00  [Dashboard → Keywords]                          │
│        选客户 → 选模式（Related / Gap）→ Fetch SEMrush   │
│        → 关键词自动同步到 Airtable Keywords 表           │
│                                                        │
│  9:15  [Airtable Keywords]                             │
│        人工浏览关键词列表 → 点 Status 改为 Approved      │
│        ↓ Zapier Zap 1 自动触发（几分钟内）              │
│        Magic Engine 生成 V1 + V2 内容帖子               │
│        → 帖子出现在 Airtable Content Calendar（Draft）  │
│                                                        │
│  9:30  [Airtable Content Calendar]                     │
│        人工审阅内容 → 可直接修改文案 → Status 改 Approved │
│                                                        │
│  9:35  [Dashboard → Visuals]                           │
│        选帖子 → 生成图片（Flux-dev，约 30 秒）            │
│        → 图片完成 → 自动回写 Image_URL + Visual_Status   │
│        ↓ Zapier Zap 2 自动触发（几分钟内）              │
│        → 推送到 Publer → 按排期时间发布                  │
│                                                        │
│  全自动 [Publer]                                       │
│        按预设时间段发布到 Facebook / Instagram / TikTok  │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## 七、待开发 / 待配置清单

### 7A — 需要 Cowork 配置（无需写代码）

| 编号 | 任务 | 平台 | 优先级 |
|------|------|------|--------|
| Z-1 | 新建 Zap 1：Keywords Approved → route-a | Zapier | 🔴 高 |
| Z-2 | 新建 Zap 2：Content Approved + Visual Ready → Publer | Zapier | 🔴 高 |
| P-1 | 在 Publer 连接 Facebook / Instagram / TikTok 账号 | Publer | 🔴 高 |
| P-2 | 确认 Publer API 返回的 `platforms` 字段格式（是 ID 还是 slug）| Publer API | 🟡 中 |

### 7B — 需要开发（代码）

| 编号 | 任务 | 文件 | 优先级 |
|------|------|------|--------|
| D-1 | 部署 Magic Engine 到 Render，更新 `NEXT_PUBLIC_APP_URL` | 部署 | 🔴 高 |
| D-2 | Zapier 安全鉴权：给 `/api/publer/create-post` 和 `/api/content/route-a` 加 Bearer Token 验证 | API 路由 | 🟡 中 |
| D-3 | Publer 发布后回写 Airtable Content Calendar（`Published URL` 字段）| Webhook 或 Publer 轮询 | 🟡 中 |
| D-4 | 内容自动同步到 Airtable（现在是手动点 ↑ Airtable 按钮）| route-a/route-c 生成后自动调用 sync | 🟠 低 |
| D-5 | Route B（病毒视频改写）完整实现 | `/api/content/route-b` | 🟠 低 |
| D-6 | HeyGen 数字人视频接入（需要 API Key）| `/api/visual/avatar` | 🟠 低 |

### 7C — 上线前检查项

- [ ] `NEXT_PUBLIC_APP_URL` 改为生产 URL
- [ ] Publer 账号连接验证（Facebook / Instagram / TikTok）
- [ ] Zapier 两条 Zap 测试通过
- [ ] Airtable Keywords 的 `Client_Supabase_ID` 字段确认有值（下次关键词同步后自动填入）
- [ ] 确认 CTS 客户的 `airtable_base_id` 在 Supabase 中已正确设置

---

## 八、数据流向图（完整）

```
DataForSEO API
    ↓
/api/keyword-intelligence/related-keywords
    ↓
Supabase: keywords 表
    ↓ 手动点击 "↑ Airtable"
Airtable: Keywords 表
    ↓ 人工 Status → Approved
Zapier Zap 1（Airtable Watch）
    ↓
/api/content/route-a（OpenAI GPT-4o-mini 生成）
    ↓
Supabase: content_posts 表（status: draft）
    ↓ 手动点击 "↑ Airtable"（或 D-4 实现自动）
Airtable: Content Calendar 表（Status: Draft）
    ↓ 人工 Status → Approved
/api/visual/image（Atlas Cloud Flux-dev）
    ↓ 生成完成
Supabase: visual_assets 表（status: ready）
    ↓ 自动回写
Airtable: Content Calendar（Image_URL + Visual_Status: Ready）
    ↓ Zapier Zap 2 触发
/api/publer/create-post（Publer API）
    ↓
Publer 调度发布 → Facebook / Instagram / TikTok
    ↓（发布后）
Airtable: Content Calendar（Status: Published）
```

---

## 九、当前已完成的技术工作（供参考）

**后端 API（全部已开发）：**
- `/api/clients` — 客户管理 CRUD
- `/api/keyword-intelligence/related-keywords` — DataForSEO 关键词抓取
- `/api/content/route-a` — 关键词 → 内容生成
- `/api/content/route-b` — 病毒视频 → 内容改写（框架完成）
- `/api/content/route-c` — Master Brief + Topic → 内容生成
- `/api/content/save` — 保存生成内容
- `/api/visual/image` — 图片生成（Flux-dev via Atlas Cloud）
- `/api/visual/video` — 视频生成（Seedance via Atlas Cloud）
- `/api/visual/status/[assetId]` — 轮询生成状态 + 自动回写 Airtable
- `/api/airtable/sync-keywords` — 关键词同步到 Airtable
- `/api/airtable/sync-content` — 内容同步到 Airtable
- `/api/airtable/sync-visuals` — 视觉素材同步到 Airtable
- `/api/publer/create-post` — 推送到 Publer 发布

**Admin Dashboard（全部已开发）：**
- `/dashboard` — 概览（统计数据 + 最近内容）
- `/dashboard/clients` — 客户管理
- `/dashboard/clients/[id]` — 客户详情 + Master Brief 编辑
- `/dashboard/keywords` — 关键词面板（Fetch + 审核）
- `/dashboard/content` — 内容看板（筛选 + 详情 + Airtable 同步）
- `/dashboard/content/generate` — 内容生成（Route A/B/C）
- `/dashboard/visuals` — 视觉生成操作台（图片 + 视频）

---

*文档由 Claude 生成，供 Cowork 审阅。审阅通过后开始 D-1 ~ D-4 开发任务。*
