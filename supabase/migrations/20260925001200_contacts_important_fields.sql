-- ---------------------------------------------------------------------------
-- 重要标记升级：给「⭐置顶」补上「原因」和「到期日」两个字段（PM 2026-09-25）
--
-- 目前只有 contacts.pinned_at（时间戳），页面上是一个空的星。员工老表里的红字
-- 附带了"约好周三 3 点回电"/"只发邮件"这类具体原因，还常常带自定义到期日。
-- 一个 bool 星根本装不下这些。补两列，语义上都可空 —— 星本身继续用 pinned_at
-- 表达"标了"，这两列只是"标了什么"和"到什么时候"。
--
-- 到期日到了 → 自动进今日待办（另一轮的活，本 migration 只加字段）。
-- ---------------------------------------------------------------------------

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS important_note   TEXT,
  ADD COLUMN IF NOT EXISTS important_due_at TIMESTAMPTZ;

COMMENT ON COLUMN contacts.important_note IS
  '「⭐置顶」附带的一句原因（"约好周三 3 点回电"/"只发邮件不打电话"）。NULL = 没写。清空 = 传 NULL。';

COMMENT ON COLUMN contacts.important_due_at IS
  '这条重要标记的到期时间。到点后另一个每日任务会把它塞进今日待办（本 migration 不做那一步）。NULL = 没截止日。';

-- 到期日查询：pm-todo 每天读一次，绝大多数是 NULL —— 用部分索引，只收有值的那些。
CREATE INDEX IF NOT EXISTS contacts_important_due_idx
  ON contacts (client_id, important_due_at)
  WHERE important_due_at IS NOT NULL;
