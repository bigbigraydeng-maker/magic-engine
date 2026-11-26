---
id: 2026-10-10-viral-references-command-injection-p0
title: 紧急：admin/viral-references 一组接口无登录且网址被拼进命令，任何人可让服务器执行命令
status: done
owner: pm
decided_on: 2026-10-10
source: doc:docs/audits/2026-10-10-api-client-ownership-audit.md
verify_by: 2026-10-12
verify_how: 修复后该组接口未登录返回 401，且提交含特殊字符或非 http 的网址被拒；另需查服务器日志有无被利用，有可疑则换全部密钥
done_on: 2026-10-10
done_ref: pr:2432
last_checked: 2026-11-08
check_note: 今晚对 app.magicengine.com.au 这组 6 个接口不登录调用全部返回 401（带特殊字符网址也是 401）；下载改成参数数组调用并在网址前加了 -- 隔断；但修复前有没有被利用要看 10-10 以前的服务器日志，早已过保留期查不到，判不了
---
等 PM 回「紧急修」后另开单独窗口修。要点：加登录、命令改参数数组方式调用并只放行 http(s)、worker 重试路径同步堵。
