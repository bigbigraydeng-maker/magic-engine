-- Link YouTube private-staging receipts to organic content-factory posts.
-- Existing ad work-order receipts continue to use work_order_id.
alter table public.youtube_publish_receipts
  add column if not exists content_post_id uuid references public.content_posts(id);

create index if not exists youtube_publish_receipts_content_post_idx
  on public.youtube_publish_receipts (client_id, content_post_id, created_at desc)
  where content_post_id is not null;
