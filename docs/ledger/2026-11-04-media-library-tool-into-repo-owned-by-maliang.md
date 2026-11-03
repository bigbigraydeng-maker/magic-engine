---
id: 2026-11-04-media-library-tool-into-repo-owned-by-maliang
title: 素材入库打标签工具从本机没提交的文件夹收进正式代码，素材库统一交给马良管（不另开仓库、不另造 agent）
status: done
owner: agent
decided_on: 2026-11-04
source: session:369fcc9e
verify_how: 在主干检出里跑 npx vitest run scripts/media-library，要求 4 个测试文件 19 条全过且 0 条跳过（本机装有 ffprobe）；再跑 node scripts/media-library/automation-cli.mjs status ~/Dropbox/MagicLab_Studio/00_Inbox/industry-travel "$HOME/Library/Application Support/Magic Engine/media-intake" /dev/null，输出里 tagging_pending 加 reference_only 至少 337（11-04 读数）才算读到真实记录；最后 docs/agents/60-maliang.md 顶部要有「素材库归马良管」一段。三条都满足才算成。
done_on: 2026-11-04
done_ref: pr:3585
---
起因：PM 要一个专门管素材的地方和 agent，负责素材质量、标签以及和流水线的对接。实查发现：入库工具只存在于本机一个没提交的检出目录里（magic-engine-media-storage）；素材库 500 条记录全部待确认、没有一条能被自动选片；主干代码里没有任何地方读它。
本卡只管第一步：工具进仓库、在马良岗位说明里写清真实位置。PM 同意的后两步（审核放行、出片机和 ME 后台从已审核清单选片）各自另开卡，开工前先跟 PM 讲清楚。
原计划里「CTS 收件箱也自动入库」没做：那个收件箱里多是成片和员工照，不是原始素材；而且照现在的写法，监听会把文件记成「未分类」，跟目录里已有的 CTS 归属冲突，导致整轮同步失败。
后续（子牙审查提出）：做审核放行之前，先把来源词表对齐到 src/lib/assets/provenance.ts，不再另造第三套；共享代码里的 tour_ids 字段和「tour inclusion」这类提示词措辞，到时一并改成行业中立的写法。
