---
id: 2026-10-06-remotion-pack-a-music-auto-beats
title: Remotion 包 A：音乐目录 + 自动节拍 + 清单模板 logo 只留最后 2 拍（已做完，待合并后在真实出片里再量一次）
status: done
owner: agent
decided_on: 2026-10-06
source: doc:docs/specs/2026-10-06-remotion-template-catalog-and-selector.md
verify_by: 2026-10-13
verify_how: 合并后用真实 CTS 内容渲一条清单成片，用 qa 脚本量音画偏差在 ±50 毫秒内；并把 pending_listen 的歌逐首量过后转 ready。
done_on: 2026-10-06
done_ref: doc:docs/audits/2026-10-06-remotion-pack-a-music-auto-beats.md
---
包 A 只做音乐目录、自动节拍工具和 logo 改动，不接出片机、不做选择器。当场试跑数字与 9 宫格结论见审计文档；只有 pipa-trap 一首量过，其余 28 首节拍还没量，标 beats_unverified（原「待听」，只指节拍没量过，与版权无关；状态值 pending_listen 已改名，见 PR #2283）。
