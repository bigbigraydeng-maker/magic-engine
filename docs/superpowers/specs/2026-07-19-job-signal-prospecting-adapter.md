# Spec: 招聘信号 Prospecting 进料口（Job-Board Discovery Adapter）

**作者**：子牙（Claude Code） · **日期**：2026-07-19 · **状态**：v2 已并入 魏征 + 板桥 复审 → 待 PM 拍板
**归属**：Phase 35（司马徽 outbound prospecting）的**新增发现源**，不新建 Phase

---

## 0. 复审判决（v2 修订，2026-07-19）

**魏征（架构）= GO-with-fixes**：抓到 2 个 spec 自己没意识到的 BLOCKER。
**板桥（C 端/合规）= GO-with-guardrails**：5 条护栏。全部并入下方。

### BLOCKER（动手前必解，魏征）
- **B1 · `industry` 列禁填真实行业**：`analyze.ts:170` 把 `industry` 当 seed key 查 `INDUSTRY_LABELS`，填 Places types 会让 GEO probe 变成「best point of interest in…」垃圾问句。→ **改：`industry` 列填合法 seed key（新增 `job_signal` seed key，同步进 `INDUSTRY_SEARCH_LABEL`+`INDUSTRY_LABELS`+grep 全仓 industry 读取点）；真实行业存 `raw_listing.hiring_signal.resolved_industry`**。§5 原决策**反转**。
- **B2 · `city` 列禁填自由文本**：下游把 `city` 当 `CITY_COORDS` seed key。→ **改：`resolve.ts` 把招聘 location 归一到最近 seed key（Manurewa→`south_auckland`），归一不到落 `other`；原始文本只进 `hiring_signal.location_raw`**。

### HIGH（强烈建议一并解决）
- **H1 · attach 竞态**：禁止 select-整行→JS merge→update-整行（会覆盖 sweep 刚写的 `ai_report`）。→ **Phase 1 采「只落独立记录、不 UPDATE 主行」；或用 Postgres `raw_listing || jsonb_build_object(...)` 原子 merge**。
- **H2 · 单公司 Places 误配 = 事故级**（给错公司发冷邮件）。→ **`resolveCompanyViaPlaces` 改「默认拒绝、高置信才 insert」**：公司名 token 强重叠 / job 帖 domain 与 Places domain 一致 / 同城，三选二命中才算高置信；多候选得分接近 = 歧义拒绝；无 domain 兜底。**红线：宁漏配不错配**。
- **H3+M1 · 招聘公司被打「太高分」**（不是太低）：`score.ts` 业务强度 24 分中大公司先到手，模型设计前提「industry leaders 不买 rescue」与招聘源冲突。→ **Phase 1 就加 `discovery_source TEXT DEFAULT 'places'` 单列**（给招聘源独立打分/看板/归因），且防 `DAILY_ANALYZE_CAP=100` 被虚高分招聘 prospect 挤占真 SMB 预算（M2）。**「零 migration」卖点放弃，改「一列 migration」。**
- **L2→HIGH · dark-ship 开关**：招聘 cron 加 `JOB_SIGNAL_INGEST_ENABLED` master switch（对齐现有 sweep），防一 merge 就对外接触真公司。

### 护栏（板桥，写进 ingest 逻辑 + outreach 模板）
1. **招聘信号只做幕后选靶，绝不进邮件文案**（防监控感）。
2. **联系邮箱只走 Places/官网解析，招聘页 `careers@`/`hr@` 一律不入库不外发**（守 UEMA 2007 默示同意）。
3. **招聘源单独看板 + 规模过滤**：招全职 senior Marketing Manager 的大公司降权；优先招兼职/coordinator/初级社媒的小公司。
4. **文案换协作腔**（「你在补营销、我们帮你加速」），禁踩「招人难/招人贵」。
5. **禁提 AI/供应商真名**，「扫官网」改「我看了下你官网」+ 真人签名。

### 业务判断（子牙定 + PM 可挑战）
- **「正在招 marketing 岗」是正信号还是负信号？** 裁决：**分层** —— 招**初级/兼职/coordinator/单一社媒岗**的小公司 = **强正信号**（要能力但养不起全职→外包目标）；招**全职 senior Marketing Manager/Head of Marketing**的大公司 = **负信号**（在自建团队）。编码进 filter：job seniority + review_count 规模双闸。

---

## 1. 背景 & 已验证事实（SQL 实测，非口报）

- Phase 35 prospecting 流水线**已在生产运行**：`outbound_prospects` 表实存，含 audited 647 / outreach_ready 513 / qualified 278 / contacted 113 / replied 1 / discovered 12。约 2000 行真实数据。
- 现有**唯一发现源 = Google Places**（按 `行业×城市` 撒网，`discoverBusinessesViaPlaces`）。
- 下游全链路已建且复用：`audit.ts`（规则审计）→ `score.ts`（0-100，阈值 45）→ `analyze.ts`（张骞短模式 4 支柱 ~$0.15）→ `report.ts` → `outreach.ts`（合规邮件，固定 footer + opt-out，**永不自动发**）→ admin UI（CRM/Pipeline/Outreach 三 tab）→ opt-out 合规。
- **招聘信号进料 = 零，且不在 Phase 35 原范围**。这就是本 spec 要补的唯一缺口。

## 2. 目标

给现有流水线接一个**新发现源**：NZ 招聘广告（Seek/Indeed/TradeMe）里刊登 Marketing/Website/Facebook/社媒/SEO/广告 岗的公司 = 已确认有营销需求的高意向 prospect → 解析成公司 → 以 `status='discovered'` 喂进 `outbound_prospects`，下游一行不改，自动审计/打分/分析/出邮件。

## 3. 非目标（红线）

- ❌ 不碰下游任何 money-path 代码（audit/score/analyze/outreach/pipeline 的既有函数、既有 API 路由、既有 cron sweep 逻辑）。
- ❌ 不新建重复的表/UI/CRM/外呼——全复用。
- ❌ 不自动发邮件（继承现有人工审批闸）。
- ❌ 不改现有 `discovered` 下游状态机。

## 4. 架构：进料口 = `discoverAndInsert` 的兄弟函数

现有 `discoverAndInsert({industry, city, limit})`（pipeline.ts:242）产出 `discovered` 行。我加一个**并列**的 `ingestJobSignals()`，产出**同样形状**的 `discovered` 行，下游无差别接手。

```
Seek/Indeed/TradeMe (Apify)
      │  scrapeJobBoards(keywordPool, 'NZ')
      ▼
raw job postings  { company, title, location, board, url, keyword_matched }
      │  ① 去噪：剔招聘中介 + 营销 agency（公司名 regex + classification）
      ▼
      │  ② 去重到公司（一家公司多岗 → 1 条）
      ▼
      │  ③ 公司解析：resolveCompanyViaPlaces(name, location)
      │     → place_id / domain / phone / rating / review_count / types→industry
      │     解析不到 → 丢弃并记 skip 原因（不硬塞）
      ▼
      │  ④ 去重 outbound_prospects（place_id / domain）
      │     已存在 → 把 hiring_signal 追加进该行 raw_listing（交叉信号增强，不建 dup）
      │     新公司 → insert status='discovered'
      ▼
outbound_prospects (discovered)  ── 现有 auditBatch/analyzeBatch/draftBatch 自动接手
```

## 5. 数据模型决策（分两阶段，降风险）

**Phase 1（MVP，零 migration）**：招聘信号存进**现有 `raw_listing` JSONB** 的 `hiring_signal` 子对象：
```json
raw_listing.hiring_signal = {
  board: 'seek', job_title: 'Digital Marketing – Facebook & Google',
  job_url: '...', keyword_matched: 'facebook ads', icp_bucket: ['smb_local'],
  posted_at: '2026-07-07', location_raw: 'Manurewa, Auckland', discovered_at: '...'
}
```
- 优点：**零 schema 改动、零 PM migration 闸、零前端 type 同步**，直接跑通端到端验证真实转化。
- `industry` 列填 Places `types` 解析出的真实行业（下游 GEO probe「best <industry> in <city>」需要真行业）。

**Phase 2（验证有效后再做，需 PM migration）**：加 `discovery_source TEXT DEFAULT 'places'` 列区分来源 + 可选 `prospect_hiring_signals` 子表（一家公司随时间多个招聘信号，append-only）。用于分析/看板筛选/长期去重。**本 spec 只交付 Phase 1**；Phase 2 单独登记。

## 6. 待建组件（新文件，全部隔离，不改既有文件）

| 文件 | 职责 |
|---|---|
| `src/lib/prospecting/job-boards/scrapers.ts` | 复用 `src/lib/apify/client.ts` `runActorAndGetResults`，封装 Seek(`bovi/seek-jobs-scraper` 已实测)/Indeed/TradeMe 三个 actor，产出统一 `JobPosting` 形状 |
| `src/lib/prospecting/job-boards/filters.ts` | 去噪：`isAgencyOrRecruiter(company, classification)`（公司名含 Digital/Marketing/Media/Recruitment/Creative/Agency + classification=Advertising 判定）；ICP 分桶 `tagIcpBuckets()` |
| `src/lib/prospecting/job-boards/resolve.ts` | `resolveCompanyViaPlaces(name, location)`：单公司 Places Text Search → details → BusinessListing 形状。镜像现有 `business-discovery.ts` 逻辑（复用同 API key / SSRF 无关 / 同 chain blocklist） |
| `src/lib/prospecting/job-boards/ingest.ts` | `ingestJobSignals({keywords, maxPerBoard})`：串起 scrape→filter→resolve→dedup→insert/attach，产出 `discovered` 行。镜像 `discoverAndInsert` 的 dedup+insert 段 |
| `src/app/api/cron/job-boards-weekly/route.ts` | 独立周 cron（CRON_SECRET Bearer + startCronRun/finish），只做进料。**不改**现有 `prospecting-sweep`——进料后由既有 sweep 自然接力 audit/analyze/draft |
| `src/app/api/admin/prospecting/ingest-jobs/route.ts` | 手动触发进料（admin，async 202，镜像 `discover` 路由），供 PM 在 UI 点一下即时拉 |
| `render.yaml` | 加一条 cron `job-boards-weekly`（Mon 02:00 UTC ~ 周一下午 NZST），env: CRON_SECRET + APIFY_API_KEY |

**UI**：Phase 1 复用现有 admin prospecting 页——招聘来的 prospect 走同一 CRM/Outreach 队列，`raw_listing.hiring_signal` 在详情抽屉多显示一行「招聘信号来源」。加一个「拉招聘信号」按钮（对称 discover 按钮）。

## 7. 关键词池 & ICP 配置

- **Phase 1**：env 变量 `JOB_SIGNAL_KEYWORDS`（默认已实测校准的池：`digital marketing, social media, facebook ads, google ads, marketing manager, marketing coordinator, seo, content marketing, ecommerce, paid media`）+ `JOB_SIGNAL_CITIES`。**与现有 `SWEEP_INDUSTRIES/SWEEP_CITIES` 同 pattern**（ME 内部 admin 配置，非客户级 FDE 字段，env 可接受）。
- **AI 可见度/GEO 关键词明确排除**（实测 40 条全是技术工程岗噪音，NZ 无此招聘信号——它是 upsell，不是进料信号）。
- **Phase 2 可选**：admin 页做关键词池可视化编辑器（chip+add，复用 `PrimaryKeywordsPanel` 模板）。

## 8. 合规（继承 + 一个新问题给板桥）

- 外呼继承现有 `outreach.ts`：固定 footer + 真人名 + opt-out link，**永不自动发**，opted_out 终态拦截。NZ Unsolicited Electronic Messages Act 2007 已被现有机制覆盖。
- **新问题（板桥定）**：邮件钩子要不要**明说**「注意到你们在招 X 岗」？
  - 正面：极强个性化、证明我们懂它需求。
  - 风险：部分老板会觉得「你在盯我招聘」有点毛/侵入感。
  - 备选：不点破招聘，只用审计证据（「扫了你官网，SEO 这块…」），招聘信号仅用于**内部选靶**不进文案。

## 9. 成本

- Seek/Indeed/TradeMe Apify 扫描：实测 ~$0.001/岗，一周全池 ~几百岗 = 几毛钱。
- 公司解析 Places：~$0.05/公司（Text Search + Details）。
- 下游审计/分析：继承现有 ~$0.005 + ~$0.15/合格 prospect（已有预算闸）。

## 10. 待复审的开放问题

1. **魏征**：`resolveCompanyViaPlaces` 单公司解析——名字歧义（如「KIWI NZ VENTURE」查无实体）误配到错误 business 的风险？要不要域名二次校验（job 正文里的公司官网 vs Places 返回的 domain 一致性）？
2. **魏征**：交叉信号 attach 到已存在 prospect 行——并发/竞态（sweep 正在改同一行 status）会不会覆盖？用 raw_listing 局部 merge 还是乐观锁？
3. **魏征**：独立 cron vs 扩展 sweep——独立 cron 进料后，sweep 的 `pickStage` 会不会因为突然多出一堆 discovered 就长期饿死 discover 段？（现有有 rotation/cooldown 逻辑，需确认不被打乱）
4. **板桥**：招聘信号是否进邮件文案（§8）。
5. **板桥**：招聘来的 prospect 与现有「本地服务 SMB」画像不同（可能是中大公司），现有 score 阈值 45 是否适配？要不要给招聘来源单独看板过滤？

## 11. Rollout

1. spec 复审通过 → PM 拍板（Phase 1 无 migration，不需 migration go；只需方向 go）。
2. 建 4 个 lib 文件 + 2 个路由 + render.yaml，独立分支 `feat/phase-35-job-signal-ingest`。
3. 本地对 Seek 真实数据跑 `ingestJobSignals` dry-run（不写库）验证 filter/resolve。
4. 小批真写库（如 10 家）→ 看现有 sweep 是否自动审计/出邮件 → 人工看 outreach 队列质量。
5. 魏征复审代码 + 狄仁杰（若碰并发/隔离）→ PR → PM `go merge`。
6. Phase 2（column + 子表 + UI 编辑器）单独登记，视 Phase 1 效果再启。
