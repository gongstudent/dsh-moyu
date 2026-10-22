#!/usr/bin/env node
/**
 * 重新生成 market/index.json 里的版本条目。
 *
 * 插件市场的 git 来源必须钉在一个**精确的 40 位 commit**上，所以每次发布都要把索引指向
 * 新的提交。手改容易漏（commit 长度、publishTimestamp 单位错都会让校验器直接拒），
 * 这个脚本从 git 和 package.json 取值，其余字段原样保留。
 *
 *   node scripts/update-market-index.mjs
 *
 * 校验器在 DSH 里是 @deepseek-ai/dsh-plugin-market-index，这里不复制它的规则。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const indexPath = join(root, 'market', 'index.json')
const pkgPath = join(root, 'package.json')

const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()

const commit = git(['rev-parse', 'HEAD'])
if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error('HEAD 不是 40 位小写 commit：' + commit)

// 市场要求的是**秒级** Unix 时间戳（上限 1e11，毫秒会直接超限）。
const publishTimestamp = Number(git(['show', '-s', '--format=%ct', 'HEAD']))
if (!Number.isInteger(publishTimestamp) || publishTimestamp <= 0 || publishTimestamp >= 1e11) {
  throw new Error('提交时间戳不合法：' + String(publishTimestamp))
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const index = JSON.parse(readFileSync(indexPath, 'utf8'))

const plugin = index.plugins.find((entry) => entry.name === pkg.name)
if (plugin === undefined) throw new Error('索引里没有 ' + pkg.name + ' 这个条目')

const previous = plugin.versions.find((entry) => entry.version === pkg.version)
plugin.versions = [
  {
    version: pkg.version,
    publishTimestamp,
    source: { type: 'git', url: 'https://github.com/gongstudent/dsh-moyu', commit },
    engines: previous?.engines ?? { dsh: '>=0.2.0-rc.2' },
  },
]

writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n')
console.log('market/index.json -> ' + pkg.name + '@' + pkg.version + ' @ ' + commit.slice(0, 7))
