/**
 * 「约回电」三个一键快捷项的名字和按钮文案。
 *
 * 单独成一个没有任何 import 的小文件：记一笔的输入框（浏览器端组件）要用它，
 * 而换算时间的 callback-pick 会连带引入服务端才用得上的东西，不能被浏览器端 import。
 */

/** 三个一键快捷项（第四个「自选时间」走 callbackAt）。 */
export const CALLBACK_PRESETS = ['tomorrow_am', 'tomorrow_pm', 'next_monday_am'] as const
export type CallbackPreset = (typeof CALLBACK_PRESETS)[number]

/** 按钮上的字。页面和测试共用这一份，不各写一遍。 */
export const CALLBACK_PRESET_LABELS: Record<CallbackPreset, string> = {
  tomorrow_am: '明天上午 10 点',
  tomorrow_pm: '明天下午 2 点',
  next_monday_am: '下周一上午 10 点',
}
