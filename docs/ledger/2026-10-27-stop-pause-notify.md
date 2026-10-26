---
id: 2026-10-27-stop-pause-notify
title: 广告系列暂停后写今日待办，并按环境变量发信
status: done
owner: agent
decided_on: 2026-10-27
source: doc:docs/specs/2026-10-26-prescription-to-act-full-auto-design-v0.1.md
verify_by: 2026-10-28
verify_how: 部署上线后，生产进程约半分钟内会自己向 /api/inngest 登记一次，不用人去后台点同步。总开关打开后，下一次新暂停应出现在今日待办，并把信发到环境变量里的收件人。变量没配时待办仍在，并写明未配置收件人。本卡交付时没有发真信、没有跑生产、没有触发真实登记。
done_on: 2026-10-27
done_ref: pr:3219
---

暂停成功后发一封说明系列、花费、原因和数据时间的信，并在今日待办留一条。收件人只从 ME_STOP_ALERT_EMAIL 读，不写死。Ray 定的值是 hello@magicengine.cloud。要恢复投放由人点确认卡。部署后由生产进程自己登记云端函数，不新增环境变量。
