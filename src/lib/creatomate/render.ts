// 提交渲染 / 查询状态。Spec §4.4：submitRender 是付费步骤，调用方必须包在不可重试
// 的 Inngest step 里（retries:0）——这个函数本身不做幂等判断，幂等判断是调用方
// （job 行有没有 creatomate_render_id）的责任，不是这个连接器的责任。
import { creatomateFetch } from './client'
import type { CreateRenderParams, CreatomateRender, CreatomateRenderStatus } from './types'

// 🔴 坑#2（spec §5，音频缺 duration 撑爆全片）v1 曾想在这里挡：校验 factory_config
//    声明的 audioKeys 若出现在 modifications 里必须同时给 `${key}.duration`。第二轮复审
//    （子牙+魏征交叉指出）核实：本 MVP 的 buildModifications()（modifications.ts）只写
//    sceneFieldMap 声明的 visual/caption/voice 三种 key，从来不会产出跟 audioKeys 同名的
//    modification——这道闸要么永远不触发（形同虚设），要么配错了名字永远提交失败（把客户
//    锁死），两种结果都不对。本 MVP 不支持"可替换背景音乐"这类独立音频元素（模板设计阶段
//    背景音乐固定死，不通过 modifications 动态换），坑#2 因此不适用——真加这类支持时，要在
//    有真实数据源（modifications 里会不会真的出现独立音频 key）之后再补校验，不能先写断言
//    再假装已经防住。

export async function submitRender(params: CreateRenderParams): Promise<{ renderId: string }> {
  const body = await creatomateFetch('/renders', {
    method: 'POST',
    body: {
      template_id: params.templateId,
      modifications: params.modifications,
      ...(params.webhookUrl ? { webhook_url: params.webhookUrl } : {}),
    },
  })

  const render = parseRender(body)
  return { renderId: render.id }
}

export async function getRender(renderId: string): Promise<CreatomateRender> {
  const body = await creatomateFetch(`/renders/${encodeURIComponent(renderId)}`, { method: 'GET' })
  return parseRender(body)
}

const VALID_STATUSES: readonly CreatomateRenderStatus[] = [
  'planned', 'waiting', 'transcribing', 'rendering', 'succeeded', 'failed', 'cancelled',
]

function parseRender(body: unknown): CreatomateRender {
  // POST 提交时官方响应是单个对象；不排除未来返回数组包裹，两种都兜住。
  const raw = Array.isArray(body) ? body[0] : body
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Creatomate 响应不是预期的 render 对象形状')
  }
  const r = raw as Record<string, unknown>
  const id = r.id
  const status = r.status
  if (typeof id !== 'string' || typeof status !== 'string' || !VALID_STATUSES.includes(status as CreatomateRenderStatus)) {
    throw new Error(`Creatomate 响应缺少合法的 id/status 字段：${JSON.stringify(r).slice(0, 200)}`)
  }
  return {
    id,
    status: status as CreatomateRenderStatus,
    url: typeof r.url === 'string' ? r.url : undefined,
    errorMessage: typeof r.error_message === 'string' ? r.error_message : undefined,
  }
}
