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
---
等 PM 回「紧急修」后另开单独窗口修。要点：加登录、命令改参数数组方式调用并只放行 http(s)、worker 重试路径同步堵。
