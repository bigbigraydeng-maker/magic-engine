-- playbook_staleness_findings —— 7 本跨客户经验手册（Claude 持久记忆，不在这个仓库）
-- 每周巡检的落地表。
--
-- WHY
-- ---
-- 手册里经常点名具体代码位置（"封装在 src/lib/dataforseo/serp.ts 的 getSerpPage()"这类），
-- 代码重构之后这些引用会悄悄失效，但没有任何机制会回头核对，PM 也不想为这件事常驻开
-- 一个窗口盯着。一个每周跑一次的 Claude scheduled task（不是这个仓库里的代码 —— 只有
-- 本地环境同时摸得到手册文件和这个代码仓库）读 7 本手册、grep 仓库核实引用是否还在，
-- 把"疑似过期"的线索 POST 给 /api/cron/playbook-staleness-weekly 落库，再由现有的
-- pm-daily-todo 管道读出来送进 PM 的今日待办（DEV_OWNED_KINDS 栏，因为"手册要不要改"
-- 是技术判断不是 PM 的业务决策）。
--
-- 形状选「全量快照，每周整表替换」，不是「按状态字段流转的工单表」，理由（设计审
-- 2026-09-24，子牙+魏征两轮独立审出的同一个结论）：
--   1) 自愈：一条引用如果这周被人改好了，下一次巡检就不会再点它的名，DELETE-then-
--      INSERT 让它自己从表里消失 —— 不需要任何人手动把 status 从 open 改成 resolved。
--      早先设计过"status + 部分唯一索引去重"的方案，被挑刺审当场指出两个硬伤：
--      (a) 没有人会去把 status 改掉，这一栏只会越堆越大；
--      (b) `UNIQUE (...) WHERE status='open'` 这种部分索引跟 PostgREST 的
--          `on_conflict=` 参数不兼容（on_conflict 只按普通列名做索引推断，推断不到
--          带 WHERE 谓词的部分索引），upsert 会每次报错。全量替换 + 这里这个不带
--          WHERE 的普通 UNIQUE 约束，两个问题一起绕开。
--   2) 没有 client_id —— 这是 ME 自己的基础设施状态（手册维护），不属于任何客户，
--      长成 seo_patrol_findings 那种客户级 finding 表反而是语义污染。
--
-- 巡检任务本身有没有按时跑，不在这张表里管：写入路径调用 startCronRun('playbook-
-- staleness-weekly')，jobName 已经登记进 src/lib/cron/registry.ts（scheduler: 'external'，
-- 因为触发方是仓库外的 Claude scheduled task，不在 render.yaml 里）——复用现有
-- pushCronHealthItems 巡检机制，不需要为"巡检有没有跑"另建一套。

CREATE TABLE playbook_staleness_findings (
  id                uuid primary key default gen_random_uuid(),
  -- 手册中文显示名，如「SEO通用经验手册」——给 PM/dev 看的今日待办文案用。
  playbook_name     text not null,
  -- 手册文件名（不含目录），如 playbook-seo-general.md。跟仓库外那份
  -- MEMORY.md 索引里的文件名必须完全一致，写入侧（route）会校验白名单。
  playbook_path     text not null,
  -- 手册里那一句原文（截断到合理长度），今日待办的 what 文案要引用它。
  quoted_line       text not null,
  -- 被判定为疑似过期的具体引用本身（函数名/文件路径/表名/env var 名）。
  reference_text    text not null,
  -- 为什么怀疑过期，例如「grep src/ 找不到这个函数了，像是改名或删掉了」。
  suspected_reason  text not null,
  -- 建议怎么核实/怎么改——今日待办的 how 文案直接用这段。
  how_to_verify     text not null,
  -- 本周巡检查到的时间。全量替换：每次写入前先清空整张表，所以这个字段
  -- 恒等于"最近一次巡检时间"，不需要区分 first/last seen。
  detected_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  -- 同一本手册里同一条引用只留一行——重复扫到会更新 quoted_line/detected_at，
  -- 不会插出重复行。刻意不带 WHERE 谓词（见上方头注），跟 PostgREST upsert 的
  -- on_conflict 参数兼容。
  unique (playbook_path, reference_text)
);

create index on playbook_staleness_findings (detected_at desc);

alter table playbook_staleness_findings enable row level security;
revoke all on playbook_staleness_findings from anon, authenticated;
grant all on playbook_staleness_findings to service_role;

create policy playbook_staleness_findings_service_role
  on playbook_staleness_findings for all to service_role using (true) with check (true);
-- 不给 anon/authenticated 建任何 policy —— 写入方是 /api/cron/playbook-staleness-weekly
-- （service_role），读取方是 pm-daily-todo 的待办聚合（service_role），仅此两处。
-- CLAUDE.md §7：必须写 `TO service_role`，漏掉等于对匿名访客敞开读写
-- （2026-08-03 实测泄露 118 条策略；seo_patrol_findings 迁移文件就漏了这个，
-- 这次照 provider_outages 的正确模板抄，不重蹈覆辙）。
