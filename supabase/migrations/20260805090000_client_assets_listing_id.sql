-- 素材归到「一套房」，不是只归到「一个客户」
--
-- 为什么（PM 2026-08-05 提的产品要求）：
--   地产的营销单位是一套房。ME 的素材表上原来只有 client_id 和一个指向
--   client_projects 的 project_id，**没有任何一列指向 listings**。
--   实测后果：库里 83 个素材，0 个知道自己属于哪套房。Roman 有 25 套在售，
--   出广告时系统只知道「这是 Roman 的照片」，拿不出「这是 Schnapper Rock 那套的」。
--
--   project_id 顶不了这个用：它指向 client_projects（楼盘/开发项目），
--   而 Roman 那 25 套是各自独立的房源，不隶属任何楼盘。两个粒度，两列。
--
-- 「不能随意更改」这条要求落在三处，这个 migration 负责第一处：
--   1. 素材一旦绑到房源，归属不可变（本文件：触发器禁止改 listing_id）
--   2. 素材本身不可就地替换（改在应用层：换图 = 归档旧的 + 插新的）
--   3. 广告只能用「已核实 + 属于该房源」的素材（改在应用层的闸门）

ALTER TABLE public.client_assets
  ADD COLUMN IF NOT EXISTS listing_id uuid REFERENCES public.listings(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.client_assets.listing_id IS
  '这张素材属于哪套房。由上传链接决定（一房一链接），不由上传的人选。NULL = 客户级素材（老链接传的）。绑定后不可更改，见 trg_client_assets_listing_immutable。';

-- 出广告时最常见的查询就是「这套房有哪些能用的素材」。
CREATE INDEX IF NOT EXISTS idx_client_assets_listing
  ON public.client_assets (listing_id)
  WHERE listing_id IS NOT NULL AND archived_at IS NULL;

-- ── 归属不可变 ──────────────────────────────────────────────────────────────
-- 一张照片绑到 A 房，就不能改挂到 B 房。
--
-- 为什么要在库这一层挡：这是**地产合规**问题，不是数据整洁问题。
-- 把 A 房的照片改挂到 B 房，等于用一套房的画面去卖另一套房 —— 在 NZ 属于
-- 误导性广告。应用层的闸门会被绕过（手敲 SQL、新写的接口忘了调），
-- 库层的触发器不会。
--
-- 允许的只有一个方向：NULL → 某个房源（老素材补挂）。
-- 已经有主的不许换主，也不许改回 NULL。
CREATE OR REPLACE FUNCTION public.client_assets_listing_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.listing_id IS NOT NULL AND NEW.listing_id IS DISTINCT FROM OLD.listing_id THEN
    RAISE EXCEPTION
      '素材已绑定房源 %，不能改挂到 %。换图请归档这一条再传新的。',
      OLD.listing_id, NEW.listing_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_assets_listing_immutable ON public.client_assets;
CREATE TRIGGER trg_client_assets_listing_immutable
  BEFORE UPDATE ON public.client_assets
  FOR EACH ROW
  EXECUTE FUNCTION public.client_assets_listing_immutable();

-- ── 文件本身也不可就地替换 ──────────────────────────────────────────────────
-- 同一行的 storage_url 被改掉 = 已经审过、已经投出去的广告，画面在背后被换了。
-- 换图的正确做法是归档旧行 + 插新行，这样「这条广告当时用的是哪张图」永远查得回。
CREATE OR REPLACE FUNCTION public.client_assets_file_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.storage_url IS DISTINCT FROM OLD.storage_url THEN
    RAISE EXCEPTION
      '素材文件不可就地替换（原 %）。换图请归档这一条再传新的，否则已投放广告的画面会被静默换掉。',
      OLD.storage_url
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_assets_file_immutable ON public.client_assets;
CREATE TRIGGER trg_client_assets_file_immutable
  BEFORE UPDATE ON public.client_assets
  FOR EACH ROW
  EXECUTE FUNCTION public.client_assets_file_immutable();
