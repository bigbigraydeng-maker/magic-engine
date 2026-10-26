import type { ScanReport } from './types'

/** Explicit fixture, never returned by the live scanning endpoint. */
export const exampleReport: ScanReport = {
  version: 1, mode: 'example', scannedAt: '', site: '演示出口企业', sourceUrl: '',
  headline: '联系入口找到了，\n再确认客户能走到最后一步。',
  summary: '这是一份虚构网站的示例报告，用来展示你将看到什么。',
  path: [{ label: '广告去向待确认', confirmed: false }, { label: '你提供的网站', confirmed: true }, { label: 'WhatsApp / 联系表单', confirmed: true }, { label: '实际送达待确认', confirmed: false }],
  checks: [
    { id: 'contact', title: '客户能从哪里联系你', state: 'detected', detail: '示例网站提供 WhatsApp 和联系表单；入口是否真正送达，需要人工确认。', evidence: ['演示数据：发现聊天链接和联系表单。'], sources: [] },
    { id: 'form', title: '表单是否帮助筛选询盘', state: 'detected', detail: '示例表单只收联系方式，未提供产品或采购数量字段。', evidence: ['演示数据：存在联系方式字段，未识别到资格字段。'], sources: [] },
    { id: 'pixel', title: 'Facebook 广告追踪（Meta Pixel）', state: 'detected', detail: '示例网页中发现相关代码，不代表有效询盘已正确回传。', evidence: ['演示数据：存在追踪初始化代码。'], sources: [] },
    { id: 'ad', title: '广告实际把客户带到哪里', state: 'unknown', detail: '只靠网站不能确认广告的真实点击去向。', evidence: ['示例没有广告账户或平台表单数据。'], sources: [] },
    { id: 'capi', title: '询盘是否正确回传给广告平台', state: 'needs_connection', detail: '公开网页无法证明 CAPI 是否接通。', evidence: ['本版不连接账户或发送事件。'], sources: [] },
  ],
  suggestions: [{ title: '让表单多帮你了解一步需求', reason: '示例表单只收联系方式。销售拿到询盘后，还需要从头询问客户需求。', action: '增加一个简单的问题，例如“你对哪类产品感兴趣？”，让跟进更有针对性。', checkIds: ['form'] }],
  coverage: { pages: 1, scripts: 0, incomplete: false },
}
