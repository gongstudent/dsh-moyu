/**
 * 自动获取 ttwid。
 *
 * 抖音的 ttwid 是**服务端签发**的：解开看是 `1|<64位base62>|<时间戳>|<13位签名>`，
 * 最后一段是对前面内容的签名，所以本地伪造一定被拒（实测三种合成形态全部返回 blocked）。
 * 唯一可行的自动化方式是「真的开一次浏览器」。
 *
 * 这里用 Chrome / Edge 的 **CDP over pipe**：
 *   `--remote-debugging-pipe` 让浏览器从 fd 3 读命令、往 fd 4 写响应，
 *   消息是以 \0 分隔的裸 JSON。相比 WebSocket 方案，它不依赖 `globalThis.WebSocket`，
 *   任何 Node 版本都能跑，也不用先解析端口、做握手。
 *
 * 全程使用临时 user-data-dir，不碰用户现有的浏览器配置；结束后进程和目录都清掉。
 *
 * @module dsh-moyu/bootstrap
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 与 feed 请求完全一致的 UA：ttwid 会绑定签发时的 UA 环境，最好别用别的。 */
export const BOOTSTRAP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'

const LANDING = 'https://www.douyin.com/?recommend=1'
/** 总预算。实测 2~4 秒就能拿到，20 秒是给慢网络留的余量。 */
const DEADLINE_MS = 22_000
/** Storage.getCookies 的轮询间隔。 */
const POLL_MS = 700
/** 浏览器启动到能接受 CDP 命令的时间。 */
const SPAWN_GRACE_MS = 1200

/**
 * 候选浏览器路径，按「装了就能用」的顺序。
 * Windows 优先，同时给出 macOS / Linux 的常见位置，便于在其它平台上跑通。
 */
function browserCandidates() {
  const env = process.env
  const win = [
    join(env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]
  const mac = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ]
  const linux = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ]
  return [...win, ...mac, ...linux].filter((p) => typeof p === 'string' && p.length > 0 && !p.startsWith(join('', '')))
}

/** 找到第一个真实存在的浏览器可执行文件。 */
export function findBrowser() {
  for (const candidate of browserCandidates()) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      // 权限之类的读失败：跳过这个候选。
    }
  }
  return null
}

/** 单次会话内只允许一个引导在跑，避免两个 Chrome 抢同一个临时目录。 */
let running = false

/**
 * 开一次无头浏览器，把 douyin.com 的 ttwid 取回来。
 *
 * @returns {Promise<{ ok: true, ttwid: string } | { ok: false, error: string }>}
 */
export async function bootstrapTtwid() {
  if (running === true) return { ok: false, error: '已经有一次自动获取在进行了，稍等一下' }
  const browser = findBrowser()
  if (browser === null) {
    return { ok: false, error: '没找到 Chrome 或 Edge。请先安装其任一个，或手动粘贴 ttwid' }
  }

  running = true
  let profileDir = null
  let child = null
  try {
    profileDir = mkdtempSync(join(tmpdir(), 'dsh-moyu-boot-'))
    const args = [
      '--headless=new',
      '--remote-debugging-pipe',
      '--user-data-dir=' + profileDir,
      '--user-agent=' + BOOTSTRAP_UA,
      '--lang=zh-CN',
      '--window-size=1440,900',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      // 去掉 navigator.webdriver 之类最明显的自动化特征，降低被判定为爬虫的概率。
      '--disable-blink-features=AutomationControlled',
      'about:blank',
    ]
    child = spawn(browser, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true })
    const cdp = connect(child)
    const ttwid = await harvest(cdp)
    return { ok: true, ttwid }
  } catch (error) {
    return { ok: false, error: describeBootstrapError(error) }
  } finally {
    running = false
    if (child !== null) {
      try {
        child.kill()
      } catch {
        // 已经退出了。
      }
    }
    // Chrome 退出后才放开 profile 目录里的句柄，等一下再删。
    if (profileDir !== null) {
      await new Promise((resolve) => setTimeout(resolve, 400))
      try {
        rmSync(profileDir, { recursive: true, force: true })
      } catch {
        // 删不掉就留给系统临时目录清理，不影响功能。
      }
    }
  }
}

/**
 * 建立 pipe 上的 CDP 连接：fd 3 写命令，fd 4 读响应，消息以 \0 分隔。
 */
function connect(child) {
  const input = child.stdio[3]
  const output = child.stdio[4]
  if (input === null || input === undefined || output === null || output === undefined) {
    throw new Error('浏览器没有给出 CDP 管道')
  }

  let buffer = ''
  let nextId = 1
  const pending = new Map()
  let failure = null

  const settleAll = (error) => {
    failure = error
    for (const [, entry] of pending) entry.reject(error)
    pending.clear()
  }

  output.setEncoding('utf8')
  output.on('data', (chunk) => {
    buffer += chunk
    let cut = buffer.indexOf('\u0000')
    while (cut !== -1) {
      const raw = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 1)
      cut = buffer.indexOf('\u0000')
      if (raw.length === 0) continue
      let message
      try {
        message = JSON.parse(raw)
      } catch {
        continue
      }
      if (message === null || typeof message !== 'object' || message.id === undefined) continue
      const entry = pending.get(message.id)
      if (entry === undefined) continue
      pending.delete(message.id)
      if (message.error !== undefined && message.error !== null) {
        entry.reject(new Error(String(message.error.message || 'CDP error')))
      } else {
        entry.resolve(message.result)
      }
    }
  })
  child.on('exit', () => settleAll(new Error('浏览器提前退出了')))
  child.on('error', (error) => settleAll(error))

  const send = (method, params = {}) => {
    if (failure !== null) return Promise.reject(failure)
    const id = nextId++
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      try {
        input.write(JSON.stringify({ id, method, params }) + '\u0000')
      } catch (error) {
        pending.delete(id)
        reject(error)
      }
    })
  }

  return { send, dispose: () => settleAll(new Error('引导已结束')) }
}

/** 打开落地页，轮询浏览器级 cookie，直到 ttwid 出现。 */
async function harvest(cdp) {
  await sleep(SPAWN_GRACE_MS)
  await cdp.send('Target.createTarget', { url: LANDING })
  const deadline = Date.now() + DEADLINE_MS
  let lastNames = []
  while (Date.now() < deadline) {
    await sleep(POLL_MS)
    let result
    try {
      result = await cdp.send('Storage.getCookies')
    } catch {
      continue
    }
    const cookies = Array.isArray(result?.cookies) ? result.cookies : []
    const scoped = cookies.filter((c) => typeof c.domain === 'string' && c.domain.includes('douyin.com'))
    const ttwid = scoped.find((c) => c.name === 'ttwid' && typeof c.value === 'string' && c.value.length > 0)
    if (ttwid !== undefined) return ttwid.value
    lastNames = scoped.map((c) => c.name)
  }
  const seen = lastNames.length > 0 ? '（已拿到：' + lastNames.join('、') + '）' : ''
  throw new Error('浏览器在 22 秒内没有拿到 ttwid' + seen)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function describeBootstrapError(error) {
  const message = error !== null && error !== undefined && typeof error.message === 'string' ? error.message : String(error)
  if (message.includes('ENOENT')) return '没法启动浏览器，路径可能失效了。请手动粘贴 ttwid'
  if (message.includes('提前退出')) return '浏览器启动后立刻退出了。请手动粘贴 ttwid'
  return '自动获取失败：' + message
}
