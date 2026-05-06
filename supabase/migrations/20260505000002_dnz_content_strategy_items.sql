-- P8.D.1.1: content_strategy_items — 3D content strategy recommendations
--
-- Output of the strategy analyzer (Phase 8.D.1) which crosses:
--   • AI Tracker weak spots (ai_visibility_queries / runs)
--   • SEMrush keyword opportunities
--   • client_site_pages (existing content gaps)
--
-- Each row is a single, scored, actionable recommendation:
-- "upgrade page X" | "publish new blog Y" | "amplify topic Z on social".
--
-- Reference: ARCHITECTURE.md §3.7, ROADMAP.md P8.D.1.1

create table if not exists content_strategy_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  strategy_run_id uuid not null,                  -- groups items produced by one analyzer run

  -- classification
  action_type text not null
    check (action_type in ('upgrade_page','new_blog','social_content')),
  content_mode text not null
    check (content_mode in ('unified','geo_only','seo_only')),

  -- priority
  priority text not null default 'medium'
    check (priority in ('critical','high','medium','low')),
  priority_score real not null default 0,         -- 0–100

  -- recommendation payload
  proposed_title text,
  rationale text,
  content_angle text,                             -- how to differentiate from existing content

  -- 3D signal sources
  source_page_id uuid references client_site_pages(id) on delete set null,
  source_query_id uuid,                           -- ai_visibility_queries.id (FK softened to avoid cross-phase dep)
  source_keyword text,
  keyword_volume int,
  keyword_kd int,                                 -- 0-100

  -- execution state
  status text not null default 'pending'
    check (status in ('pending','approved','in_progress','done','dismissed')),
  linked_blog_post_id uuid,                       -- blog_posts.id once executed

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_content_strategy_items_client_status
  on content_strategy_items (client_id, status);

create index if not exists idx_content_strategy_items_client_run
  on content_strategy_items (client_id, strategy_run_id);

create index if not exists idx_content_strategy_items_client_score
  on content_strategy_items (client_id, priority_score desc);

create trigger content_strategy_items_updated_at
  before update on content_strategy_items
  for each row
  execute function update_updated_at_column();

alter table content_strategy_items enable row level security;

create policy content_strategy_items_admin_write
  on content_strategy_items for insert
  with check (true);

create policy content_strategy_items_admin_update
  on content_strategy_items for update
  using (true)
  with check (true);
