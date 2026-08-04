# 内容工厂 — 遗留仓库全量迁移/对账计划 v0.1

> 2026-07-12 起草(子牙)。触发:PM 拍板存储走 Supabase 后追加「把遗留仓库都一起搬,
> 包括 Airtable 已经做好的设置」。本文 = 完整家底盘点 + 旧→新对账 + 分步执行(标不可逆)。
> **配套决策备忘**:`2026-07-12-content-factory-storage-decision-v0.1.md`(一个仓库两道门)。
> **执行纪律**:动生产 Airtable/Dropbox 前必 PM 显式 go;非破坏步骤先做,破坏步骤(删表/删源)最后单独授权。

---

## 0. 家底盘点(2026-07-12 实测)

### 0.1 三个物理仓 + 内容量

| 仓 | 位置 | 现有内容 | 角色 |
|---|---|---|---|
| **Supabase** | bucket `content-factory` + 5 张工厂表(项目 glbdnayojixmexgofbsd) | video_clips **3** / winner **0** / signals **3** / 工单 **2** / 台账 **2**(基本空,只有 M2 验收种子) | 代码真正读写 = **将来的权威源** |
| **Dropbox** | `~/Dropbox/MagicLab_Studio/` | CTS reels-clips **15** + footage/ai **44**;Oztop i2v_out **13**;音乐 **19**;成片 CTS **6** / Oztop **31**;各客户 brandkit/projects/archive | 手工工作室 + Make 监听 = **将来降级为工作台** |
| **Airtable** | CTS base `app8Hlx28jAfGabdH`(20 表)+ ME Factory Ops `app6EUitwQEv8Oukk`(2 表)+ Oztop workspace(**待盘**) | 见 §0.2 | 人的视图/控制层 |

### 0.2 Airtable 现有表分类(CTS base app8Hlx28jAfGabdH)

**A. 工厂镜像表(占位契约,真实表建好前的替身)** — 迁移主战场:
- 📡 内容需求信号 `tblN6FsXhvqm7nBiL` ↔ Supabase `content_demand_signals`
- 🏭 内容工单 `tblhnHiDXsM9PKsBp` ↔ `content_work_orders`(标榜"Kanban 驾驶舱")
- 🏆 Winner 结构库 `tbl6XCuNRnlwaCvch` ↔ `winner_structures`

**B. 素材编目(真实策展价值:tag/mood/attribution + Dropbox 链接)** — 要保住策展、改权威源:
- Clips `tblH5RyXMd5sIdreu`(素材库,链 Content Production + 工单)
- Music `tblfKcfW4aHRXkdWl`(19 首,energy/brightness/分段)
- Characters `tblIiNJUungAncyum` + Assets `tblfo4a8qJhmARhB5`(数字人 Alex 等)
- Storyboard `tblsVzVhPYb01z2XM` / CTS 广告脚本 `tblNkrnFpWX0RCqJh` / CTS I2V Clips `tblJUdOzoI9KrXQ3S` / CTS 成片混剪 `tbluk2fO6qoBlEN4w`

**C. 真业务数据(不属工厂,只保不动)** — 迁移禁区:
- Content Production `tblxlxdCs6epdl6ux`(已发布 Reel 记录 + Publer URL)
- UTM Builder `tblArK6q5Bxq3wzfw`(活跃广告链接)
- Meta Ads Daily / Goals Progress / Decisions Log
- NewAsian 三表(另一个客户,与工厂无关)

**D. 我新建的(工厂审核层)**:ME Factory Ops `app6EUitwQEv8Oukk` — 🎬 Factory Review `tblAjJn4fDKGL7RPN` + 🏆 Winner Intake `tbl7MrlWX7RuaXS16`(+ 审核人 singleCollaborator 列已建)。

---

## 1. 目标架构:三层,单一权威

```
┌── 权威源(操作真相)= Supabase ───────────────────────────────┐
│  表: video_clips · winner_structures · content_demand_signals │
│      content_work_orders · factory_balance_ledger            │
│  bucket content-factory: clips/ · renders/ · brandkit/       │
│  ← 代码唯一读写处。所有"工厂要 reason 的东西"以此为准         │
└───────────────┬──────────────────────────┬──────────────────┘
        sweeper 双向镜像              worker 读写(签名 URL)
                │                          │
┌── 人的视图/控制层 = Airtable ──┐   ┌── 手工工作台 = Dropbox ──┐
│ · ME Factory Ops(审核/花钱闸)│   │ · 手工剪辑/projects/scratch│
│ · CTS base 素材编目(浏览)     │   │ · keeper → 单向灌进 Supabase│
│   = Supabase 的镜像,非并行真相 │   │ · Make 监听(过渡期保留)    │
└───────────────────────────────┘   └───────────────────────────┘
```

**铁律**:凡工厂要 reason 的(clip 库/winner/信号/工单/成片二进制)——**Supabase 唯一真相**;
Airtable 是**视图 + 少数控制点**(审核过/打回、Winner 人工录入),不是并行真相源;Dropbox 是**工作台**,keeper 单向流入 Supabase,工厂从不写回 Dropbox。

---

## 2. Airtable 逐表处置(对账核心)

| 现表 | 处置 | 做法 | 可逆? |
|---|---|---|---|
| 📡 内容需求信号(镜像) | **退役** | 真实源=Supabase `content_demand_signals`;信号本就由 API/内部自发写入,不需人工 Airtable 入口。历史仅 DEMO 行(可删)。归档为只读视图或删表 | 删表不可逆·**需 go** |
| 🏭 内容工单(镜像) | **退役→ 迁 ME Factory Ops** | 工单人看板统一到 ME Factory Ops(审核卡已是工单视图);sweeper 已驱动。此表 DEMO 行迁走后归档 | 删表不可逆·**需 go** |
| 🏆 Winner 结构库(镜像) | **退役** | 真实源=Supabase `winner_structures`;人工录入走 ME Factory Ops 的 🏆 Winner Intake(已建) | 删表不可逆·**需 go** |
| Clips 素材编目 | **改为 Supabase 镜像(保留)** | ①现有行的策展(Content Tags/Source/Attribution/Duration)一次性迁进 `video_clips.source_meta` + 对应列 ②此表改由 sweeper 从 video_clips 单向刷新(人浏览用)③Dropbox 链接列 → 逐步换 Supabase 公开 URL | 非破坏(先加不删) |
| Music 编目 | **保留为编目(暂不进 Supabase)** | 音乐不是工厂 reason 对象(worker 按 music_mood 从本地/bucket 选)。保留 Airtable 编目;文件随 brandkit 进 bucket(S3) | 非破坏 |
| Characters / Assets / Storyboard / 广告脚本 / I2V Clips / 成片混剪 | **保留不动(手工工作室资产)** | 这些是手工创作台的策展/脚本,非工厂操作表。**保持现状**;仅 I2V Clips 的真实成片文件随 §3 灌进 video_clips(编目行保留链) | 不动 |
| Content Production / UTM / Meta Ads Daily / Goals / Decisions / NewAsian | **禁区·完全不动** | 真业务数据 + 别的客户。迁移绝不触碰 | 不动 |
| ME Factory Ops(🎬/🏆) | **保留 = 工厂控制层** | 花钱审核闸的隔离 base(spec F5),sweeper 已接。工单 Kanban 也归这儿 | 保留 |

**关键决定(子牙定,PM 可挑战业务影响)**:工厂的人看板/审核统一到 **ME Factory Ops base**(隔离花钱闸);CTS base 的三张镜像表退役;CTS base 的**素材编目 Clips 表保留但降级为 Supabase 镜像**,其余手工资产表原样不动。

---

## 3. 二进制素材迁移(Dropbox → Supabase bucket + video_clips)

**范围**:工厂要复用的 clip(不含成片、不含手工 project 中间件)。
- CTS:reels-clips 15 + footage/ai 里真实 i2v(非 Ken Burns 静图)→ `clips/a-real|b-generated/{cts}/`
- Oztop:i2v_out 13 → `clips/.../{oztop}/`
- 每条打 `scene_tag`/`track`/`motion_type`,策展元数据从 Airtable Clips 表迁进 `source_meta`
- 工具:`scripts/factory-worker/ingest-clip.mjs`(§ 决策备忘 S2),幂等按 `source_meta.origin` 去重
- **成片(CTS 6/Oztop 31)不进 clip 库**;若要归档进 `renders/` 或保留 Dropbox,S4 再定

**Oztop client_id 待确认**:seed 前查 `clients` 表拿 Oztop 真实 id(不硬编)。

---

## 4. 执行分期(非破坏在前,破坏在后)

| 阶段 | 动作 | 破坏性 | PM go? |
|---|---|---|---|
| **S0 补盘** | 盘 Oztop workspace 的 base/表;确认 CTS/Oztop client_id;导出 CTS base 三张镜像表现有行(存证再退役) | 只读 | 否 |
| **S1 素材入库** | §3 ingest:Dropbox 真实 clip → Supabase bucket + video_clips(策展元数据带上);worker 改指 MagicLab_Studio 权威引擎(治没音乐/素材糙) | 只增 | 否(纯新增) |
| **S2 编目镜像** | 建 sweeper 支线:video_clips → CTS base Clips 表单向刷新;Clips 表加 Supabase URL 列 | 只增 | 否 |
| **S3 工单/审核统一** | ME Factory Ops 补工单 Kanban 视图;确认审核闭环(需 Render 配 AIRTABLE_API_KEY + CRON_SECRET) | 只增 | 否(但依赖 §M2 收尾) |
| **S4 退役镜像表** | CTS base 📡🏭🏆 三表:导出存证 → 删除(或改隐藏归档) | **删表不可逆** | **是·显式 go** |
| **S5 Dropbox 降级** | 手工成片/发布链路迁 Supabase 公开 URL,退役 rlkey + Make 监听;brandkit 进 bucket | 改手工习惯 | **是·单独议** |

---

## 5. 风险与护栏

1. **误删真业务数据** → §2 禁区表清单硬约束;S4 只碰 3 张镜像表,删前必导出存证(存 `docs/superpowers/archive/`)。
2. **Airtable 现有关联断裂** → Clips 表被 Content Production/工单 link 引用;改镜像时**只加列不删列不改主键**,link 保留。
3. **多客户串味** → NewAsian/Oztop 数据隔离;ingest 按 client_id 分路径,绝不混。
4. **迁移中工厂在跑** → S1-S3 全程 video_clips 只增不改,worker 照常;S4 退役镜像表不影响 Supabase 真实表。
5. **不可逆红线** → 删任何 Airtable 表 / 删任何 Dropbox 源文件 / 改 Content Production 结构 = 必 PM 显式 go(继承 CLAUDE.md migration 强约束精神)。

---

## 6. 我下一步做什么(等 PM 一句话)

**PM 拍板存储方向 go 后,S0+S1 立即启动(全程非破坏、纯新增)**:
1. 盘 Oztop base + 确认两客户 client_id(只读)
2. 导出 CTS base 三镜像表现有行存证
3. 写 `ingest-clip.mjs`,把 Dropbox 真实 clip(CTS 15 + Oztop 13)灌进 Supabase + 迁策展元数据
4. worker 改指 MagicLab_Studio 权威引擎(顺带修没音乐/素材糙)

**S4(删镜像表)/S5(动 Dropbox 发布习惯)不在首批**,做到那步单独找你显式授权。

---

**待 PM 拍板两件**:
1. **存储方向**(决策备忘那条):素材仓库认 Supabase、Dropbox 降工作台 —— go?
2. **本迁移计划 §2 处置表**(尤其 CTS base 三镜像表退役 + Clips 表降级镜像)—— 认可?有禁区要加?

关联:[[project-content-factory-ads-loop]] · [[project-video-brandkit-pipeline]] · [[project-social-video-i2v-muapi]]
