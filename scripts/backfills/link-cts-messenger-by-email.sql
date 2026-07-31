-- 一次性回填：把 CTS 的 Messenger 孤儿对话接到已有的人身上（只按邮箱强匹配）
--
-- 背景：Messenger 每小时同步早已把 444 段对话/1694 条消息拉进 conversations，
-- 但 contact_id 全 NULL —— 对「今天该联系谁」完全隐形（该读模型只读 contact_touchpoints）。
--
-- 为什么只按邮箱、且只 LINK 不 CREATE（三审焊死的安全闸）：
--   · Meta 的 Page 自动回复 / Business AI 会把「业务自己的」info@ctstours.co.nz、
--     电话号写进正文 —— 从正文抽联系方式再建人 = 会造出一个假的
--     "info@ctstours.co.nz" 联系人并把几十段对话错并上去（魏征红线）。
--   · 所以这里反过来：只有「已存在的真实客户邮箱（非 @ctstours.co.nz）」原样出现在
--     某段对话正文里，才把该对话接到那个人身上。绝不从正文新建联系人 → 335 人干净表
--     一个空壳都不会多（板桥红线）。
--   · 实测 308 段命中，且每段只命中唯一一个人（0 歧义）。名字核对：Messenger 显示名
--     ≈ 联系人名（少数是婚前/婚后姓不同，正好是「只认邮箱不认名字」要处理的情况）。
--
-- 幂等：conversations 只补 NULL；identities / touchpoints 全 ON CONFLICT DO NOTHING；
-- last_seen 只 GREATEST 往前推。重跑安全、无副作用。
--
-- 已于 2026-07-29 对生产库(glbdnayojixmexgofbsd)执行并验证：
--   308 段接上人 · 308 fb_psid 身份 · 616 触点(308 来信+308 我方回复) ·
--   contacts 仍 335（0 新建）· 30 人「在等我们回」· 264 人三线(表单+电话+私信)并成一个记录。
--
-- 说明：这是「存量回填」。让「未来新对话自动接上」是下一步 —— 改 src/lib/messenger/sync.ts
-- 增补 resolveContact + 写触点 + per-thread 容错 + 合并时迁移 conversations.contact_id。

CREATE TEMP TABLE mm AS
WITH cts_email_ids AS (
  SELECT contact_id, value AS email FROM contact_identities
  WHERE client_id='c0000000-0000-0000-0000-000000000000' AND kind='email'
    AND value <> '' AND value NOT LIKE '%@ctstours.co.nz'   -- 排除业务自家域名
),
raw_hits AS (
  SELECT c.id AS convo_id, c.participant_psid, c.participant_name,
         c.last_message_at, c.message_count, c.last_message_from, e.contact_id
  FROM conversations c
  JOIN conversation_messages m ON m.conversation_id = c.id
  JOIN cts_email_ids e ON lower(COALESCE(m.body,'')) LIKE '%'||e.email||'%'
  WHERE c.client_id='c0000000-0000-0000-0000-000000000000' AND c.channel='messenger'
    AND c.contact_id IS NULL
),
uniq AS (SELECT convo_id FROM raw_hits GROUP BY convo_id HAVING COUNT(DISTINCT contact_id)=1),
matched AS (
  SELECT rh.convo_id,
         MAX(rh.contact_id::text)::uuid AS contact_id,
         MAX(rh.participant_psid)  AS participant_psid,
         MAX(rh.participant_name)  AS participant_name,
         MAX(rh.last_message_at)   AS last_message_at,
         MAX(rh.message_count)     AS message_count,
         MAX(rh.last_message_from) AS last_message_from
  FROM raw_hits rh JOIN uniq u ON u.convo_id=rh.convo_id
  GROUP BY rh.convo_id
)
SELECT mt.*,
  (SELECT MAX(m.sent_at) FROM conversation_messages m WHERE m.conversation_id=mt.convo_id AND m.direction='inbound')  AS last_in,
  (SELECT MAX(m.sent_at) FROM conversation_messages m WHERE m.conversation_id=mt.convo_id AND m.direction='outbound') AS last_out
FROM matched mt;

UPDATE conversations c SET contact_id = mm.contact_id, updated_at = now()
FROM mm WHERE c.id = mm.convo_id AND c.contact_id IS NULL;

INSERT INTO contact_identities (contact_id, client_id, kind, value, first_source)
SELECT mm.contact_id, 'c0000000-0000-0000-0000-000000000000', 'fb_psid', mm.participant_psid, 'messenger'
FROM mm WHERE mm.participant_psid IS NOT NULL AND mm.participant_psid <> ''
ON CONFLICT (client_id, kind, value) DO NOTHING;

INSERT INTO contact_touchpoints (client_id, contact_id, channel, direction, occurred_at, summary, metadata, source, source_ref)
SELECT 'c0000000-0000-0000-0000-000000000000', mm.contact_id, 'messenger', 'inbound',
       COALESCE(mm.last_in, mm.last_message_at),
       'Messenger 私信（'||mm.message_count||' 条往来）',
       jsonb_build_object('thread_id', mm.convo_id, 'participant_name', mm.participant_name,
                          'last_message_from', mm.last_message_from, 'message_count', mm.message_count,
                          'linked_by','email_in_thread'),
       'messenger', mm.convo_id::text||':in'
FROM mm WHERE mm.last_in IS NOT NULL
ON CONFLICT (client_id, source, source_ref) DO NOTHING;

INSERT INTO contact_touchpoints (client_id, contact_id, channel, direction, occurred_at, summary, metadata, source, source_ref)
SELECT 'c0000000-0000-0000-0000-000000000000', mm.contact_id, 'messenger', 'outbound',
       mm.last_out, '我们在 Messenger 回复过',
       jsonb_build_object('thread_id', mm.convo_id, 'sender','page'),
       'messenger', mm.convo_id::text||':out'
FROM mm WHERE mm.last_out IS NOT NULL
ON CONFLICT (client_id, source, source_ref) DO NOTHING;

UPDATE contacts ct SET last_seen_at = GREATEST(ct.last_seen_at, mm.last_message_at), updated_at = now()
FROM mm WHERE ct.id = mm.contact_id AND mm.last_message_at IS NOT NULL;
