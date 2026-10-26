---
id: 2026-10-27-instrumentation-edge-build-fix
title: 主干打不出包的问题修了：开机登记云端函数那一段只在 Node 环境里加载，网站又能发布了
status: done
owner: agent
decided_on: 2026-10-27
source: session:d380bf84
verify_by: 2026-10-28
verify_how: 到 Render 的部署页看主干最近一次部署是 Live（不是 Build failed）；再读回线上「社媒日常」总览页，Reel 封面（第 3252 号合并的）出现、接口里每条 Reel 带 video_url，就说明 09:21 之后合并的东西都上线了。Render 日志里应能看到 inngest boot sync 那一行（本卡只管打得出包，登记成不成功另算）。
done_on: 2026-10-27
done_ref: commit:4b50a6c4fdb7
---
第 3225 号开启开机钩子后，Next 为 Edge 再打一遍 src/instrumentation.ts，原写法拦不住 import，主干 npm run build 失败（5 条 Module not found，全来自这个入口）。改成「是 nodejs 才进去」，本机打包通过，并加了守卫测试。
没做的：把完整打包放回自动检查（为省额度现在只在手动触发时才跑，这类问题只能到部署时才发现），那一块不归本卡。
