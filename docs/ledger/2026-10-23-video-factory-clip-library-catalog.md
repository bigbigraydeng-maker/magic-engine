---
id: 2026-10-23-video-factory-clip-library-catalog
title: 视频工厂素材库进入 ME 工作台
status: done
owner: agent
decided_on: 2026-10-23
source: doc:docs/STATE.md
verify_by: 2026-10-30
verify_how: 用户要求不设 staging、直接进生产。兼容迁移已应用并核验到 CrazyContent，PostgREST 新列只读查询返回 HTTP 200；完成三方 agent 对最终冻结 head 的签字复审后，才合并触发生产自动部署。部署后验证旧的未核许可素材不会进入选片池、B 轨生成视频只继承已核许可的源图，并由两位不同 Supabase 用户完成新素材的许可人工声明及激活。任一项失败则停止上线。
done_on: 2026-10-23
done_ref: commit:80680cc79
---
素材库代码已在主干，完成记录是这张卡的 done_ref。
原先正文超行数，还带一长串编号，机器读不了。这次只改格式，产品行为没改。
长说明仍在那个提交的历史正文里。
对外选片仍只使用已核过许可的素材。
上线后怎么核对，看这张卡的 verify_how。
