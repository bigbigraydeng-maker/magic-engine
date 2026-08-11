import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../../..')

/**
 * docs/ENV.md 的「Render-web」图例必须指向真正的生产 web 服务。
 *
 * 这条曾经写着 `magic-engine` —— 那个服务 2026-07-25 就删了。照它去配变量，
 * 会配到一个不存在的地方（或者更糟：以后有人重建一个同名的空壳），而变量名和
 * 服务名看着都对，不会有任何报错。真正对外的是 `crazycontent`。
 *
 * 期望值不写死在这里：服务名和 service id 都从 render.yaml 顶部那段说明里解出来，
 * 再去 ENV.md 的图例格里核。render.yaml 改了口径，这里跟着变；ENV.md 单方面
 * 改回旧服务，这里就红。
 */
function renderYaml(): string {
  return readFileSync(path.join(ROOT, 'render.yaml'), 'utf8')
}

/** ENV.md「配在哪」图例表里某一档的「含义」那一格。 */
function legendCell(label: string): string | null {
  const lines = readFileSync(path.join(ROOT, 'docs/ENV.md'), 'utf8').split('\n')
  for (const line of lines) {
    if (!line.trimStart().startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length >= 2 && cells[0] === `**${label}**`) return cells[1]
  }
  return null
}

describe('docs/ENV.md 的 Render-web 图例指向真实的生产 web 服务', () => {
  const yaml = renderYaml()
  const live = /生产 Web 服务是 Render 上的\s*`([^`]+)`\((srv-[a-z0-9]+)\)/.exec(yaml)
  const removed = /原本还定义了一个同仓同分支的 web 服务\s*`([^`]+)`/.exec(yaml)
  const cell = legendCell('Render-web')

  it('前提成立：render.yaml 和 ENV.md 都解析到了东西（解析器走空不许静默变绿）', () => {
    expect(live, 'render.yaml 顶部那段「生产 Web 服务是 …」的说明没解析到').not.toBeNull()
    expect(removed, 'render.yaml 顶部那段「原本还定义了 … web 服务」的说明没解析到').not.toBeNull()
    expect(cell, 'ENV.md 的「配在哪」图例里找不到 Render-web 这一档').not.toBeNull()
    expect(legendCell('这一档不存在')).toBeNull()
  })

  it('render.yaml 本身不定义 web 服务 —— 所以图例必须写清是外面哪个服务', () => {
    expect(/^\s*-\s+type:\s+web\b/m.test(yaml)).toBe(false)
  })

  it('🔴 图例写的是 render.yaml 认定的那个生产服务，名字和 service id 都对得上', () => {
    expect(cell).toContain(live![1])
    expect(cell).toContain(live![2])
  })

  it('🔴 图例不再把已删除的旧服务当成 web service —— 写回去就红', () => {
    expect(new RegExp(`\`${removed![1]}\` web service`).test(cell!)).toBe(false)
  })
})
