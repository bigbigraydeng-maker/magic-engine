// P21.J M2 — worker 收权三件套单测(路径注入面 = 安全核心,狄仁杰实施后再补攻击验证)

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  isWorkerAuthorized,
  scanRedlineHits,
  trackFolder,
  validateClipPath,
  validateRenderPath,
  workerClientWhitelist,
  workerIdFromBody,
} from './worker-guard'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const WO = 'fc681e25-c5e5-49d4-89b7-1c5bfe9819af'

describe('isWorkerAuthorized', () => {
  const OLD = process.env.FACTORY_WORKER_TOKEN
  beforeEach(() => { process.env.FACTORY_WORKER_TOKEN = 'secret-token' })
  afterEach(() => { process.env.FACTORY_WORKER_TOKEN = OLD })

  it('正确 Bearer → 放行', () => {
    expect(isWorkerAuthorized('Bearer secret-token')).toBe(true)
  })
  it('错误 token / 缺 header → 拒', () => {
    expect(isWorkerAuthorized('Bearer wrong')).toBe(false)
    expect(isWorkerAuthorized(null)).toBe(false)
  })
  it('env 未配置 → fail-closed 一律拒', () => {
    delete process.env.FACTORY_WORKER_TOKEN
    expect(isWorkerAuthorized('Bearer secret-token')).toBe(false)
  })
})

describe('workerIdFromBody(魏征 M2-P1-1 归属校验入参)', () => {
  it('合法字符串 → trim 后返回', () => {
    expect(workerIdFromBody({ worker_id: ' local-mac ' })).toBe('local-mac')
  })
  it('缺失 / 空串 / 非字符串 → null(调用方 400)', () => {
    expect(workerIdFromBody({})).toBeNull()
    expect(workerIdFromBody({ worker_id: '  ' })).toBeNull()
    expect(workerIdFromBody({ worker_id: 42 })).toBeNull()
  })
})

describe('workerClientWhitelist', () => {
  const OLD = process.env.FACTORY_WORKER_CLIENT_IDS
  afterEach(() => { process.env.FACTORY_WORKER_CLIENT_IDS = OLD })

  it('逗号分隔 uuid → 列表', () => {
    process.env.FACTORY_WORKER_CLIENT_IDS = `${CLIENT}, ${WO}`
    expect(workerClientWhitelist()).toEqual([CLIENT, WO])
  })
  it('env 未配置 → null(调用方必须拒 claim)', () => {
    delete process.env.FACTORY_WORKER_CLIENT_IDS
    expect(workerClientWhitelist()).toBeNull()
  })
  it('全是非法值 → null,不放行空白名单', () => {
    process.env.FACTORY_WORKER_CLIENT_IDS = 'not-a-uuid, also-bad'
    expect(workerClientWhitelist()).toBeNull()
  })
})

describe('validateRenderPath(F9 前缀强校验)', () => {
  it('bucket 相对路径命中前缀 → 归一化路径', () => {
    expect(validateRenderPath(`renders/${CLIENT}/${WO}/final.mp4`, CLIENT, WO))
      .toBe(`renders/${CLIENT}/${WO}/final.mp4`)
  })
  it('带 bucket 名前缀 → 剥掉后校验', () => {
    expect(validateRenderPath(`content-factory/renders/${CLIENT}/${WO}/segments.json`, CLIENT, WO))
      .toBe(`renders/${CLIENT}/${WO}/segments.json`)
  })
  it('外部 URL 一律拒(注入面正门)', () => {
    expect(validateRenderPath(`https://evil.com/renders/${CLIENT}/${WO}/x.mp4`, CLIENT, WO)).toBeNull()
  })
  it('别的客户/别的工单路径 → 拒', () => {
    expect(validateRenderPath(`renders/${WO}/${WO}/final.mp4`, CLIENT, WO)).toBeNull()
    expect(validateRenderPath(`renders/${CLIENT}/${CLIENT}/final.mp4`, CLIENT, WO)).toBeNull()
  })
  it('路径穿越 / 只有前缀没有文件名 → 拒', () => {
    expect(validateRenderPath(`renders/${CLIENT}/${WO}/../escape.mp4`, CLIENT, WO)).toBeNull()
    expect(validateRenderPath(`renders/${CLIENT}/${WO}/`, CLIENT, WO)).toBeNull()
  })
})

describe('validateClipPath(track 一致性)', () => {
  it('a_real → clips/a-real/{client}/', () => {
    expect(validateClipPath(`clips/a-real/${CLIENT}/harbour.mp4`, CLIENT, 'a_real'))
      .toBe(`clips/a-real/${CLIENT}/harbour.mp4`)
  })
  it('track 与目录不一致 → 拒', () => {
    expect(validateClipPath(`clips/a-real/${CLIENT}/x.mp4`, CLIENT, 'b_generated')).toBeNull()
  })
  it('未知 track → 拒', () => {
    expect(validateClipPath(`clips/a-real/${CLIENT}/x.mp4`, CLIENT, 'c_stock')).toBeNull()
    expect(trackFolder('c_stock')).toBeNull()
  })
})

describe('scanRedlineHits(板桥 #7 成片级复扫)', () => {
  const REDLINES = ['Auckland since 1928', '1928 heritage']
  it('caption 命中红线(大小写不敏感)→ 返回原短语', () => {
    expect(scanRedlineHits(['Serving AUCKLAND  since 1928!'], REDLINES, []))
      .toEqual(['Auckland since 1928'])
  })
  it('text_overlay 命中 excluded_topics 也收', () => {
    expect(scanRedlineHits([null, 'best shutters in town'], REDLINES, ['shutters']))
      .toEqual(['shutters'])
  })
  it('干净文案 → 空数组(不误杀)', () => {
    expect(scanRedlineHits(['25 years in New Zealand'], REDLINES, [])).toEqual([])
  })
  it('多段文本合并扫描,命中去重', () => {
    expect(scanRedlineHits(['auckland since 1928', 'Auckland Since 1928 tours'], REDLINES, []))
      .toEqual(['Auckland since 1928'])
  })
})
