# FUTURE-ME-COMPAT · 插件与未来 ME 系统的接管路径

> 本文档定义 `me-client-discovery` 插件（Phase 0）如何**无缝接管**未来 ME 系统的
> DAPE-Discovery 段（Phase 1-3）· 让今天写的东西不成为技术债，明天司马徽 agent 上线后自然接管。

---

## 四阶段兼容路线

```
Phase 0 · 今天（2026-07）
├── 载体：me-client-discovery plugin
├── 数据：JSON 落本地 docs/clients/{slug}/discovery/{date}/
├── 触发：手动 /discovery-scan
├── 部署：/deploy-deck 到 Cloudflare Pages
└── 用户：PM + 澳洲同事 + FDE

Phase 1 · 下月（2026-08）
├── ME 加 3 张表（competitor_snapshots / market_context_snapshots / local_media_channels）
├── ME 加 endpoint /api/discovery/scan-results
├── plugin 的 /sync-to-me 解锁真跑（Phase 0 是 stub）
├── 客户详情页加"Discovery"tab（读表）
└── 数据双写：本地 + ME 后台

Phase 2 · Week 4+（2026-09）
├── 客户详情页 Discovery tab UI 上线
├── FDE 可以 in-place 编辑 snapshot（如手动补一条 review）
├── /synthesize-deck 增加"数据源=api"模式
└── /deploy-deck 走 ME 后台统一部署（plan.magicengine.com.au/{slug}）

Phase 3 · Q1 2027 后
├── 司马徽 agent v1 上线（DAPE-D 自动化）
├── 触发：新客户签约自动 cron / 每月自动重扫
├── 写同 3 张表（source = 'simatai_auto'）
├── plugin 变成"admin 手工重扫补漏"工具
└── UI 上区分 badge：手工 vs 自动 · 用户可对比两者差异
```

**每一步向前兼容 · 无 breaking change**：数据 schema 一次定死，plugin / API / 司马徽都消费同一份 JSON。

---

## 数据契约（Phase 0 定死 · Phase 1-3 沿用）

### 3 份 JSON schema（详见 `plugins/me-client-discovery/schemas/`）

| Schema 文件 | 未来 ME 表 | 用户 | 消费方 |
|---|---|---|---|
| `competitor-snapshot.schema.json` | `competitor_snapshots` | plugin / 司马徽 | 客户详情页 · 华佗（Analysis）· 诸葛亮（Prescription）|
| `market-context.schema.json` | `market_context_snapshots` | plugin / 司马徽 | 客户详情页 · 华佗（Analysis）|
| `local-media-channel.schema.json` | `local_media_channels` | plugin / 司马徽 | 诸葛亮（Prescription 选投放）|

### Source 字段（区分产出方 · 永久保留）

每条记录必有 `source` 字段，值：
- `plugin_manual` · me-client-discovery 手工触发（Phase 0-3 都可能）
- `simatai_auto` · 司马徽 agent 自动跑（Phase 3+）
- `manual_import` · FDE / PM 在 ME 后台手动输入或从 CSV 导入

**用途**：
- 客户详情页展示 badge："本次调研由 XX 产出"
- 数据信任度分级（`simatai_auto` 覆盖率高但可能标不确定；`plugin_manual` 更细但依赖 PM 判断）
- Rollup 时区分数据源（如某客户 3 个月内跑过 1 次 plugin + 12 次 simatai 自动 · 前者细节多后者趋势清）

---

## Phase 1 ME 端实施清单（未来子牙工作项）

### Migration 骨架（**不在本插件里 apply** · 属 ME repo 的 supabase/migrations · PM 拍板）

```sql
-- competitor_snapshots
CREATE TABLE IF NOT EXISTS public.competitor_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  competitor_name TEXT NOT NULL,
  scanned_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('plugin_manual', 'simatai_auto', 'manual_import')),
  snapshot_json JSONB NOT NULL,  -- 符合 competitor-snapshot.schema.json
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, competitor_name, scanned_at)
);
CREATE INDEX idx_competitor_snapshots_client ON public.competitor_snapshots(client_id, scanned_at DESC);

-- market_context_snapshots
CREATE TABLE IF NOT EXISTS public.market_context_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  geography_region_name TEXT NOT NULL,
  scanned_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('plugin_manual', 'simatai_auto', 'manual_import')),
  snapshot_json JSONB NOT NULL,  -- 符合 market-context.schema.json
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, geography_region_name, scanned_at)
);
CREATE INDEX idx_market_context_client ON public.market_context_snapshots(client_id, scanned_at DESC);

-- local_media_channels
CREATE TABLE IF NOT EXISTS public.local_media_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  media_name TEXT NOT NULL,
  category TEXT NOT NULL,
  discovered_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('plugin_manual', 'simatai_auto', 'manual_import')),
  channel_json JSONB NOT NULL,  -- 符合 local-media-channel.schema.json
  roi_rank INT,
  chinese_relevant BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, media_name)
);
CREATE INDEX idx_local_media_client ON public.local_media_channels(client_id, roi_rank);

-- RLS · 全部走 service_role 模板（CLAUDE.md 强约束）
ALTER TABLE public.competitor_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.competitor_snapshots FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.market_context_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.market_context_snapshots FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.local_media_channels ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.local_media_channels FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

### API endpoint 骨架

```typescript
// src/app/api/discovery/scan-results/route.ts

export async function POST(req: NextRequest) {
  // 1. 校验 Bearer token · 拒绝无 token / 无权限
  // 2. Parse body · 验 3 份 JSON 符合 schema
  // 3. supabaseAdmin upsert 3 张表（with source 字段）
  // 4. Response 200 { written: {...}, discovery_tab_url: '...' }
}
```

### 客户详情页 Discovery tab（Phase 2）

```
/dashboard/clients/[id]/discovery/
├── 概览：竞对数量 · 上次 scan 时间 · 数据源分布
├── 竞争白地图：矩阵表 · 与本插件生成的 deck 第贰章样式一致
├── 市场速写：房价 / 学区 / 华人 % / 市场热度
├── 本地媒体：按 roi_rank 排序的渠道卡片
└── 历史版本：同一客户历次 scan 的时间线（plugin_manual vs simatai_auto badge）
```

---

## Phase 3 司马徽 agent 触发规则（给未来 spec 用）

**触发场景**：
1. 新客户签约后 24 小时内自动跑一次（onboarding 触发）
2. 每 30 天自动重扫一次（rolling context refresh）
3. 客户重大变化触发（如换品牌 / 换战场 · 由 FDE 手动触发）
4. Plugin 手工重扫补漏（PM 觉得某次自动扫遗漏 · 手动跑本 plugin 覆盖）

**司马徽 = 本插件 5 skill 的自动化封装**：
- discovery-scan → 换成 backend job · 用同一批 agent prompt
- synthesize-deck → 换成 Next.js SSR 渲染同一批组件
- deploy-deck → 换成走 ME 统一部署管道
- sync-to-me → 直接 supabaseAdmin 写表 · 不走 HTTP
- sanity-check → 换成 pre-write 校验层 · 有 red flag 不写 · 发通知给 FDE

**同一批 agent prompt** 意味着：**今天写在 SKILL.md 里的 prompt 骨架就是未来司马徽的 prompt spec**。

---

## 不做什么（防止过度设计）

- ❌ 现在建 ME 表（PM 拍板 · Phase 1 才做）
- ❌ 现在写 ME API endpoint 代码（Phase 1 才做）
- ❌ 现在设计客户详情页 Discovery tab UI（Phase 2 才做）
- ❌ 现在写 mustache 完整模板引擎（synthesize-deck skill 让 Claude 直接生成 HTML 更灵活）
- ❌ 现在把司马徽 agent 骨架写好（Q1 2027 事 · 别今天写明天丢）

**做的**：schema 定死 + skill 定义清 + 4 阶段路径记录清 · 让未来子牙照单子接管，不用重新想。
