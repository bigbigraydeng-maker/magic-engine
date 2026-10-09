/**
 * 邮件支柱的 Inngest 事件名（频率闸门）。
 *
 * 仓库惯例是点分 `<域>.<对象>.<动词>`。这两个事件是**只读检查**的两端：
 *
 *   - `EMAIL_FREQUENCY_CAP_CHECK_REQUESTED`：请求「在发信之前，按收件人逐个
 *     数一遍他在滚动窗口里已经收过几封信」。这是发信前的闸门，不是发信本身。
 *   - `EMAIL_FREQUENCY_CAP_CHECKED`：检查完成后的**机器可读收据**。收据里带
 *     窗口、策略、允许名单、被排除的人及原因、以及覆盖面声明。
 *
 * 一条不许破的线：**检查永远不发信，也永远不写 Mailchimp。** 收据不是发信
 * 授权 —— 它只是「这个人现在能不能收」的事实陈述。真正决定发不发、以及要不要
 * 把被排除的人打标签 / 分群，是调用方的事，而且对 Mailchimp 名单的写操作必须
 * 先经 PM 批准（见 `functions/email-frequency-cap-check.ts` 头注释）。
 */

/** 发信前请求频率闸门：按收件人数滚动窗口内已收封数。只读，不发信。 */
export const EMAIL_FREQUENCY_CAP_CHECK_REQUESTED = 'email.frequency_cap.check_requested'

/** 频率闸门检查完成，携带机器可读收据。收据不是发信授权。 */
export const EMAIL_FREQUENCY_CAP_CHECKED = 'email.frequency_cap.checked'
