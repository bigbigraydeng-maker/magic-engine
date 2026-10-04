---
id: 2026-10-05-internal-secret-routes-hardening
title: reel-batch 与 team-memory 内部接口的密钥写法需加固（非常数时间比较、复用数据库根钥匙）
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_how: 改完后写单测证明坏请求被拒，并在本地起开发服务手动试一次（不碰生产）
---
reel-batch/start|approve 用 x-internal-secret 与 SUPABASE_SERVICE_ROLE_KEY 做 !== 比较，等于把数据库根钥匙当接口密码；team-memory/* 用 CRON_SECRET 同样是 !== 比较且爆炸半径大。全仓也没找到 reel-batch 调用方。
修法：各用独立密钥 + timingSafeEqual。
