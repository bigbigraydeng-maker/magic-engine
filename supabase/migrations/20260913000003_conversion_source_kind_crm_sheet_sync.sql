-- ============================================================================
-- me_sale_outcomes.source_kind 追加一个值：'crm_sheet_sync'（Issue #1397 续）
--
-- ⚠️ **本文件只提交代码，尚未 apply。** 命名待 PM 一句话确认（见 PR 描述），
--    不是重新设计表结构，只是给已批准的 CHECK 约束追加一个枚举值。
--
-- 为什么不用已有的值（详细理由见 src/lib/conversions/intake.ts 的注释）：
--   · manual_seed  —— 语义是"一次性历史导入"，不是会反复运行的同步
--   · crm_hubspot  —— 特意留给未来接入正式 HubSpot API，可信度跟"读一张人工
--                      维护的 Excel 表格"不一样，混在一起以后按来源查问题记录会分不清
--   · api          —— 太笼统，以后所有 API 集成的来源都分不清
-- ============================================================================

ALTER TABLE public.me_sale_outcomes DROP CONSTRAINT IF EXISTS me_sale_outcomes_source_kind_check;

ALTER TABLE public.me_sale_outcomes ADD CONSTRAINT me_sale_outcomes_source_kind_check
  CHECK (source_kind IN
    ('manual_seed', 'inbox_extract', 'web_form', 'meta_lead_form', 'api', 'crm_hubspot', 'crm_sheet_sync'));

NOTIFY pgrst, 'reload schema';
