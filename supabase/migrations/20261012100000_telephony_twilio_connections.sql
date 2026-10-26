-- 电话接入加第二家供应商 Twilio：连接表放宽供应商取值，并加两列。
-- A 级（改已上线表结构）：生产应用前必须先预检，并等 PM 回「同意」。不含任何客户数据、令牌或号码。

alter table public.telephony_connections drop constraint if exists telephony_connections_provider_check;
alter table public.telephony_connections
  add constraint telephony_connections_provider_check check (provider in ('voipline', 'twilio'));

-- Twilio 用账号令牌做签名校验，令牌放服务器环境变量（secret_ref 只是变量名），库里不存令牌；VoIPLine 才用令牌哈希
alter table public.telephony_connections alter column webhook_token_hash drop not null;
alter table public.telephony_connections add column if not exists secret_ref text;
-- Twilio 来电转给哪个员工号码（E.164）
alter table public.telephony_connections add column if not exists forward_to text;

-- 两种供应商各自必须配齐自己要的东西、且不许带对方的东西（缺了就连不上，不是静默放行）
alter table public.telephony_connections drop constraint if exists telephony_connections_provider_secret_check;
alter table public.telephony_connections
  add constraint telephony_connections_provider_secret_check check (
    (provider = 'voipline' and webhook_token_hash is not null and secret_ref is null)
    or (
      provider = 'twilio'
      and webhook_token_hash is null
      -- 令牌环境变量名只许这个前缀（运行时同样校验），写错一行也不会让服务读到别的密钥
      and secret_ref is not null and secret_ref ~ '^TWILIO_AUTH_TOKEN_[A-Z0-9_]{1,40}$'
      -- 来电转接的员工号码必须是 E.164
      and forward_to is not null and forward_to ~ '^\+[1-9][0-9]{7,14}$'
    )
  );
