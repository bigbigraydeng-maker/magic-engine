/**
 * `ads.auto_pause_on_d3` 这个动作键 —— 单独一个零依赖文件。
 *
 * 只要这个字符串的读方（待办、列表读法）不该为了它把 Kernel 执行器一起拉进依赖链；
 * `ads-auto-pause.ts` 原样再导出，老的 import 不受影响。
 */
export const ADS_AUTO_PAUSE_ACTION_KEY = 'ads.auto_pause_on_d3' as const
