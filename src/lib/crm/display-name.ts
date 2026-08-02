/**
 * 卡片上那个人叫什么。
 *
 * 为什么需要它（2026-08-02 PM 截图反馈）：CTS 名单上有 13 个人显示「未留姓名」，
 * 全是从 Facebook 私信进来的 —— Meta 那边就没给名字，不是我们弄丢的。可是
 * 一排「未留姓名」在看板上等于一排看不出该不该打的人，销售只能一个个点开。
 *
 * 他们**说过话**。一句「有没有长城的团」比「未留姓名」有用一百倍。
 *
 * 三条硬规矩：
 *  1. **绝不假装那是他的名字**。前面挂一个明确的标记，销售一眼看出这是他说的
 *     话、不是他的姓名 —— 拿着一句话当名字去称呼客人，比不知道名字更糟。
 *  2. **只用客人自己说的第一句**。我们发的自动欢迎语人人一样，拿它当标题会让
 *     十几张卡长得一模一样。
 *  3. 一行放得下。看板一列只有 260px。
 */

/** 至少要有一个「能读出来」的字，才算说了点什么。 */
const MEANINGFUL = /[0-9A-Za-z\u00C0-\u024F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/

/** 卡片一行放得下的字数（中英混排按视觉宽度取的经验值）。 */
const MAX_CHARS = 18

/**
 * 说话内容里对识别毫无帮助的部分。链接和一长串符号占满整行却什么也没说明，
 * 去掉之后如果什么都不剩，就老老实实回到「未留姓名」。
 */
function cleanup(raw: string): string {
  const stripped = raw
    .replace(/https?:\/\/\S+/g, ' ')
    // 零宽字符、方向控制符、变体选择符 —— 看不见，却会占掉截断后的字数
    .replace(/[\u200B-\u200F\u202A-\u202E\uFE00-\uFE0F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  // 一个字母/数字/汉字/假名/谚文都没有 = 只发了表情或标点，对识别这个人毫无
  // 帮助。与其在卡上显示「问：👍👍👍」，不如老实说没留名字。
  // 写成显式区间而不是 \p{L}（那需要 u 标志，本仓库的编译目标还不支持）。
  return MEANINGFUL.test(stripped) ? stripped : ''
}

/**
 * 这个人在卡片上显示成什么。
 *
 * @param displayName 联系人表里的名字。Meta 没给名字时是空的。
 * @param firstInboundBody 客人自己发来的第一条消息（不是我们的自动回复）。
 */
export function contactCardTitle(
  displayName: string | null | undefined,
  firstInboundBody?: string | null,
): string {
  const name = (displayName ?? '').trim()
  if (name) return name

  const said = cleanup(firstInboundBody ?? '')
  if (!said) return '未留姓名'

  const short = said.length > MAX_CHARS ? `${said.slice(0, MAX_CHARS)}…` : said
  // 「问：」是那个不可省的标记 —— 它是「这不是名字」的全部依据。
  return `问：${short}`
}
