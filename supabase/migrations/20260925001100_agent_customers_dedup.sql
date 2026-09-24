-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ ⚠️ 本文件只随 PR 提交，**不在 PR 内 apply**。apply 需 PM 显式 go。          ║
-- ║                                                                          ║
-- ║ agent_customers 幂等键补丁：                                              ║
-- ║  1. 新增 UNIQUE (client_id, agent_contact_id, conversation_id,           ║
-- ║     customer_name)——同一 Agent 名下同一条线程里的同一个客户名，只允许    ║
-- ║     一行。不同线程里的同名客户视为不同客户（同名不同人的常见场景）。       ║
-- ║  2. 新增 needs_review 列：AI 提取时如果 pax 明显异常（> 30），标 true，   ║
-- ║     由 PM 人工过一眼确认。                                                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE public.agent_customers
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS agent_customers_dedup_idx
  ON public.agent_customers (client_id, agent_contact_id, conversation_id, customer_name)
  WHERE customer_name IS NOT NULL;

COMMENT ON COLUMN public.agent_customers.needs_review IS 'AI 提取时 pax 异常大（> 30）等信号触发，PM 人工过一眼再决定。';

NOTIFY pgrst, 'reload schema';
