-- Add source column to content_posts to track origin of posts
-- 'kanban'  = sent from execution kanban via LaunchHubScheduler
-- 'manual'  = created directly in Launch Hub
-- 'airtable' = synced from Airtable Content Workspace
ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS source TEXT;

COMMENT ON COLUMN content_posts.source IS
  'Origin of the post: kanban | manual | airtable. NULL = legacy record.';

CREATE INDEX IF NOT EXISTS idx_content_posts_source
  ON content_posts(source)
  WHERE source IS NOT NULL;
