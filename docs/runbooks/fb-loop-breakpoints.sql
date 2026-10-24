-- Facebook 主页 → 广告 → CRM 闭环断点（只读）
--
-- 每条 SELECT 独立，可单独跑。只读，没有 INSERT / UPDATE / DELETE。
-- 不要对生产库执行，除非 Ray 明确点头。本文件随文档提交，提交时没有执行。
--
-- 客户范围：在服务（client_status = active），并且主页 id、广告账户或 Meta 连接至少有一项。
-- 窗口：最近 7 天。计数为 0 且时间为空 = 这一环没有留下记录（可能是没发生，也可能是令牌断了写不进来）。
-- 不选取令牌列、主页号码、广告账户号码、联系人姓名或正文。
--
-- 表和列来自 supabase/migrations：
--   clients.facebook_page_id / meta_ad_account_id / client_status / name
--   platform_oauth_connections (20260603000001)
--   client_meta_ad_accounts (20260913000001)
--   daily_plan_auto_publish_attempts (20261010100000)
--   content_work_orders.published_ref (20260715000001)
--   content_posts (20260425000001)
--   flywheel_metrics (20260517000001) — 互动滚动由 page-metrics-sync 写入
--   social_post_measurement_receipts (20260905000001)
--   flywheel_actions.action_type = ads.create_ad （draft-and-gate.ts）
--   ad_entity_snapshots.effective_status / captured_at (20260914000001)
--   ad_daily_insights.insight_date / spend (20260721000001)
--   contact_touchpoints.channel / direction / occurred_at (20260726000005)
--   conversations / conversation_messages （20260726000001 建，20260726000004 改名）
--   contacts.first_seen_at (20260726000004)
--   conversation_outbound_log （原 messenger_outbound_log，同一次改名）
--   me_sale_outcomes / me_conversion_writebacks (20260905000002)
--     该迁移文件头写明提交时尚未应用到生产。表不存在则这一环在库里还没有，记下来即可，不要建表。

-- ── 1. 主页帖已发布 ──────────────────────────────────────────────────────────
-- 三本账分开计，避免草稿被记成已发布（#2817）时混成一个数。
-- 工厂：content_work_orders.published_ref->>'video_state' = PUBLISHED 才算公开。
-- 日计划：status = published 只表示 Facebook 收下了。
--   scheduled_publish_time 在未来 = 还排着，没公开（patchFromOutcome 同时写
--   provider_impact = FB_SCHEDULED）。公开只计：没有排期时间（当时就发出）
--   或排期时间已到。时间用排期时刻，没有排期时间才用 updated_at。
-- 内容日历：content_posts.status = published 且 platforms 含 facebook。
WITH bounds AS (
  SELECT now() - interval '7 days' AS since
),
fb_clients AS (
  SELECT c.id, c.name
  FROM clients c
  WHERE c.client_status = 'active'
    AND (
      c.facebook_page_id IS NOT NULL
      OR c.meta_ad_account_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM platform_oauth_connections p
        WHERE p.client_id = c.id AND p.provider = 'meta'
      )
      OR EXISTS (
        SELECT 1 FROM client_meta_ad_accounts a
        WHERE a.client_id = c.id
      )
    )
),
factory AS (
  SELECT w.client_id,
         count(*) AS n,
         max((w.published_ref->>'published_at')::timestamptz) AS last_at
  FROM content_work_orders w
  CROSS JOIN bounds b
  WHERE w.published_ref->>'video_state' = 'PUBLISHED'
    AND (w.published_ref->>'published_at')::timestamptz >= b.since
  GROUP BY w.client_id
),
factory_draft_marked AS (
  SELECT w.client_id, count(*) AS n
  FROM content_work_orders w
  CROSS JOIN bounds b
  WHERE w.status = 'published'
    AND coalesce(w.published_ref->>'video_state', '') IS DISTINCT FROM 'PUBLISHED'
    AND w.updated_at >= b.since
  GROUP BY w.client_id
),
daily_plan_live AS (
  SELECT a.client_id,
         count(*) AS n,
         max(coalesce(a.scheduled_publish_time, a.updated_at)) AS last_at
  FROM daily_plan_auto_publish_attempts a
  CROSS JOIN bounds b
  WHERE a.status = 'published'
    AND (a.scheduled_publish_time IS NULL OR a.scheduled_publish_time <= now())
    AND coalesce(a.scheduled_publish_time, a.updated_at) >= b.since
  GROUP BY a.client_id
),
daily_plan_scheduled AS (
  SELECT a.client_id,
         count(*) AS n,
         min(a.scheduled_publish_time) AS next_at
  FROM daily_plan_auto_publish_attempts a
  WHERE a.status = 'published'
    AND a.scheduled_publish_time > now()
  GROUP BY a.client_id
),
calendar AS (
  SELECT p.client_id, count(*) AS n, max(p.published_at) AS last_at
  FROM content_posts p
  CROSS JOIN bounds b
  WHERE p.status = 'published'
    AND 'facebook' = ANY (p.platforms)
    AND p.published_at >= b.since
  GROUP BY p.client_id
)
SELECT
  c.id AS client_id,
  c.name AS client_name,
  coalesce(f.n, 0) AS factory_published_7d,
  f.last_at AS last_factory_published_at,
  coalesce(d.n, 0) AS factory_status_published_but_not_live_7d,
  coalesce(dp.n, 0) AS daily_plan_live_7d,
  dp.last_at AS last_daily_plan_live_at,
  coalesce(sch.n, 0) AS daily_plan_scheduled_not_live,
  sch.next_at AS next_daily_plan_scheduled_at,
  coalesce(cal.n, 0) AS content_posts_published_7d,
  cal.last_at AS last_content_post_published_at
FROM fb_clients c
LEFT JOIN factory f ON f.client_id = c.id
LEFT JOIN factory_draft_marked d ON d.client_id = c.id
LEFT JOIN daily_plan_live dp ON dp.client_id = c.id
LEFT JOIN daily_plan_scheduled sch ON sch.client_id = c.id
LEFT JOIN calendar cal ON cal.client_id = c.id
ORDER BY c.name;

-- ── 2. 互动已拉回 ────────────────────────────────────────────────────────────
-- 主页 7 日滚动：flywheel_metrics，metric_key = social.fb.reactions_7d，source = meta_page。
-- 单帖回执：social_post_measurement_receipts.status = ok。
WITH bounds AS (
  SELECT now() - interval '7 days' AS since
),
fb_clients AS (
  SELECT c.id, c.name
  FROM clients c
  WHERE c.client_status = 'active'
    AND (
      c.facebook_page_id IS NOT NULL
      OR c.meta_ad_account_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM platform_oauth_connections p
        WHERE p.client_id = c.id AND p.provider = 'meta'
      )
      OR EXISTS (
        SELECT 1 FROM client_meta_ad_accounts a
        WHERE a.client_id = c.id
      )
    )
),
pulls AS (
  SELECT m.client_id,
         count(*) AS n,
         max(m.measured_at) AS last_at
  FROM flywheel_metrics m
  CROSS JOIN bounds b
  WHERE m.metric_key = 'social.fb.reactions_7d'
    AND m.source = 'meta_page'
    AND m.measured_at >= b.since
  GROUP BY m.client_id
),
receipts AS (
  SELECT r.client_id,
         count(*) AS n,
         max(r.measured_at) AS last_at
  FROM social_post_measurement_receipts r
  CROSS JOIN bounds b
  WHERE r.status = 'ok'
    AND r.measured_at >= b.since
  GROUP BY r.client_id
)
SELECT
  c.id AS client_id,
  c.name AS client_name,
  coalesce(p.n, 0) AS page_rollup_pulls_7d,
  p.last_at AS last_page_rollup_at,
  coalesce(r.n, 0) AS post_measurement_ok_7d,
  r.last_at AS last_post_measurement_at
FROM fb_clients c
LEFT JOIN pulls p ON p.client_id = c.id
LEFT JOIN receipts r ON r.client_id = c.id
ORDER BY c.name;

-- ── 3. 广告已起草或在跑 ──────────────────────────────────────────────────────
-- 起草：flywheel_actions.action_type = ads.create_ad（只说明 ME 记过一次起草，不表示这次要去建）。
-- 在跑：近 7 天每个广告系列最新一条快照的 effective_status = ACTIVE。
-- 花费：先按 campaign 一层汇总，再跟客户名单相接。
-- daily-insights.ts 把同一笔花费写成 campaign、adset、ad 三行；不先收成一层再相加会算成三倍。
WITH bounds AS (
  SELECT now() - interval '7 days' AS since,
         (current_date - 7) AS since_date
),
fb_clients AS (
  SELECT c.id, c.name
  FROM clients c
  WHERE c.client_status = 'active'
    AND (
      c.facebook_page_id IS NOT NULL
      OR c.meta_ad_account_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM platform_oauth_connections p
        WHERE p.client_id = c.id AND p.provider = 'meta'
      )
      OR EXISTS (
        SELECT 1 FROM client_meta_ad_accounts a
        WHERE a.client_id = c.id
      )
    )
),
drafts AS (
  SELECT a.client_id, count(*) AS n, max(a.executed_at) AS last_at
  FROM flywheel_actions a
  CROSS JOIN bounds b
  WHERE a.action_type = 'ads.create_ad'
    AND a.executed_at >= b.since
  GROUP BY a.client_id
),
latest_campaign AS (
  SELECT DISTINCT ON (s.client_id, s.entity_id)
         s.client_id,
         s.effective_status,
         s.captured_at
  FROM ad_entity_snapshots s
  CROSS JOIN bounds b
  WHERE s.platform = 'meta'
    AND s.level = 'campaign'
    AND s.captured_at >= b.since
  ORDER BY s.client_id, s.entity_id, s.captured_at DESC
),
running AS (
  SELECT client_id,
         count(*) FILTER (WHERE effective_status = 'ACTIVE') AS n,
         max(captured_at) AS last_at
  FROM latest_campaign
  GROUP BY client_id
),
spend AS (
  SELECT i.client_id,
         coalesce(sum(i.spend), 0) AS spend_7d,
         max(i.insight_date) AS last_insight_date
  FROM ad_daily_insights i
  CROSS JOIN bounds b
  WHERE i.platform = 'meta'
    AND i.level = 'campaign'
    AND i.insight_date >= b.since_date
  GROUP BY i.client_id
)
SELECT
  c.id AS client_id,
  c.name AS client_name,
  coalesce(d.n, 0) AS ads_drafted_7d,
  d.last_at AS last_ad_draft_at,
  coalesce(r.n, 0) AS active_campaigns_seen_7d,
  r.last_at AS last_campaign_snapshot_at,
  coalesce(s.spend_7d, 0) AS spend_7d,
  s.last_insight_date
FROM fb_clients c
LEFT JOIN drafts d ON d.client_id = c.id
LEFT JOIN running r ON r.client_id = c.id
LEFT JOIN spend s ON s.client_id = c.id
ORDER BY c.name;

-- ── 4. 线索已进来 ────────────────────────────────────────────────────────────
-- 表单：contact_touchpoints.channel = meta_lead_form，direction = inbound（meta-lead.ts）。
-- 私信：conversation_messages.direction = inbound，且 conversations.channel = messenger。
WITH bounds AS (
  SELECT now() - interval '7 days' AS since
),
fb_clients AS (
  SELECT c.id, c.name
  FROM clients c
  WHERE c.client_status = 'active'
    AND (
      c.facebook_page_id IS NOT NULL
      OR c.meta_ad_account_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM platform_oauth_connections p
        WHERE p.client_id = c.id AND p.provider = 'meta'
      )
      OR EXISTS (
        SELECT 1 FROM client_meta_ad_accounts a
        WHERE a.client_id = c.id
      )
    )
),
forms AS (
  SELECT t.client_id, count(*) AS n, max(t.occurred_at) AS last_at
  FROM contact_touchpoints t
  CROSS JOIN bounds b
  WHERE t.channel = 'meta_lead_form'
    AND t.direction = 'inbound'
    AND t.occurred_at >= b.since
  GROUP BY t.client_id
),
dms AS (
  SELECT v.client_id, count(*) AS n, max(m.sent_at) AS last_at
  FROM conversation_messages m
  JOIN conversations v ON v.id = m.conversation_id
  CROSS JOIN bounds b
  WHERE v.channel = 'messenger'
    AND m.direction = 'inbound'
    AND m.sent_at >= b.since
  GROUP BY v.client_id
)
SELECT
  c.id AS client_id,
  c.name AS client_name,
  coalesce(f.n, 0) AS lead_form_touchpoints_7d,
  f.last_at AS last_lead_form_at,
  coalesce(d.n, 0) AS messenger_inbound_7d,
  d.last_at AS last_messenger_inbound_at
FROM fb_clients c
LEFT JOIN forms f ON f.client_id = c.id
LEFT JOIN dms d ON d.client_id = c.id
ORDER BY c.name;

-- ── 5. 已写进 CRM 联系人 ─────────────────────────────────────────────────────
-- 新联系人：contacts.first_seen_at 在窗口内，且能对上表单触点或私信会话。
-- 私信进了会话但 contact_id 仍空：人进来了，还没写成联系人。
WITH bounds AS (
  SELECT now() - interval '7 days' AS since
),
fb_clients AS (
  SELECT c.id, c.name
  FROM clients c
  WHERE c.client_status = 'active'
    AND (
      c.facebook_page_id IS NOT NULL
      OR c.meta_ad_account_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM platform_oauth_connections p
        WHERE p.client_id = c.id AND p.provider = 'meta'
      )
      OR EXISTS (
        SELECT 1 FROM client_meta_ad_accounts a
        WHERE a.client_id = c.id
      )
    )
),
linked AS (
  SELECT ct.client_id, count(DISTINCT ct.id) AS n, max(ct.first_seen_at) AS last_at
  FROM contacts ct
  CROSS JOIN bounds b
  WHERE ct.first_seen_at >= b.since
    AND (
      EXISTS (
        SELECT 1 FROM contact_touchpoints t
        WHERE t.contact_id = ct.id
          AND t.client_id = ct.client_id
          AND t.channel = 'meta_lead_form'
      )
      OR EXISTS (
        SELECT 1 FROM conversations v
        WHERE v.contact_id = ct.id
          AND v.client_id = ct.client_id
          AND v.channel = 'messenger'
      )
    )
  GROUP BY ct.client_id
),
unlinked AS (
  SELECT v.client_id, count(*) AS n, max(v.last_message_at) AS last_at
  FROM conversations v
  CROSS JOIN bounds b
  WHERE v.channel = 'messenger'
    AND v.contact_id IS NULL
    AND v.last_message_at >= b.since
  GROUP BY v.client_id
)
SELECT
  c.id AS client_id,
  c.name AS client_name,
  coalesce(l.n, 0) AS new_contacts_from_meta_7d,
  l.last_at AS last_new_contact_at,
  coalesce(u.n, 0) AS messenger_threads_without_contact_7d,
  u.last_at AS last_unlinked_thread_at
FROM fb_clients c
LEFT JOIN linked l ON l.client_id = c.id
LEFT JOIN unlinked u ON u.client_id = c.id
ORDER BY c.name;

-- ── 6. 跟进已发出 ────────────────────────────────────────────────────────────
-- conversation_outbound_log 不是私信专用：whatsapp/send.ts 成功后也写 status = sent。
-- 先按 conversations.channel 拆开再汇总，Messenger 与 WhatsApp 各一列。
-- 人记的跟进：contact_touchpoints.direction = outbound（电话 / 邮件 / 私信 / WhatsApp / 手工），不并进上面两列。
-- crm-lead-followup-digest 只组每日清单，不写发送行。清单有没有变成真正发出去：看这三列。待确认还有没有别的发送表。
WITH bounds AS (
  SELECT now() - interval '7 days' AS since
),
fb_clients AS (
  SELECT c.id, c.name
  FROM clients c
  WHERE c.client_status = 'active'
    AND (
      c.facebook_page_id IS NOT NULL
      OR c.meta_ad_account_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM platform_oauth_connections p
        WHERE p.client_id = c.id AND p.provider = 'meta'
      )
      OR EXISTS (
        SELECT 1 FROM client_meta_ad_accounts a
        WHERE a.client_id = c.id
      )
    )
),
sent_by_channel AS (
  SELECT o.client_id,
         count(*) FILTER (WHERE v.channel = 'messenger') AS messenger_n,
         max(o.created_at) FILTER (WHERE v.channel = 'messenger') AS messenger_last,
         count(*) FILTER (WHERE v.channel = 'whatsapp') AS whatsapp_n,
         max(o.created_at) FILTER (WHERE v.channel = 'whatsapp') AS whatsapp_last
  FROM conversation_outbound_log o
  JOIN conversations v ON v.id = o.conversation_id
  CROSS JOIN bounds b
  WHERE o.status = 'sent'
    AND v.channel IN ('messenger', 'whatsapp')
    AND o.created_at >= b.since
  GROUP BY o.client_id
),
outbound_touch AS (
  SELECT t.client_id, count(*) AS n, max(t.occurred_at) AS last_at
  FROM contact_touchpoints t
  CROSS JOIN bounds b
  WHERE t.direction = 'outbound'
    AND t.channel IN ('messenger', 'phone', 'email', 'whatsapp', 'meta_lead_form')
    AND t.occurred_at >= b.since
  GROUP BY t.client_id
)
SELECT
  c.id AS client_id,
  c.name AS client_name,
  coalesce(s.messenger_n, 0) AS messenger_sent_7d,
  s.messenger_last AS last_messenger_sent_at,
  coalesce(s.whatsapp_n, 0) AS whatsapp_sent_7d,
  s.whatsapp_last AS last_whatsapp_sent_at,
  coalesce(o.n, 0) AS outbound_touchpoints_7d,
  o.last_at AS last_outbound_touch_at
FROM fb_clients c
LEFT JOIN sent_by_channel s ON s.client_id = c.id
LEFT JOIN outbound_touch o ON o.client_id = c.id
ORDER BY c.name;

-- ── 7. 结果回到广告 ──────────────────────────────────────────────────────────
-- 事实：me_sale_outcomes.created_at。
-- 发给 Meta：me_conversion_writebacks.destination = meta_capi，按 status 分开计。
-- 迁移 20260905000002 文件头写尚未 apply。关系不存在就停止，不要建表。
WITH bounds AS (
  SELECT now() - interval '7 days' AS since
),
fb_clients AS (
  SELECT c.id, c.name
  FROM clients c
  WHERE c.client_status = 'active'
    AND (
      c.facebook_page_id IS NOT NULL
      OR c.meta_ad_account_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM platform_oauth_connections p
        WHERE p.client_id = c.id AND p.provider = 'meta'
      )
      OR EXISTS (
        SELECT 1 FROM client_meta_ad_accounts a
        WHERE a.client_id = c.id
      )
    )
),
facts AS (
  SELECT o.client_id, count(*) AS n, max(o.created_at) AS last_at
  FROM me_sale_outcomes o
  CROSS JOIN bounds b
  WHERE o.created_at >= b.since
  GROUP BY o.client_id
),
sent AS (
  SELECT o.client_id,
         count(*) FILTER (WHERE w.status = 'confirmed') AS confirmed_7d,
         count(*) FILTER (WHERE w.status IS DISTINCT FROM 'confirmed') AS other_7d,
         max(w.updated_at) AS last_at
  FROM me_conversion_writebacks w
  JOIN me_sale_outcomes o ON o.id = w.outcome_id
  CROSS JOIN bounds b
  WHERE w.destination = 'meta_capi'
    AND w.updated_at >= b.since
  GROUP BY o.client_id
)
SELECT
  c.id AS client_id,
  c.name AS client_name,
  coalesce(f.n, 0) AS sale_outcomes_7d,
  f.last_at AS last_sale_outcome_at,
  coalesce(s.confirmed_7d, 0) AS capi_confirmed_7d,
  coalesce(s.other_7d, 0) AS capi_not_confirmed_7d,
  s.last_at AS last_capi_writeback_at
FROM fb_clients c
LEFT JOIN facts f ON f.client_id = c.id
LEFT JOIN sent s ON s.client_id = c.id
ORDER BY c.name;
