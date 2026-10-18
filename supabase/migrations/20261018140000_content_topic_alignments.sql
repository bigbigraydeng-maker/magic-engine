-- Evidence-backed topic alignment for organic YouTube content.
-- The source tables remain authoritative; this row records the editorial choice
-- and the exact evidence checked for one content_post.
create table if not exists public.content_topic_alignments (
  content_post_id uuid primary key references public.content_posts(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  content_title_snapshot text not null,
  video_format text not null check (video_format in ('long', 'short')),
  primary_keyword text not null,
  search_intent text not null,
  audience_market text not null,
  google_evidence jsonb not null default '{}'::jsonb,
  youtube_evidence jsonb not null default '{}'::jsonb,
  website_url text not null,
  website_theme text not null,
  website_check jsonb not null default '{}'::jsonb,
  promotion_url text,
  promotion_check jsonb not null default '{}'::jsonb,
  promotion_alignment text not null check (promotion_alignment in ('aligned', 'not_applicable', 'unknown', 'conflict')),
  promotion_note text,
  campaign_brief_id uuid references public.campaign_briefs(id) on delete set null,
  campaign_source_hash text,
  ads_alignment text not null check (ads_alignment in ('aligned', 'not_applicable', 'unknown', 'conflict')),
  ads_note text,
  social_plan_id uuid references public.social_plans(id) on delete set null,
  social_source_hash text,
  social_alignment text not null check (social_alignment in ('aligned', 'not_applicable', 'unknown', 'conflict')),
  social_note text,
  content_promise text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_topic_alignments_client_idx
  on public.content_topic_alignments (client_id, updated_at desc);

alter table public.content_topic_alignments enable row level security;
create policy content_topic_alignments_service_role on public.content_topic_alignments
  for all to service_role using (true) with check (true);
revoke all on public.content_topic_alignments from anon, authenticated;
grant select, insert, update, delete on public.content_topic_alignments to service_role;

create trigger content_topic_alignments_updated_at
  before update on public.content_topic_alignments
  for each row execute function public.handle_updated_at();
