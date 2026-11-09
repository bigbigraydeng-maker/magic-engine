import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe,expect,it } from 'vitest'

function websiteFile(path:string) {
  return readFileSync(join(process.cwd(),'website/cn/meta-ads-ai',path),'utf8')
}

// 2026-09-27 起这两页是「工具实验室」的 Facebook 广告体检（自助注册 → 连接 Facebook → 看报告，免费期 90 天），
// 不再是 9-21 的「获邀客户 + 由 Magic Engine 承担费用的托管分析」试点文案。测试跟着现行页面走，守的是同一件事：
// 流程步骤前后一致、不出现技术黑话、隐私说明把「收什么 / 不收什么 / 怎么删」写清楚。
describe('Meta Ads AI public Chinese copy',()=>{
  it('keeps the customer journey to the same three steps as the product page',()=>{
    const landing=websiteFile('index.html')
    expect(landing).toContain('注册 → 连接 Facebook → 看报告')
    expect(landing).toContain('生成近 7 天的中文体检报告')
    expect(landing).toContain('免费期 90 天，到期不会自动扣费')
    expect(landing).toContain('不创建、修改、暂停、发布或删除广告')
    expect(landing).not.toMatch(/MCP|Bearer|HTTPS|Codex|AI 客户端/)
  })

  it('discloses what is collected, what is not, and how to delete before customers connect',()=>{
    const privacy=websiteFile('privacy/index.html')
    expect(privacy).toContain('我们不收集什么')
    expect(privacy).toContain('Facebook 密码')
    expect(privacy).toContain('潜在客户的联系方式或私信内容')
    expect(privacy).toContain('不出售你的数据')
    expect(privacy).toContain('保存多久、怎么删')
    expect(privacy).toContain('断开连接后我们停止读取')
    expect(privacy).not.toContain('只适用于 Magic Engine“Meta 广告 AI 分析”邀请测试的公开报名表')
  })

  // 9-21 的旧隐私文案写明「最小广告汇总数据发送给托管 AI 模型」，9-27 改版时这句没有了；
  // 现行隐私页只说「生成体检报告」。要不要补回由 PM / 内容负责人判断，这里先留一条待办提醒，不在测试里替他们决定。
  it.todo('隐私页是否应写明「广告汇总数据会发给 AI 模型处理」（9-27 改版时被删，待 PM 判断）')
})
