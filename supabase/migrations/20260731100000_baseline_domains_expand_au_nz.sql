-- baseline_domains: 扩到 AU+NZ 三行业 + 停用物流
--
-- ⚠️ NOT APPLIED. PM applies this (repo hard constraint: workers must not run apply_migration).
--
-- ── 为什么 ────────────────────────────────────────────────────────────────────
-- PM 2026-07-31：补充澳洲和新西兰的「旅游（不分进出境）/ 地产 / 地板建材」，
-- 其他行业（3PL 物流）忽略。
--
-- 动这一刀之前查到的问题（见 PR #712 之后的名单审计）：
--   - 61 个域名全部在 2026-06-01 ~ 06-04 四天内一次性加入，之后两个月没维护
--   - 61 条里只有 1 条填了 notes（CTS），没有任何一条记录「为什么选它」
--   - logistics_3pl_nz 组名叫 NZ，实际 8 NZ + 7 AU + 3 其他，地区是混的
--   - 地产只有奥克兰 8 个、建材只有布里斯班 13 个，AU 地产和 NZ 建材都是 0
--   - outbound_tour_operator_nz 只有 4 个域名，减去 CTS 自己只剩 3 个参照，
--     刚好卡在 benchmarks.ts 的 MIN_LIVE_SAMPLE = 3 及格线上
--
-- 本次新增 43 个域名，全部用 curl 实测过站点存活（2026-07-31）。剔除了
-- 3 个 DNS 解析失败的候选（newzealandprivatetours.nz / downunderanswers.com
-- / sunloverholidays.com.au）和 1 个重复公司（aptouring.com.au 与库中已有的
-- aptouring.com 是同一家）。
--
-- 刻意排除、并已向 PM 说明的：
--   - Flight Centre / Webjet / Helloworld / House of Travel — 机票零售平台，
--     不是做行程的 tour operator，业务模型不同会搅浑基准
--   - Intrepid / Trafalgar — 全球巨头，不是 AU/NZ 本地对手
--   - Harvey Norman — 零售巨无霸，跟中小建材商不可比
--   ⚠️ 遗留问题：库中已有 Carpet Court / Beaumont Tiles / Bunnings 级别的全国
--   连锁，口径本来就偏大。基准被巨头拉高后，对中小客户就不是「同行水平」而是
--   「遥不可及」。是否按体量分层，留待 PM 决定，本次不动。

BEGIN;

-- ── 1. 启用/停用开关 ──────────────────────────────────────────────────────────
-- 用停用而不是 DELETE：物流那 18 个域名已攒了 690 条历史评分，删掉不可逆。
-- 停用后 cron 不再对它们打分（= 不再花钱），数据全部保留，随时可恢复。
ALTER TABLE baseline_domains
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN baseline_domains.is_active IS
  'false = cron skips this domain entirely (no DataForSEO spend). History is retained.';

CREATE INDEX IF NOT EXISTS idx_baseline_domains_active
  ON baseline_domains (is_active) WHERE is_active;

-- ── 2. 停用物流（PM: 其他行业可以忽略）───────────────────────────────────────
UPDATE baseline_domains SET is_active = false WHERE industry = 'logistics_3pl';

-- ── 3. 地产 · 澳洲（新组，原本 0 个）─────────────────────────────────────────
INSERT INTO baseline_domains (industry, sub_industry, domain, keywords, geo_scope, city, notes) VALUES
  ('real_estate_agency','real_estate_agency_au','raywhite.com',          ARRAY['real estate agent australia','property for sale australia','houses for sale sydney','houses for sale melbourne','real estate agency brisbane','buy house australia','property management australia','real estate listings australia','investment property australia','apartments for sale sydney'],'national',NULL,'AU 最大中介网络(730 办公室)'),
  ('real_estate_agency','real_estate_agency_au','ljhooker.com.au',       ARRAY['real estate agent australia','property for sale australia','houses for sale sydney','houses for sale melbourne','real estate agency brisbane','buy house australia','property management australia','real estate listings australia','investment property australia','apartments for sale sydney'],'national',NULL,'AU 第二大网络'),
  ('real_estate_agency','real_estate_agency_au','mcgrath.com.au',        ARRAY['real estate agent australia','property for sale australia','houses for sale sydney','houses for sale melbourne','real estate agency brisbane','buy house australia','property management australia','real estate listings australia','investment property australia','apartments for sale sydney'],'national',NULL,'NSW/VIC 强势,高端住宅'),
  ('real_estate_agency','real_estate_agency_au','belleproperty.com',     ARRAY['real estate agent australia','property for sale australia','houses for sale sydney','houses for sale melbourne','real estate agency brisbane','buy house australia','property management australia','real estate listings australia','investment property australia','apartments for sale sydney'],'national',NULL,'AU 五大集团之一'),
  ('real_estate_agency','real_estate_agency_au','harcourts.com.au',      ARRAY['real estate agent australia','property for sale australia','houses for sale sydney','houses for sale melbourne','real estate agency brisbane','buy house australia','property management australia','real estate listings australia','investment property australia','apartments for sale sydney'],'national',NULL,'AU 分支(NZ 同名品牌另计)'),
  ('real_estate_agency','real_estate_agency_au','barryplant.com.au',     ARRAY['real estate agent australia','property for sale australia','houses for sale sydney','houses for sale melbourne','real estate agency brisbane','buy house australia','property management australia','real estate listings australia','investment property australia','apartments for sale sydney'],'national',NULL,'VIC 主力'),
  ('real_estate_agency','real_estate_agency_au','firstnational.com.au',  ARRAY['real estate agent australia','property for sale australia','houses for sale sydney','houses for sale melbourne','real estate agency brisbane','buy house australia','property management australia','real estate listings australia','investment property australia','apartments for sale sydney'],'national',NULL,NULL),
  ('real_estate_agency','real_estate_agency_au','century21.com.au',      ARRAY['real estate agent australia','property for sale australia','houses for sale sydney','houses for sale melbourne','real estate agency brisbane','buy house australia','property management australia','real estate listings australia','investment property australia','apartments for sale sydney'],'national',NULL,NULL),
  ('real_estate_agency','real_estate_agency_au','raineandhorne.com.au',  ARRAY['real estate agent australia','property for sale australia','houses for sale sydney','houses for sale melbourne','real estate agency brisbane','buy house australia','property management australia','real estate listings australia','investment property australia','apartments for sale sydney'],'national',NULL,NULL),
  ('real_estate_agency','real_estate_agency_au','professionals.com.au',  ARRAY['real estate agent australia','property for sale australia','houses for sale sydney','houses for sale melbourne','real estate agency brisbane','buy house australia','property management australia','real estate listings australia','investment property australia','apartments for sale sydney'],'national',NULL,NULL)
ON CONFLICT (sub_industry, city, domain) DO NOTHING;

-- ── 4. 地产 · 新西兰全国（现有 real_estate_agency_auckland 只覆盖奥克兰）─────
INSERT INTO baseline_domains (industry, sub_industry, domain, keywords, geo_scope, city, notes) VALUES
  ('real_estate_agency','real_estate_agency_nz','tallpoppy.co.nz',       ARRAY['real estate agent new zealand','property for sale nz','houses for sale new zealand','real estate agency nz','buy house new zealand','property management new zealand','houses for sale christchurch','houses for sale wellington','investment property nz','real estate listings nz'],'national',NULL,'低佣金模式'),
  ('real_estate_agency','real_estate_agency_nz','mikepero.com',          ARRAY['real estate agent new zealand','property for sale nz','houses for sale new zealand','real estate agency nz','buy house new zealand','property management new zealand','houses for sale christchurch','houses for sale wellington','investment property nz','real estate listings nz'],'national',NULL,'2024 被 Raine&Horne 收购'),
  ('real_estate_agency','real_estate_agency_nz','propertybrokers.co.nz', ARRAY['real estate agent new zealand','property for sale nz','houses for sale new zealand','real estate agency nz','buy house new zealand','property management new zealand','houses for sale christchurch','houses for sale wellington','investment property nz','real estate listings nz'],'national',NULL,'区域/乡村强'),
  ('real_estate_agency','real_estate_agency_nz','lodge.co.nz',           ARRAY['real estate agent new zealand','property for sale nz','houses for sale new zealand','real estate agency nz','buy house new zealand','property management new zealand','houses for sale christchurch','houses for sale wellington','investment property nz','real estate listings nz'],'national',NULL,'Waikato 主力'),
  ('real_estate_agency','real_estate_agency_nz','eves.co.nz',            ARRAY['real estate agent new zealand','property for sale nz','houses for sale new zealand','real estate agency nz','buy house new zealand','property management new zealand','houses for sale christchurch','houses for sale wellington','investment property nz','real estate listings nz'],'national',NULL,'Bay of Plenty 主力'),
  ('real_estate_agency','real_estate_agency_nz','ljhooker.co.nz',        ARRAY['real estate agent new zealand','property for sale nz','houses for sale new zealand','real estate agency nz','buy house new zealand','property management new zealand','houses for sale christchurch','houses for sale wellington','investment property nz','real estate listings nz'],'national',NULL,NULL),
  ('real_estate_agency','real_estate_agency_nz','professionals.co.nz',   ARRAY['real estate agent new zealand','property for sale nz','houses for sale new zealand','real estate agency nz','buy house new zealand','property management new zealand','houses for sale christchurch','houses for sale wellington','investment property nz','real estate listings nz'],'national',NULL,NULL)
ON CONFLICT (sub_industry, city, domain) DO NOTHING;

-- ── 5. 地板建材 · 新西兰（新组，原本 0 个）──────────────────────────────────
INSERT INTO baseline_domains (industry, sub_industry, domain, keywords, geo_scope, city, notes) VALUES
  ('building_supplies','building_supplies_nz','thetilecompany.co.nz',  ARRAY['flooring new zealand','tiles nz','timber flooring nz','tile shop auckland','flooring store nz','vinyl flooring nz','floor tiles new zealand','carpet nz','building supplies nz','tile supplier new zealand'],'national',NULL,'瓷砖进口商'),
  ('building_supplies','building_supplies_nz','globaltile.co.nz',      ARRAY['flooring new zealand','tiles nz','timber flooring nz','tile shop auckland','flooring store nz','vinyl flooring nz','floor tiles new zealand','carpet nz','building supplies nz','tile supplier new zealand'],'national',NULL,'瓷砖进口商'),
  ('building_supplies','building_supplies_nz','tilewarehouse.co.nz',   ARRAY['flooring new zealand','tiles nz','timber flooring nz','tile shop auckland','flooring store nz','vinyl flooring nz','floor tiles new zealand','carpet nz','building supplies nz','tile supplier new zealand'],'national',NULL,NULL),
  ('building_supplies','building_supplies_nz','tiledepot.co.nz',       ARRAY['flooring new zealand','tiles nz','timber flooring nz','tile shop auckland','flooring store nz','vinyl flooring nz','floor tiles new zealand','carpet nz','building supplies nz','tile supplier new zealand'],'national',NULL,'家族企业'),
  ('building_supplies','building_supplies_nz','inzide.co.nz',          ARRAY['flooring new zealand','tiles nz','timber flooring nz','tile shop auckland','flooring store nz','vinyl flooring nz','floor tiles new zealand','carpet nz','building supplies nz','tile supplier new zealand'],'national',NULL,'商用地板'),
  ('building_supplies','building_supplies_nz','jacobsen.co.nz',        ARRAY['flooring new zealand','tiles nz','timber flooring nz','tile shop auckland','flooring store nz','vinyl flooring nz','floor tiles new zealand','carpet nz','building supplies nz','tile supplier new zealand'],'national',NULL,'60 年老店'),
  ('building_supplies','building_supplies_nz','flooringxtra.co.nz',    ARRAY['flooring new zealand','tiles nz','timber flooring nz','tile shop auckland','flooring store nz','vinyl flooring nz','floor tiles new zealand','carpet nz','building supplies nz','tile supplier new zealand'],'national',NULL,'零售连锁'),
  ('building_supplies','building_supplies_nz','carpetcourt.nz',        ARRAY['flooring new zealand','tiles nz','timber flooring nz','tile shop auckland','flooring store nz','vinyl flooring nz','floor tiles new zealand','carpet nz','building supplies nz','tile supplier new zealand'],'national',NULL,'NZ 分支(AU 同名另计)'),
  ('building_supplies','building_supplies_nz','guthriebowron.co.nz',   ARRAY['flooring new zealand','tiles nz','timber flooring nz','tile shop auckland','flooring store nz','vinyl flooring nz','floor tiles new zealand','carpet nz','building supplies nz','tile supplier new zealand'],'national',NULL,'地板+墙面连锁'),
  ('building_supplies','building_supplies_nz','itm.co.nz',             ARRAY['flooring new zealand','tiles nz','timber flooring nz','tile shop auckland','flooring store nz','vinyl flooring nz','floor tiles new zealand','carpet nz','building supplies nz','tile supplier new zealand'],'national',NULL,'建材批发'),
  ('building_supplies','building_supplies_nz','placemakers.co.nz',     ARRAY['flooring new zealand','tiles nz','timber flooring nz','tile shop auckland','flooring store nz','vinyl flooring nz','floor tiles new zealand','carpet nz','building supplies nz','tile supplier new zealand'],'national',NULL,'Fletcher 旗下建材连锁')
ON CONFLICT (sub_industry, city, domain) DO NOTHING;

-- ── 6. 旅游 · 新西兰（不分进出境，PM 明确要求）──────────────────────────────
INSERT INTO baseline_domains (industry, sub_industry, domain, keywords, geo_scope, city, notes) VALUES
  ('tourism_operator','tourism_operator_nz','newzealandcoachtours.co.nz', ARRAY['tour operator new zealand','new zealand tours','guided tours new zealand','nz tour packages','small group tours new zealand','coach tours new zealand','day tours new zealand','travel company nz'],'national',NULL,'巴士团聚合商'),
  ('tourism_operator','tourism_operator_nz','zealandiertours.com',        ARRAY['tour operator new zealand','new zealand tours','guided tours new zealand','nz tour packages','small group tours new zealand','coach tours new zealand','day tours new zealand','travel company nz'],'national',NULL,NULL),
  ('tourism_operator','tourism_operator_nz','thriftytours.co.nz',         ARRAY['tour operator new zealand','new zealand tours','guided tours new zealand','nz tour packages','small group tours new zealand','coach tours new zealand','day tours new zealand','travel company nz'],'national',NULL,NULL),
  ('tourism_operator','tourism_operator_nz','greatjourneysnz.com',        ARRAY['tour operator new zealand','new zealand tours','guided tours new zealand','nz tour packages','small group tours new zealand','coach tours new zealand','day tours new zealand','travel company nz'],'national',NULL,'KiwiRail 旗下'),
  ('tourism_operator','tourism_operator_nz','wildkiwi.com',               ARRAY['tour operator new zealand','new zealand tours','guided tours new zealand','nz tour packages','small group tours new zealand','coach tours new zealand','day tours new zealand','travel company nz'],'national',NULL,'年轻背包客市场'),
  ('tourism_operator','tourism_operator_nz','pacificdestinations.co.nz',  ARRAY['tour operator new zealand','new zealand tours','guided tours new zealand','nz tour packages','small group tours new zealand','coach tours new zealand','day tours new zealand','travel company nz'],'national',NULL,'入境地接'),
  ('tourism_operator','tourism_operator_nz','grandpacifictours.com',      ARRAY['tour operator new zealand','new zealand tours','guided tours new zealand','nz tour packages','small group tours new zealand','coach tours new zealand','day tours new zealand','travel company nz'],'national',NULL,'NZ 专线巴士团')
ON CONFLICT (sub_industry, city, domain) DO NOTHING;

-- ── 7. 旅游 · 澳洲（不分进出境）─────────────────────────────────────────────
INSERT INTO baseline_domains (industry, sub_industry, domain, keywords, geo_scope, city, notes) VALUES
  ('tourism_operator','tourism_operator_au','australiaone.com.au',        ARRAY['tour operator australia','australia tours','guided tours australia','australia tour packages','small group tours australia','outback tours australia','day tours australia','travel company australia'],'national',NULL,'入境地接(1990 年起)'),
  ('tourism_operator','tourism_operator_au','australia-inbound.com',      ARRAY['tour operator australia','australia tours','guided tours australia','australia tour packages','small group tours australia','outback tours australia','day tours australia','travel company australia'],'national',NULL,'入境地接'),
  ('tourism_operator','tourism_operator_au','journeybeyondrail.com.au',   ARRAY['tour operator australia','australia tours','guided tours australia','australia tour packages','small group tours australia','outback tours australia','day tours australia','travel company australia'],'national',NULL,'铁路体验游'),
  ('tourism_operator','tourism_operator_au','autopiatours.com.au',        ARRAY['tour operator australia','australia tours','guided tours australia','australia tour packages','small group tours australia','outback tours australia','day tours australia','travel company australia'],'national',NULL,'墨尔本一日游'),
  ('tourism_operator','tourism_operator_au','outbackspirittours.com.au',  ARRAY['tour operator australia','australia tours','guided tours australia','australia tour packages','small group tours australia','outback tours australia','day tours australia','travel company australia'],'national',NULL,'内陆游'),
  ('tourism_operator','tourism_operator_au','sealinktravelgroup.com.au',  ARRAY['tour operator australia','australia tours','guided tours australia','australia tour packages','small group tours australia','outback tours australia','day tours australia','travel company australia'],'national',NULL,'渡轮+旅游集团'),
  ('tourism_operator','tourism_operator_au','discoverytravel.com.au',     ARRAY['tour operator australia','australia tours','guided tours australia','australia tour packages','small group tours australia','outback tours australia','day tours australia','travel company australia'],'national',NULL,NULL),
  ('tourism_operator','tourism_operator_au','scenic.com.au',              ARRAY['tour operator australia','australia tours','guided tours australia','australia tour packages','small group tours australia','outback tours australia','day tours australia','travel company australia'],'national',NULL,'高端团')
ON CONFLICT (sub_industry, city, domain) DO NOTHING;

COMMIT;

-- ── 验证（apply 后跑）────────────────────────────────────────────────────────
-- 预期：启用 86 个（旅游 37 / 地产 25 / 建材 24），停用 18 个（物流）
--
--   SELECT industry, sub_industry, count(*) FILTER (WHERE is_active) AS active,
--          count(*) FILTER (WHERE NOT is_active) AS paused
--   FROM baseline_domains GROUP BY 1,2 ORDER BY 1,2;
--
--   SELECT count(*) FILTER (WHERE is_active) AS billed_per_run FROM baseline_domains;
--   -- 86 × US$0.06 ≈ US$5.16/轮 × 4.33 轮/月 ≈ US$22/月
