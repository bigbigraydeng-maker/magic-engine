-- 广告 ↔ 我们自己的片子 —— 「这条广告投的是哪条片」
--
-- ⚠️ 尚未 apply,等 PM 拍板。库内版本以 supabase_migrations.schema_migrations 为准。
--
-- WHY
-- ---
-- contacts / contact_touchpoints 上 2026-07-30 就加好了 attr_creative_ref,
-- 至今**一个写入方都没有**(库里 0 行有值)。原因写在 20260730145405 的注释里:
-- Meta 的 lead 导出不返回 creative id,这一列的真相源只能是 ME 自己的出片管道。
-- 但出片管道那一侧同样没有把「我们的片子」和「Meta 的广告」记在一起过 ——
-- 于是每天在丢数据:今天跑的每条广告,事后都说不清是哪条片子的功劳。
--
-- 唯一知道对应关系的时刻,是**建广告的那一刻**:那一刻我们手里同时有
--   · 要推的 Facebook 帖子 id(Meta 的 object_story_id 结构上必须有它)
--   · 刚建出来的 ad_id
-- 事后再问 Meta「这条广告是哪条片」是问不出来的。所以这张表在建广告时写,
-- 不是事后跑批推断出来的。
--
-- 为什么不复用 content_work_orders.published_ad_id
-- ----------------------------------------------
-- 那一列(20260711000002 建的)也是「declared but never written」—— 全仓 grep
-- 只有建表那一行,零写入方。但就算现在补上写入方,它也接不住这件事:
--   1. **一条片子会变成多条广告**:同一个帖子可以被 boost 两次、也可以被
--      winner-reel-sync 塞进另一个广告组。标量列只装得下最后一条,前面的丢掉。
--   2. **「查不到对应片子」这种情况没地方记**:一条广告如果找不到是哪条片子做的,
--      它根本没有对应的工单行可挂。而记下这个缺口正是本次的重点 —— 缺口不记就是
--      静默失败,整条断链当初就是这么来的(各环节都正常,只有并排看才发现断了)。
--   3. reels_drafts 那条线上根本没有类似的列。
-- 所以 published_ad_id 就此标为被本表取代(见文末 COMMENT),不再写它 ——
-- 两处记同一件事必然漂移。
--
-- 拿不到就留空
-- ----------
-- creative_ref 可空,而且**绝不猜**:找不到唯一匹配的片子就写 NULL + 写明原因。
-- 尤其「同一个帖子 id 匹配到多条工单」也算拿不到 —— 从中挑一条就是猜。
-- 猜出来的归因会让「哪种内容带来真买家」学出反的结论,比空着糟得多。
-- 历史广告没有这层映射,不回填。

CREATE TABLE IF NOT EXISTS public.ad_creative_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- 目前只有 meta 一条投放线(Google Ads 还没有建广告的代码路径)。
  -- 跟 attr_platform 一样不加 CHECK:真相源在 TypeScript,库里保持 TEXT
  -- (加渠道要再来一次 migration + 漏同步直接写入报错 —— superseded 事故)。
  platform        text NOT NULL DEFAULT 'meta',
  -- 平台侧的广告 id。归因反查的入口:contacts.attr_ad_id → 这里 → creative_ref。
  ad_id           text NOT NULL,

  -- 建广告那一刻推的是哪个帖子。存下来是为了「事后能验」:
  -- 光存 ad_id → creative_ref 的结论,对错就再也查不回去了。
  page_id         text,
  post_id         text NOT NULL,

  -- ME 自己的片子 id。NULL = 当时查不到,如实留白(见文件头)。
  creative_ref    text,
  -- creative_ref 指向哪张表。真相源 = src/lib/ads/creative-link.ts 的 CreativeSource。
  -- 目前只有 'content_work_order':reels_drafts 那条线走 Publer,Publer 只回
  -- job_id、不回平台帖子 id,所以那条线上的片子**现在还接不上**——这是事实,
  -- 不是本表的缺陷。等 Publer 回执里能拿到 post_id 再加 'reels_draft'。
  creative_source text,

  -- 怎么认出来的。'published_post_id' = 帖子 id 精确命中一条已发布工单;
  -- 'unresolved' = 没认出来(原因见 unresolved_reason)。
  link_method     text NOT NULL,
  unresolved_reason text,

  -- 哪条代码路径建的这条广告。真相源 = creative-link.ts 的 AdCreationPath。
  -- 用途:哪条路径漏得最多,一句 group by 就看得见。
  created_by      text NOT NULL,

  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 幂等:同一条广告重复记只更新,不叠行。
CREATE UNIQUE INDEX IF NOT EXISTS ad_creative_links_ad_key
  ON public.ad_creative_links (client_id, platform, ad_id);

-- 正查:「这条广告投的哪条片」—— 归因写入时按 ad_id 查。
-- (唯一索引已覆盖,此处不重复建。)

-- 反查:「这条片子变成了哪些广告 / 带来了几个人」。
CREATE INDEX IF NOT EXISTS ad_creative_links_creative_idx
  ON public.ad_creative_links (client_id, creative_ref)
  WHERE creative_ref IS NOT NULL;

-- 缺口盘点:「这个月建了几条广告,几条认不出是哪条片」。
-- 这条索引存在本身就是态度:留白必须可数,不可数的留白等于没发生。
CREATE INDEX IF NOT EXISTS ad_creative_links_unresolved_idx
  ON public.ad_creative_links (client_id, created_at DESC)
  WHERE creative_ref IS NULL;

ALTER TABLE public.ad_creative_links ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.ad_creative_links FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE public.ad_creative_links IS
  '广告 ↔ ME 自己的片子。建广告那一刻写(唯一知道对应关系的时刻),事后推不出来。creative_ref 为 NULL = 当时查不到,绝不猜。';
COMMENT ON COLUMN public.ad_creative_links.creative_ref IS
  'ME 出片管道的稳定 id(当前 = content_work_orders.id)。NULL 是合法值,含义见 unresolved_reason。';
COMMENT ON COLUMN public.ad_creative_links.link_method IS
  '怎么认出来的。真相源 src/lib/ads/creative-link.ts 的 LinkMethod,库里不加 CHECK。';

COMMENT ON COLUMN public.content_work_orders.published_ad_id IS
  '已由 ad_creative_links 取代(一条片子会变成多条广告,标量列装不下),不再写入。保留仅为读历史行——建表至今零写入,实际全空。';
