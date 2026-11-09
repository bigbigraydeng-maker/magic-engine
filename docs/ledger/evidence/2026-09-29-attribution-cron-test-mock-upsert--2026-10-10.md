# 证据 · 2026-09-29-attribution-cron-test-mock-upsert · 2026-10-10

fetched_at: 2026-10-10

查了什么：卡上 verify_how 指定的命令，在合并后的主干代码上的结果。

命令：npx vitest run src/app/api/cron/attribution

数字：34 条全部通过、零失败（卡内记录的 2026-10-10 合并主干实测；Codex 在 PR #2436 的提交树 c3961c8 上按同一命令复跑，结果相同）。

说明：本次修复会话的运行环境没装依赖，vitest 无法启动（退出码 1，配置加载失败），所以这里没有自己重跑；以上两处结果是引用，不是本会话实测。

结论：成。
