---
id: 2026-10-20-instagram-pr2-worker-anchor
title: 发布 worker 的「幂等锚」写库失败时中止发布;adapter 契约放宽到 instagram 并预留 reconcile 钩子(Instagram PR2)
status: done
owner: agent
decided_on: 2026-10-20
source: doc:docs/specs/2026-10-20-instagram-native-publish.md
verify_by: 2026-10-27
verify_how: 合并部署后看 factory-publish-worker 当天回执:Facebook 发布照常;日志里没有「幂等锚写入失败」(出现 = 库写入异常,该单已置失败、不会盲发)。
done_on: 2026-10-20
done_ref: pr:2966
---
行为变化只有一处:以前锚点写库出错被忽略(崩溃后可能盲发),现在出错即中止并置失败,重试时靠 findExisting 对账。`reconcile?` 仅为类型,worker 暂不调用。Instagram 主线 PR3–PR7 仍待做。
