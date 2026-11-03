-- 给 client_portal_users 加「接收 round-robin 分配」标记。
--
-- 为什么挂在 client_portal_users：
--   客户员工账号已经在这里了，加一个布尔标记比新建 client_lead_assignees
--   表轻得多；分配时 round-robin 库查「这个客户下所有 receives=true 的行」
--   拿邮箱列表即可。将来升级成「权重」或「值班表」时再抽新表。
--
-- 为什么默认 false：
--   现有行全是「有登录权限但不接新线索」的人（PM、FDE、客户管理员等）；
--   显式打 true 的人才是销售。安全默认——避免误把新线索分给不干这事的人。
--
-- 为什么只 seed Lisa：
--   PM 10-26 答复：销售 = Baker + Lisa，Lisa = info@ctstours.co.nz，Baker
--   邮箱待给。round-robin 列表第一步 N=1，等于「全给 Lisa」；Baker 邮箱到了
--   后台追加（UPDATE 一行），不用新 migration。
--
-- CTS client_id：c0000000-0000-0000-0000-000000000000（见 CLAUDE.md §9）。

ALTER TABLE client_portal_users
  ADD COLUMN IF NOT EXISTS receives_round_robin_leads boolean NOT NULL DEFAULT false;

-- 查「这个客户下有谁接新线索」的主查询；只对 true 的行建部分索引省空间。
CREATE INDEX IF NOT EXISTS client_portal_users_round_robin_idx
  ON client_portal_users (client_id)
  WHERE receives_round_robin_leads = true;

-- Seed Lisa（CTS）。幂等：WHERE 子句决定只命中她一行，重放不会误伤。
UPDATE client_portal_users
   SET receives_round_robin_leads = true
 WHERE client_id = 'c0000000-0000-0000-0000-000000000000'
   AND email = 'info@ctstours.co.nz';
