-- P13.A.2: Production Item 行项目层 — production_items 表
-- 每个 production_item 代表一个具体生成产物（social post / blog / reel / visual）
-- 归属于一个 production_package；content_type + 单 FK 指向具体内容表
-- Reference: ROADMAP.md § Phase 13.A

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE production_items (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id        UUID        NOT NULL REFERENCES production_packages(id) ON DELETE CASCADE,
  client_id         UUID        NOT NULL REFERENCES clients(id)             ON DELETE CASCADE,

  -- 内容类型判别字段；与下方四个 FK 中的一个对应
  content_type      TEXT        NOT NULL
    CHECK (content_type IN ('content_post', 'blog_post', 'reel', 'visual_asset')),

  -- 四张内容表 FK（同一行只有一个非 NULL）
  content_post_id   UUID        REFERENCES content_posts(id)  ON DELETE SET NULL,
  blog_post_id      UUID        REFERENCES blog_posts(id)     ON DELETE SET NULL,
  reel_id           UUID        REFERENCES reels_drafts(id)   ON DELETE SET NULL,
  visual_asset_id   UUID        REFERENCES visual_assets(id)  ON DELETE SET NULL,

  -- 强制 content_type 与实际 FK 对应，且最多一个 FK 非 NULL
  CONSTRAINT chk_item_fk_matches_type CHECK (
    CASE content_type
      WHEN 'content_post'  THEN content_post_id  IS NOT NULL
                                AND blog_post_id     IS NULL
                                AND reel_id          IS NULL
                                AND visual_asset_id  IS NULL
      WHEN 'blog_post'     THEN blog_post_id     IS NOT NULL
                                AND content_post_id  IS NULL
                                AND reel_id          IS NULL
                                AND visual_asset_id  IS NULL
      WHEN 'reel'          THEN reel_id          IS NOT NULL
                                AND content_post_id  IS NULL
                                AND blog_post_id     IS NULL
                                AND visual_asset_id  IS NULL
      WHEN 'visual_asset'  THEN visual_asset_id  IS NOT NULL
                                AND content_post_id  IS NULL
                                AND blog_post_id     IS NULL
                                AND reel_id          IS NULL
      ELSE FALSE
    END
  ),

  -- package 内排序；生成时按序号写入，UI 可拖排后更新
  sort_order        INT         NOT NULL DEFAULT 0,

  status            TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'generating', 'ready', 'failed', 'archived')),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX idx_item_package        ON production_items(package_id);
CREATE INDEX idx_item_client_type    ON production_items(client_id, content_type);
CREATE INDEX idx_item_content_post   ON production_items(content_post_id)  WHERE content_post_id  IS NOT NULL;
CREATE INDEX idx_item_blog_post      ON production_items(blog_post_id)     WHERE blog_post_id     IS NOT NULL;
CREATE INDEX idx_item_reel           ON production_items(reel_id)          WHERE reel_id          IS NOT NULL;
CREATE INDEX idx_item_visual_asset   ON production_items(visual_asset_id)  WHERE visual_asset_id  IS NOT NULL;

-- ── updated_at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_production_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER production_items_updated_at_trigger
  BEFORE UPDATE ON production_items
  FOR EACH ROW EXECUTE FUNCTION update_production_items_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE production_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full"
  ON production_items FOR ALL TO service_role
  USING (true) WITH CHECK (true);
