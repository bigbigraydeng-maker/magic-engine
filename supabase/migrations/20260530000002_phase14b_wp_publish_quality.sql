-- Phase 14.B — WP Publish Quality Improvements
-- P14.B.1: yoast_plugin_installed flag on cms_connections
-- P14.B.6: wp_default_category_id on cms_connections
-- P14.B.4: quality_check JSONB on blog_posts
--
-- Safe to re-run (IF NOT EXISTS / idempotent ALTER).

ALTER TABLE cms_connections
  ADD COLUMN IF NOT EXISTS yoast_plugin_installed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS wp_default_category_id integer NULL;

COMMENT ON COLUMN cms_connections.yoast_plugin_installed IS
  'P14.B.1: true once ME has probed that Yoast SEO meta keys are REST-writable on this WP site.';

COMMENT ON COLUMN cms_connections.wp_default_category_id IS
  'P14.B.6: WP category ID to assign by default when publishing posts. NULL = uncategorized (WP default).';

ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS quality_check jsonb NULL;

COMMENT ON COLUMN blog_posts.quality_check IS
  'P14.B.4: structured QC results written after generation. Shape: { internal_link: { count, pass, level, detail, computed_at } }';
