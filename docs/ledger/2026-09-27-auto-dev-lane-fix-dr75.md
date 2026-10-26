---
id: 2026-09-27-auto-dev-lane-fix-dr75
title: 自动开发车道补审 DR75 修复（5 BLOCKER + 4 MUST-FIX）
status: done
owner: agent
decided_on: 2026-09-27
source: session:fd4b0edd
done_on: 2026-09-27
done_ref: pr:2085
verify_by: 2026-10-01
verify_how: npm test -- scripts/auto-dev 全绿（110 tests）；sandbox 实测 .git/config 写入被拒、/usr/bin/security 被拒、网络被拒、home 读被拒；intercept hook 实测 --admin/gh pr merge/push main 被拦、非 auto-dev 会话放行；CLI 入口 gates/pick/brake 实测输入输出正确
---
DR75-1: sandbox.sb 加 `(allow file-read* (literal "/"))` 让沙箱能启动。
DR75-2: sandbox.sb deny .git 写入 + .aider.conf.yml + .env（deny-override 放在 allow 后面）。
DR75-3: intercept-hook.sh 完全重写（grep -qF 修复 --admin flag 问题、加会话路径过滤、补 gh api -f/gh pr merge/--force-with-lease）。
DR75-4: gates/pick/brake 三个 CLI 入口 + lane-prompt 步骤重排为 commit-first-then-check-then-push-by-SHA。
DR75-5: lane-prompt 加 R5 self-check + sandbox self-test 用绝对路径 + -D 参数 + 进程组清理 + 内容哈希前后对比。
DR75-7: clone 改用 --no-local 避免 hardlink。
DR75-8: /private/tmp 收窄为 TASK_TMP 参数 + deny exec /usr/bin/security。
DR75-9: pick.mjs 加 lastEditors 信任检查。
DR75-10: gates.mjs 加 writeFileSync/exec(/spawn(/as any/fetch ( 五个 content ban。
当场试跑: lane-prompt 加 ## 当场试跑段模板。
