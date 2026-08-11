-- 修两条自相矛盾的规则：删房源会被自己的触发器挡死
--
-- 🔴 子牙 + 狄仁杰 + 魏征三个人独立指出，魏征在生产上用回滚探针实测确认：
--
--   外键写的是 `ON DELETE SET NULL` —— 房源没了，素材的 listing_id 置空。
--   而触发器写的是「绑定后不可改挂」，禁止 `NOT NULL → 任何别的值`。
--   Postgres 的外键级联动作是一条**真实的 UPDATE**，会正常触发行级触发器。
--
--   于是：一套房只要绑过素材，`DELETE FROM listings` 就会抛
--   「素材已绑定房源 X，不能改挂到 <NULL>」而失败 —— 一句前后不搭、
--   看不懂的报错。
--
--   现在踩不到只是因为 listings 还没有 DELETE 接口。留着就是个雷。
--
-- 修法：**放行 →NULL，只挡 A房→B房**。
--   合规风险在「拿 A 房的画面卖 B 房」，不在「房源被删了、素材没主了」。
--   后者只是变回客户级素材，闸门照样会以 `no_listing` 拦住它投放。
--
-- 顺带修 UP9：两个触发器函数都没有 `SET search_path`（Supabase advisor 的
-- `function_search_path_mutable`）。函数里用的是无 schema 限定的名字，
-- 调用者若改过 search_path，解析目标就会变 —— 对安全相关的函数不该留这个口子。

CREATE OR REPLACE FUNCTION public.client_assets_listing_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 只挡「换一套房」。→NULL 放行：那是外键级联（房源被删）走的路，
  -- 也是唯一一种「素材失去归属」的合法情形。
  IF OLD.listing_id IS NOT NULL
     AND NEW.listing_id IS NOT NULL
     AND NEW.listing_id IS DISTINCT FROM OLD.listing_id THEN
    RAISE EXCEPTION
      '素材已绑定房源 %，不能改挂到 %。传错了请把这一条收起来（归档）再传新的。',
      OLD.listing_id, NEW.listing_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.client_assets_file_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.storage_url IS DISTINCT FROM OLD.storage_url THEN
    RAISE EXCEPTION
      '素材文件不可就地替换（原 %）。换图请把这一条收起来（归档）再传新的，否则已投放广告的画面会被静默换掉。',
      OLD.storage_url
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ── 跨客户错配：从「只有应用层守着」补到库层 ────────────────────────────
-- 魏征 P2-1 实测：`client_assets.client_id` 和 `listings.client_id` 之间没有任何
-- 约束，把别的客户的素材挂到这个客户的房源上，库层一点都不拦。
-- 而第一个 migration 的注释恰恰在论证「应用层会被绕过，库层不会」——
-- 这一条偏偏只有应用层守着，自相矛盾。
CREATE OR REPLACE FUNCTION public.client_assets_listing_same_client()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE owner_id uuid;
BEGIN
  IF NEW.listing_id IS NULL THEN RETURN NEW; END IF;
  SELECT client_id INTO owner_id FROM public.listings WHERE id = NEW.listing_id;
  IF owner_id IS NULL OR owner_id <> NEW.client_id THEN
    RAISE EXCEPTION
      '这张素材属于客户 %，不能挂到另一个客户的房源 % 上。',
      NEW.client_id, NEW.listing_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- INSERT 也要挡：原来两个触发器都只是 BEFORE UPDATE，插入完全没有守卫。
DROP TRIGGER IF EXISTS trg_client_assets_same_client ON public.client_assets;
CREATE TRIGGER trg_client_assets_same_client
  BEFORE INSERT OR UPDATE ON public.client_assets
  FOR EACH ROW
  EXECUTE FUNCTION public.client_assets_listing_same_client();
