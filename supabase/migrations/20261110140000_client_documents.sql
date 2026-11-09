-- ════════════════════════════════════════════════════════════════════════════
-- 客户资料库（文件下载）
-- 设计稿：docs/specs/2026-11-10-client-document-library-v0.1.md
--
-- client_documents      每个客户放手册、单页资料、价格表这类能下载的文件。
--                       表里只记登记信息，文件本体在私有桶里。
-- me-client-documents   私有存储桶：不公开、不建任何 storage 策略（只有 service_role 能读写）。
--
-- 访问边界（应用层 + 本迁移的数据库层各挡一道）：
--   · 只有服务端用 service_role 读写；anon / authenticated 一律收回
--   · storage_path 必须是「<client_id>/<本行 id>/<安全文件名>」，数据库层再拦一道串客户
--   · 同一客户同一内容（SHA-256）只能有一份现行文件
--
-- 回滚：先通过存储接口（不是 SQL）清空并删除桶 me-client-documents——托管版 Supabase 不允许用 SQL
--       直接删 storage 里的行——再 drop table public.client_documents。没有别的表、函数或视图依赖它。
-- 注意：client_id 外键没有写 on delete，所以删除一个资料库里还有文件的客户会被拦住；
--       客户下线时要先清空那个客户的资料库（目前没有自动清理）。
-- ════════════════════════════════════════════════════════════════════════════

create table public.client_documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  -- 类别由应用层校验（新增类别不用改库）：brochure | sheet | price | brand | contract | other
  category text not null check (char_length(category) between 1 and 40),
  title text not null check (char_length(title) between 1 and 200),
  description text check (description is null or char_length(description) <= 1000),
  version_label text check (version_label is null or char_length(version_label) <= 40),
  -- internal = 只有 Magic Lab 内部看得到；client = 客户自己的付费账号也能下载
  visibility text not null default 'internal' check (visibility in ('internal', 'client')),
  -- current = 现行；archived = 旧版（只有内部看得到）
  status text not null default 'current' check (status in ('current', 'archived')),
  storage_bucket text not null default 'me-client-documents' check (storage_bucket = 'me-client-documents'),
  storage_path text not null unique,
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  mime_type text not null check (mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png',
    'image/jpeg',
    'image/webp'
  )),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by text not null check (char_length(uploaded_by) between 3 and 320),
  -- 换新版时，新行指向被换下的旧行
  replaces_id uuid references public.client_documents(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by text,
  constraint client_documents_path_shape check (
    storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-][A-Za-z0-9._-]{0,119}$'
    and split_part(storage_path, '/', 1) = client_id::text
    and split_part(storage_path, '/', 2) = id::text
  ),
  constraint client_documents_archive_consistent check ((status = 'archived') = (archived_at is not null))
);

create index client_documents_client_idx
  on public.client_documents (client_id, status, category, created_at desc);

-- 同一客户同一内容只能有一份现行文件；旧版不占位，所以可以回退到旧内容
create unique index client_documents_current_sha_uidx
  on public.client_documents (client_id, sha256)
  where status = 'current';

comment on table public.client_documents is
  '客户资料库：能下载的文件登记表（手册、单页资料、价格表等）。文件在私有桶 me-client-documents，只经服务端核对身份后发 60 秒临时链接。设计稿 2026-11-10。';
comment on column public.client_documents.visibility is
  'internal=仅 Magic Lab 内部；client=客户自己的付费账号也能下载。默认 internal，必须有人明确选 client。';

-- RLS：service-role 模板（必须带 TO service_role，漏掉 = 对匿名访客敞开读写）
alter table public.client_documents enable row level security;

create policy client_documents_service_role
  on public.client_documents
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.client_documents from anon, authenticated;

-- 私有桶：不公开，不给任何 storage 策略（只有 service_role 能读写）。
-- 冲突时强制改回私有，防止桶被人手工改成公开后重放迁移仍保持公开。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'me-client-documents',
  'me-client-documents',
  false,
  52428800,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
