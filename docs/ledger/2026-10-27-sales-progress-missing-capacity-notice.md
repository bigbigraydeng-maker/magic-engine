---
id: 2026-10-27-sales-progress-missing-capacity-notice
title: 销售进度页提示座位数没填并直达团目录
status: done
owner: agent
decided_on: 2026-10-27
source: pr:3291
done_on: 2026-10-27
done_ref: pr:3298
verify_how: 上线后打开 CTS 销售进度页，页面上方应出现「还没填座位数」提示条和去团目录链接；CTS 补完座位数导入后提示条自动消失
---
只读展示，不写数据；座位数本身需要 CTS 提供，系统不能编。
团目录里直接填座位数的输入框是另一个更大的改动（要改写数据的接口，A 级），未做。
