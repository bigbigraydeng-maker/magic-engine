-- client_site_pages.meta_description
--
-- 生产库早已有这一列（网站体检/重扫写它，诊断读它），但仓库的建表记录里从没写过，
-- 按记录从零重建的库会缺这一列，导致体检写入整条失败。这里补上，幂等：
-- 生产上已存在 → 什么都不做。不改表的权限策略，不动数据。
ALTER TABLE public.client_site_pages
  ADD COLUMN IF NOT EXISTS meta_description TEXT;
