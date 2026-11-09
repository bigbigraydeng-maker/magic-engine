// 把 §4.3a 的镜头结果按客户模板契约（factory_config.render.creatomate，spec §4.7）
// 组装成 Creatomate 提交要的 modifications。这个函数不认识任何具体客户的模板结构，
// 只按 contract.sceneFieldMap 声明取值——换客户只是换一份 contract（红线4）。
import type { PreparedScene } from './scene-assets'
import type { CreatomateTemplateContract } from './types'

export function buildModifications(
  scenes: PreparedScene[],
  contract: CreatomateTemplateContract,
): Record<string, string> {
  const { sceneFieldMap } = contract
  if (scenes.length > sceneFieldMap.length) {
    throw new Error(
      `分镜出了 ${scenes.length} 段，模板只有 ${sceneFieldMap.length} 个镜头槽位——模板容不下这条内容，需要 PM 重新设计模板或减少分镜数`,
    )
  }

  // 固定图层覆盖先铺底，镜头槽位再盖上去——sceneFieldMap 理论上不会跟 staticOverrides
  // 撞同一个元素名（前者是逐镜头 Still-N，后者是品牌固定层），万一真撞了，镜头内容
  // 优先，不能让一张品牌图静默吃掉这一镜的画面。
  const modifications: Record<string, string> = { ...contract.staticOverrides }
  scenes.forEach((scene, i) => {
    const slot = sceneFieldMap[i]
    modifications[slot.visual] = scene.visualUrl
    if (slot.caption) modifications[slot.caption] = scene.captionText
    if (slot.voice) modifications[slot.voice] = scene.voUrl
  })
  return modifications
}
