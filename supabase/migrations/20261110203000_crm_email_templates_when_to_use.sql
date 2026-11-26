-- CRM 邮件模板加一列「什么时候用」，给同事看这份模板该在什么情况下拿出来。
-- 可空，不设默认值，不回填已有行（已有行保持空）。
-- 表仍是只增不改；这一列跟着新版本走，不改旧行。
-- RLS 仍是表级 service_role 策略，不用为这一列另写策略。
-- 生产库先不要执行。等 Ray 合并本变更时再应用。

alter table public.crm_email_templates
  add column when_to_use text
  check (when_to_use is null or char_length(when_to_use) <= 200);

comment on column public.crm_email_templates.when_to_use is
  '给同事看的「什么时候用」。空 = 没写。不参与发信判断。';
