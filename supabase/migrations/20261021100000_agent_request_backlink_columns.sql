-- 广告请求回执账本（ad request receipt ledger）第 0 步：给两张既有表加可空回链列。
-- 设计：docs/specs/2026-10-21-agent-request-receipt-ledger-design-v0.9.md 第 3.3、6、10 节。
--
-- 🔴 不要自己 apply：产品负责人（PM）另点头。迁移只加可空列、索引、触发器，
--    不写任何数据，不加外键（请求表由后续迁移创建，此刻还不存在），
--    也不改任何 GRANT / RLS。
--
-- 语义：agent_request_id 只能写一次；工单表额外允许一次“后继请求接管”，
--       由账本函数在会话标记 + 表属主角色下完成，接管后 agent_request_prev_id 落值。
--
-- 触发器同时拒绝：删除已绑定请求的工单；修改已绑定行的主键 id；
--   插入时带 agent_request_prev_id 的工单（prev 只能经由唯一一次重绑出现）。
--   删除 execution_items 故意保持允许（调度器会删除待处理项）。

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.execution_items ADD COLUMN IF NOT EXISTS agent_request_id uuid;
ALTER TABLE public.content_work_orders ADD COLUMN IF NOT EXISTS agent_request_id uuid;
ALTER TABLE public.content_work_orders ADD COLUMN IF NOT EXISTS agent_request_prev_id uuid;

COMMENT ON COLUMN public.execution_items.agent_request_id IS
  '该对象绑定的广告请求 id，只写一次（write-once）。';
COMMENT ON COLUMN public.content_work_orders.agent_request_id IS
  '该对象绑定的广告请求 id，只写一次（write-once）。';
COMMENT ON COLUMN public.content_work_orders.agent_request_prev_id IS
  '仅工单表：后继请求从前任接管工单时落值，只写一次；非空表示唯一一次重绑已用掉。';

CREATE INDEX IF NOT EXISTS execution_items_agent_request_idx
  ON public.execution_items (agent_request_id)
  WHERE agent_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS content_work_orders_agent_request_idx
  ON public.content_work_orders (agent_request_id)
  WHERE agent_request_id IS NOT NULL;

-- execution_items：agent_request_id 只写一次
CREATE OR REPLACE FUNCTION public.execution_items_agent_request_write_once()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.agent_request_id IS NOT NULL AND NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'execution_items.id cannot change while agent_request_id is set'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.agent_request_id IS NOT NULL
     AND NEW.agent_request_id IS DISTINCT FROM OLD.agent_request_id THEN
    RAISE EXCEPTION 'execution_items.agent_request_id is write-once'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS execution_items_agent_request_write_once ON public.execution_items;
CREATE TRIGGER execution_items_agent_request_write_once
  BEFORE UPDATE ON public.execution_items
  FOR EACH ROW
  WHEN (OLD.agent_request_id IS DISTINCT FROM NEW.agent_request_id OR OLD.id IS DISTINCT FROM NEW.id)
  EXECUTE FUNCTION public.execution_items_agent_request_write_once();

-- content_work_orders：agent_request_id 只写一次，但允许一次“后继请求接管”。
-- 接管条件（规则 d）：会话标记 ad_agent.ledger_writer = 'apply_receipt_v1' + 当前角色是表属主 + 仅一次；
-- “前任已终态、后继 supersedes id 等于旧值”等业务校验放在账本函数里，因为请求表此刻还不存在。
CREATE OR REPLACE FUNCTION public.content_work_orders_agent_request_write_once()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.agent_request_id IS NOT NULL AND NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'content_work_orders.id cannot change while agent_request_id is set'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- a. prev 只写一次
  IF OLD.agent_request_prev_id IS NOT NULL
     AND NEW.agent_request_prev_id IS DISTINCT FROM OLD.agent_request_prev_id THEN
    RAISE EXCEPTION 'content_work_orders.agent_request_prev_id is write-once'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- b. 首次写入 agent_request_id 是自由的，但不能顺带写 prev
  IF OLD.agent_request_id IS NULL THEN
    IF NEW.agent_request_prev_id IS NOT NULL THEN
      RAISE EXCEPTION 'content_work_orders.agent_request_prev_id is write-once (prev may only be written together with a re-bind)'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- c. agent_request_id 未变：prev 也不能单独变
  IF NEW.agent_request_id IS NOT DISTINCT FROM OLD.agent_request_id THEN
    IF NEW.agent_request_prev_id IS DISTINCT FROM OLD.agent_request_prev_id THEN
      RAISE EXCEPTION 'content_work_orders.agent_request_prev_id is write-once (prev cannot change on its own)'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- d. 旧值已设且新值不同（含 NULL）：仅当满足全部接管条件才放行
  IF NEW.agent_request_id IS NOT NULL
     AND OLD.agent_request_prev_id IS NULL
     AND NEW.agent_request_prev_id = OLD.agent_request_id
     AND pg_catalog.current_setting('ad_agent.ledger_writer', true) = 'apply_receipt_v1'
     AND current_user = (
       SELECT pg_catalog.pg_get_userbyid(c.relowner)
       FROM pg_catalog.pg_class c
       WHERE c.oid = TG_RELID
     ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'content_work_orders.agent_request_id is write-once (a successor request may take it over once, only through the ledger function)'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS content_work_orders_agent_request_write_once ON public.content_work_orders;
CREATE TRIGGER content_work_orders_agent_request_write_once
  BEFORE UPDATE ON public.content_work_orders
  FOR EACH ROW
  WHEN (OLD.agent_request_id IS DISTINCT FROM NEW.agent_request_id
        OR OLD.agent_request_prev_id IS DISTINCT FROM NEW.agent_request_prev_id
        OR OLD.id IS DISTINCT FROM NEW.id)
  EXECUTE FUNCTION public.content_work_orders_agent_request_write_once();

-- content_work_orders：已绑定请求的工单不允许删除
CREATE OR REPLACE FUNCTION public.content_work_orders_agent_request_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'content_work_orders row is bound to an agent request and cannot be deleted'
    USING ERRCODE = 'integrity_constraint_violation';
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS content_work_orders_agent_request_no_delete ON public.content_work_orders;
CREATE TRIGGER content_work_orders_agent_request_no_delete
  BEFORE DELETE ON public.content_work_orders
  FOR EACH ROW
  WHEN (OLD.agent_request_id IS NOT NULL)
  EXECUTE FUNCTION public.content_work_orders_agent_request_no_delete();

-- content_work_orders：插入时不允许带 agent_request_prev_id（prev 只能经由唯一一次重绑出现）
CREATE OR REPLACE FUNCTION public.content_work_orders_agent_request_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'content_work_orders.agent_request_prev_id can only be written by the one allowed re-bind, not on insert'
    USING ERRCODE = 'integrity_constraint_violation';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS content_work_orders_agent_request_insert_guard ON public.content_work_orders;
CREATE TRIGGER content_work_orders_agent_request_insert_guard
  BEFORE INSERT ON public.content_work_orders
  FOR EACH ROW
  WHEN (NEW.agent_request_prev_id IS NOT NULL)
  EXECUTE FUNCTION public.content_work_orders_agent_request_insert_guard();

-- 触发器函数从不被直接调用，按本仓库其他触发器的做法收回执行权限。
REVOKE EXECUTE ON FUNCTION public.execution_items_agent_request_write_once() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.content_work_orders_agent_request_write_once() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.content_work_orders_agent_request_no_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.content_work_orders_agent_request_insert_guard() FROM PUBLIC, anon, authenticated;

COMMIT;
