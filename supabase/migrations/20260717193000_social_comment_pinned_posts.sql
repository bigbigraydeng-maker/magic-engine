-- Social comment auto-reply — pinned (always-monitored) posts.
--
-- Evergreen viral posts (e.g. a months-old post that still gets daily comments)
-- fall outside the "recent 100 posts" scan window. Let FDE pin specific post
-- ids so they're always scanned regardless of position.

ALTER TABLE public.social_comment_config
  ADD COLUMN IF NOT EXISTS pinned_post_ids text[] NOT NULL DEFAULT '{}';
