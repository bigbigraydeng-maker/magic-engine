-- 邮件渠道的 Governed Reply Agent kill switch（issue #1745）。
--
-- 跟 20260913095601_conversation_reply_drafts.sql 里加的
-- messenger_agent_enabled_messenger / messenger_agent_enabled_whatsapp 是
-- 同一件事的第三列——channel-dispatch.ts 的 isChannelEnabled() 按渠道查
-- 这一列，不经过任何缓存（PM 拍下"关掉某客户的邮件自动回复"要在秒级生效）。
-- 默认 false：新客户/新渠道默认关闭，需要 FDE 在设置页显式打开。
alter table clients add column if not exists messenger_agent_enabled_email boolean not null default false;
