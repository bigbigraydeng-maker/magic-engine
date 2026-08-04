-- 处方审批留痕：谁批的 + 为什么拒（2026-08-04 PM 拍板 go apply）
--
-- 背景：路由从 P8.5.16 起就在写 `rejection_note` / `approved_by` 两列，但这两列
-- 从来没建过 —— PostgREST 报 PGRST204，整个 PATCH 500，处方页「重新生成」全程不可用。
-- 生产库 14 份处方里 rejected 0 份，就是这条路径从没成功过的证据。
--
-- 为什么补列而不是继续借 progress_note：progress_note 是生成/精修期间的进度文案
-- （'排队中…'），跟审批留痕是两件事。混在一起，以后想回答「这份处方谁批的 / 上一版
-- 为什么被打回」就只能靠猜。审批链路是要能对客户交代的。
--
-- 无 RLS 变更：加列不影响策略，prescriptions 的策略在
-- 20260803020000_rls_lock_policies_to_service_role.sql 已收敛。
-- 无回填：生产库当前 0 条 rejected，没有历史数据要迁。

ALTER TABLE public.prescriptions
  ADD COLUMN IF NOT EXISTS rejection_note TEXT,
  ADD COLUMN IF NOT EXISTS approved_by    TEXT;

COMMENT ON COLUMN public.prescriptions.rejection_note IS
  '打回理由。前台「重新生成」写入固定文案；FDE 手工打回可写具体原因。';

COMMENT ON COLUMN public.prescriptions.approved_by IS
  '批准人邮箱，由服务端从登录会话取，不接受前端传值。';
