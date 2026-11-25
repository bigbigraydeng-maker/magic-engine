---
id: 2026-11-25-cts-old-me-add-staff-kevin
title: CTS 老版 ME 新增员工 Kevin（PM 11-25 回「同事」：普通员工档，同 Baker/Summer）；不用真邮箱，登录名 kevin@cts-staff.magicengine.cloud + 密码
status: done
owner: pm
decided_on: 2026-11-25
source: session:76c4cd7a
done_on: 2026-11-25
done_ref: doc:docs/ledger/2026-11-25-cts-old-me-add-staff-kevin.md
verify_by: 2026-11-26
verify_how: 生产库 auth.users 里有 kevin@cts-staff.magicengine.cloud 且已确认；client_portal_users 对应一行 client_id=CTS、access_type=both、scoped_admin=false；用该登录名+密码在 /login 能进 CTS 后台
---
老版 ME 密码登录必须填邮箱，所以用一个收不到信的登录名代替（cts-staff.magicengine.cloud 子域没有收信设置）。
已做：client_portal_users 加了一行（id 5324e552-133c-4f1a-b96d-f72ff55d6105），直接写库、没走邀请接口，所以没有发邀请邮件。
已做（2026-11-25）：PM 在自己终端运行脚本设了密码（密码不经 agent），登录账号 id d6bb7d7e-7926-4503-b7a7-14e986926643，已确认、有密码，和上面那行对上。还没核：用这个登录名加密码真的在 /login 登进去（agent 不知道密码，要 Kevin 或 PM 试一次）。
坑：本机 .env.local 里 NEXT_PUBLIC_SUPABASE_URL 写了两遍，脚本照抄会拼出坏地址，一声不响就失败；要取第一行。
注意：这个登录名收不到「忘记密码」邮件，Kevin 忘了密码只能由我们重设。
