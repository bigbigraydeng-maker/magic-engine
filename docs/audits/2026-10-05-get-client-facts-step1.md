# getClientFacts() 第 1 步：说明、威胁模型与切换前统计（A 级，影子并行）

2026-10-05 · 规划原文 v0.3 在分支 `claude/zen-herschel-6ed7a4`（提交 `f836e4332`，尚未进 main）§3「第 1 步」。层级：L1 平台基础设施（读已有的 `master_briefs`+`clients`，不建表、不改迁移、不动 RLS）。

## 契约（`src/lib/client-facts/`）
`getClientFacts(clientId, { callerClientId: string | null })` → `{ok:true, facts} | {ok:false, reason, detail?}`，永不抛异常。
- 只返回结构化对象，不返回 prompt 文本（文本仍只由 `brief-injector.formatBriefForPrompt` 渲染）；每个值带 `source`（表.列）。
- 禁忌三级不拍扁：`redline_phrases`（`clients.brand_redline_phrases`，硬扫）／`topics`（`excluded_topics`，子串）／`tone_words`（`avoid_words` ∪ `brand_voice.avoid_keywords`，只提示）。每级 `status`：`none_configured`／`all_unusable`／`set`；条目只清洗（去零宽字符、控制字符变空格）不截断。
- 出错一律 `ok:false`：查库报错、无生效 brief、行 client_id 对不上、字段格式不对、`brand_redline_phrases` 为 null（该列 NOT NULL，null 只可能是读坏了）。42703（缺列）单列为 `schema_not_ready`。
- `select` 字段白名单；`competitive_notes_md`、`semrush_snapshot`、`source_file_urls`、`competitor_domains`、`brand_story_md`、`style_guide_md` 不读不返回；返回值逐字段挑选。
- 「生效 brief」只此一处：`status='active'` 且 `project_id IS NULL`（`matched_by:'status'`）；回落只认 `is_active=true AND status IS NULL` 的遗留行（`'is_active_fallback'`）。草稿/归档即使 `is_active=true` 也不生效（库默认让 AI 草稿带 true）；并列最高版本 → `ambiguous_brief`。`classifyBriefActivation` 供后续统计。
- 无缓存；`callerClientId` 必填（`null`＝可信服务端流水线，调用方须先过 `requireDashboardClientAccess`）；`clientId` 用宽松 `isUuid`，大小写归一。`detail` 可能含数据库原文，只进服务端日志。

## 威胁与防线（每道防线都有单独测试，45 条人工破坏全部变红）
| 威胁 | 防线 |
|---|---|
| A 客户拿到 B 的字段 | 查询 `.eq` 过滤＋返回前核对 id＋无缓存；两客户互取测试 |
| 草稿/楼盘级 brief 当生效版 | `status='active'`＋`project_id IS NULL`，行级再核 |
| 查库抖动被当成「没禁忌词」 | 任何 error/reject → `ok:false`；「没配」与「读失败」分开 |
| 竞品数据泄进内容 | 字段白名单＋逐字段挑选 |
| 红线词夹隐形字符永远匹配不上 | 条目清洗后再比对 |

## 不做 / 已知没防
不切任何渠道；不碰产品价格、品牌包、`knowledge/read.ts`、发布闸；不扫 `vi_dos`/`vi_donts`/`avoid_keywords` 里夹带的竞品名；下游拼 prompt 要用围栏防语义注入。`keyword-relevance.ts:18` 写死的建材词留作后续清理。
**切换前必须逐消费者对账**：旧 `draft-redlines` 把 redline ∪ avoid_words ∪ excluded_topics 全当硬扫，且取 brief 用 `is_active`＋不过滤 `project_id`、没 brief 时仍返回客户红线、数组含 NULL 元素时过滤而非拒绝；新函数口径更严，差异词要 PM 看过再切。

## 切换前要在生产库跑的 5 条只读统计（语法已在本机沙盘试过，生产没跑）
1 缺列＝少于 11 行（最可能缺 `excluded_topics`，迁移头写「未经 PM 批准不得 apply」）；2 有行＝两列对不上；3 有行＝新函数取不到生效版；4 三个数全 0＝该客户无红线；5 大于 0＝切换前要逐词核对。
```sql
-- 1) 字段在不在（期望 11 行）
select table_name, column_name from information_schema.columns where table_schema='public' and ((table_name='master_briefs' and column_name in ('excluded_topics','avoid_words','project_id','status','is_active','website','source_website_urls','brand_voice','vi_colors')) or (table_name='clients' and column_name in ('brand_redline_phrases','domain'))) order by 1,2;
-- 2) 状态与是否生效两列对不上的客户
select client_id, count(*) filter (where status='active') n_active, count(*) filter (where is_active) n_is_active, count(*) filter (where is_active and status='draft') n_draft_is_active, count(*) filter (where is_active and status is null) n_legacy_null, count(*) filter (where status='active' and not coalesce(is_active,false)) n_active_not_is_active from master_briefs where project_id is null group by client_id having count(*) filter (where status='active')<>1 or count(*) filter (where is_active and status is distinct from 'active')>0 or count(*) filter (where status='active' and not coalesce(is_active,false))>0;
-- 3) 取不到生效版的客户
select c.id, c.domain from clients c where not exists (select 1 from master_briefs b where b.client_id=c.id and b.project_id is null and b.status='active');
-- 4) 三类禁忌各几条
select c.id, coalesce(array_length(c.brand_redline_phrases,1),0) n_redline, coalesce(array_length(b.excluded_topics,1),0) n_topics, coalesce(array_length(b.avoid_words,1),0) n_avoid from clients c join master_briefs b on b.client_id=c.id and b.project_id is null and b.status='active' order by 1;
-- 5) avoid_words 里有、红线名单里没有的词（旧广告路径当硬红线）
select c.id, count(*) avoid_not_in_redlines from clients c join master_briefs b on b.client_id=c.id and b.project_id is null and b.status='active', unnest(b.avoid_words) w where not exists (select 1 from unnest(c.brand_redline_phrases) r where lower(r)=lower(w)) group by c.id;
```
