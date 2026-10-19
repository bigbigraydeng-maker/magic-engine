---
id: 2026-10-19-chinatravel-delist-gate-ci-postbuild-scan
title: 官网下架机器闸补两道自动防线：CI 构建产物扫描、仓库规矩写进 CLAUDE.md（A 级）
status: decided
owner: agent
decided_on: 2026-10-19
source: session:ec90bb17
verify_by: 2026-10-30
verify_how: 官网 CI 的 build 任务后有扫描步骤且不再恒跳过；故意在页面留一处旧团名，CI 变红；官网仓库 CLAUDE.md 写明「下架一个团的规矩」（登记表、删数据、footprint、残留测试、部署后体检）
---
目前三道防线里只有源码扫描自动跑；构建产物扫描在 CI 里恒跳过，部署后体检靠人手跑。
动 .github 与仓库规矩文件属 A 级，需单独走审查与 PM 同意；GitHub 账单恢复后才能验证。
