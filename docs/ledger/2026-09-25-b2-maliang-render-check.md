---
id: 2026-09-25-b2-maliang-render-check
title: 马良出片自检上线：每条 Creatomate 成片落库后自动按 9 个时刻逐镜看图/字/logo，过关才进 PM 审片待办（署名马良），不过关标返工原因并问 PM 返工还是放弃
status: done
owner: agent
decided_on: 2026-09-25
source: session:121634d6
verify_by: 2026-10-13
verify_how: 合并后（GEMINI_API_KEY 已在 Render 配好）挑一条客户内容点「确认做片」，Creatomate 成片落库 10 分钟内看该 content_posts 行 generation_context_snapshot.maliang_check 有 status=pass/fail/unverifiable（不能为空）；cron_run_logs 有 job_name=maliang-render-check 的行；次个工作日待办邮件出现「马良：」条目。人工抽查：把同一条片自己截 9 帧对一遍，马良判的图/字/logo 结论与人眼一致才算成（样本 ≥3 条片）
done_on: 2026-09-25
done_ref: pr:2017
last_checked: 2026-10-13
---
agent 自治计划 B2（docs/specs/2026-09-24-agent-autonomy-operating-plan-v1.md §4.1 马良），三只闹钟之一。
事件 me/maliang.render.ready 由 factory-creatomate-render.ts finalize-success 后发；云端函数 cloud-maliang-render-check 下载成片（只信任本项目 Supabase Storage 主机）→ Gemini 视频理解（viral-analyzer 同款 Files API 路径）→ 纯函数裁决 → 有边界写回 generation_context_snapshot.maliang_check；不过关把渲染工单标 needs_rework + 原因。
没钥匙 / 下载失败 / 回答格式不对 = unverifiable 不判，不给「过关」默认值。待办兜底：出片 2 小时后仍无自检记录 → 「马良还没检」进系统欠账栏。本机 ffmpeg 工单线（广告线）未接，另开卡。
