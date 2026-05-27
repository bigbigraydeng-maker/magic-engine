-- Add GitHub PR tracking fields to blog_posts
-- After publishBlogToGitHub() creates a PR, the blog moves to 'pr_open' status.
-- pr_url / pr_number let the Blog Studio link directly to the GitHub PR.

-- 1. Add the two new columns (idempotent)
ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS pr_url    TEXT,
  ADD COLUMN IF NOT EXISTS pr_number INT;

-- 2. Extend the status constraint to include 'pr_open'
--    (blog was published to GitHub as a PR; waiting for maintainer to merge)
ALTER TABLE blog_posts
  DROP CONSTRAINT IF EXISTS blog_posts_status_check;

ALTER TABLE blog_posts
  ADD CONSTRAINT blog_posts_status_check
  CHECK (status IN ('draft', 'approved', 'published', 'rejected', 'generating', 'failed', 'pr_open'));

COMMENT ON COLUMN blog_posts.pr_url IS
  'GitHub Pull Request URL after publishBlogToGitHub() succeeds. Null until a PR is opened.';
COMMENT ON COLUMN blog_posts.pr_number IS
  'GitHub Pull Request number. Null until a PR is opened.';
