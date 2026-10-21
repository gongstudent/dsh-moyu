/**
 * dsh-moyu —— 宿主半边（Host half）
 *
 * 只做四件事，全部通过 Connection 的 exact fetch route 暴露给浏览器：
 *   1. GET  /api/douyin/state   —— 报告是否已配置 Cookie
 *   2. POST /api/douyin/cookie  —— 保存 / 清除 Cookie（~/.dsh/storages/dsh-moyu.json）
 *   3. GET  /api/douyin/feed    —— 签名并抓取抖音推荐流，归一化成播放器要的形状
 *   4. GET  /api/douyin/media   —— 媒体反代（补 Cookie/Referer/UA，透传 Range）
 *
 * 为什么不把签名放进浏览器：douyin.com 不返回 CORS 头，且 Cookie / Referer 属于
 * forbidden header。浏览器里既带不上登录态，也过不了预检，所以签名（X-Bogus）与
 * 带凭据取流必须留在宿主进程。
 *
 * 契约见 ../CONTRACT.md。路由 path 一律以 /api/ 开头（Connection 只接管该前缀）。
 */

import { createRequire } from 'node:module'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { bootstrapTtwid } from './bootstrap.js'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
// vendor/index.js 是 CommonJS：sign(带 query 的完整 URL, UA) 返回 28 字符 X-Bogus。
// 签名与实际请求必须共用同一个 UA，否则签名作废。
const signX = require('../vendor/index.js')

export const name = 'moyu'
export const inject = ['connection']

/** 契约版本：客户端据此判断宿主能力。 */
const CONTRACT_VERSION = 1

/** 固定 Chrome UA；签名、feed 请求、媒体反代三处共用。 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'

/** Cookie 落盘位置（契约指定）。 */
const STORAGE_FILE = join(homedir(), '.dsh', 'storages', 'dsh-moyu.json')

const ROUTE = {
  state: '/api/douyin/state',
  cookie: '/api/douyin/cookie',
  feed: '/api/douyin/feed',
  media: '/api/douyin/media',
  bootstrap: '/api/douyin/bootstrap',
}

const FEED_ENDPOINT = 'https://www.douyin.com/aweme/v1/web/tab/feed/'
const FEED_REFERER = 'https://www.douyin.com/?recommend=1'
const MEDIA_REFERER = 'https://www.douyin.com/'

/** 媒体反代白名单：host 必须等于该域或其子域（不是 includes，防 evildouyin.com）。 */
const MEDIA_ALLOWED_DOMAINS = [
  'douyin.com',
  'douyinpic.com',
  'douyinvod.com',
  'bytecdn.com',
  'byteimg.com',
  'pstatp.com',
  'snssdk.com',
  'bytedance.com',
  'amemv.com',
  'zjcdn.com',
]

const FEED_TIMEOUT_MS = 12_000
const MEDIA_TIMEOUT_MS = 30_000
const MAX_FEED_COUNT = 30

/* ------------------------------------------------------------------ 响应工具 */

/** 所有 JSON 路由统一带 no-store（契约要求）。 */
function json(value, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

/**
 * 业务失败：HTTP 200 + ok:false（契约规定的形状）。
 * needCookie 供客户端直接跳到设置视图。
 */
function failure(error, needCookie = false) {
  return json({ ok: false, error, needCookie }, 200)
}

/** 把异常压成一句可展示的中文；不把堆栈或超长对象塞进响应。 */
function describe(error) {
  if (error === null || error === undefined) return '未知错误'
  if (error.name === 'TimeoutError') return '请求抖音超时，请稍后重试'
  const cause = error.cause && typeof error.cause.message === 'string' ? error.cause.message : ''
  const message = cause || (typeof error.message === 'string' ? error.message : String(error))
  return message.length > 200 ? message.slice(0, 200) + '…' : message
}

/**
 * 上游请求的中止信号 = 客户端断开 + 超时。
 * 客户端断开必须传给上游，否则滚走视频后仍会继续拉流。
 */
function upstreamSignal(request, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs)
  try {
    const client = request && request.signal ? request.signal : undefined
    return client ? AbortSignal.any([client, timeout]) : timeout
  } catch {
    return timeout
  }
}

/**
 * 把上游 body 包一层：无论上游因为客户端中止还是网络抖动报错，
 * 都只以「正常结束」收尾，绝不把异常抛给宿主的 bridge 写入循环。
 */
function safeBody(body) {
  if (!body) return null
  return new ReadableStream({
    async start(controller) {
      let closed = false
      const finish = () => {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          // 客户端已断开时 close 可能抛，忽略即可。
        }
      }
      try {
        for await (const chunk of body) {
          if (closed) return
          controller.enqueue(chunk)
        }
        finish()
      } catch {
        finish()
      }
    },
    cancel(reason) {
      try {
        void body.cancel(reason)
      } catch {
        // 上游已结束时 cancel 会抛，忽略。
      }
    },
  })
}

/* ------------------------------------------------------------------ Cookie 存储 */

/**
 * 读取 Cookie。文件缺失 / 目录缺失 / JSON 损坏 / 字段类型不对，
 * 一律当作「无 Cookie」，绝不向调用方抛异常（契约要求）。
 */
async function readCookie() {
  try {
    const raw = await readFile(STORAGE_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    const value = parsed && typeof parsed.cookie === 'string' ? parsed.cookie.trim() : ''
    return value
  } catch {
    return ''
  }
}

/**
 * 写入 Cookie。先写临时文件再 rename，避免进程中断留下半截 JSON；
 * 失败时清理临时文件并把异常交给路由层（路由返回 500 JSON）。
 */
async function writeCookie(cookie) {
  await mkdir(dirname(STORAGE_FILE), { recursive: true })
  const temporary = STORAGE_FILE + '.' + process.pid + '.' + Date.now() + '.tmp'
  try {
    await writeFile(temporary, JSON.stringify({ cookie }, null, 2), 'utf8')
    await rename(temporary, STORAGE_FILE)
  } catch (error) {
    try {
      await rm(temporary, { force: true })
    } catch {
      // 临时文件清不掉不影响结果，系统临时目录会回收。
    }
    throw error
  }
}

/* ------------------------------------------------------------------ 推荐流 */

const clampInteger = (value, fallback, min, max) => {
  const parsed = Number.parseInt(String(value === null || value === undefined ? '' : value), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

/** 契约 69-81 行的参数表；逐字照抄 touchFish 已验证可用的配方。 */
function feedParameters(count, refreshIndex) {
  return new URLSearchParams({
    device_platform: 'webapp',
    aid: '6383',
    channel: 'channel_pc_web',
    filterGids: '',
    tag_id: '',
    share_aweme_id: '',
    live_insert_type: '',
    count: String(count),
    refresh_index: String(refreshIndex),
    video_type_select: '1',
    aweme_pc_rec_raw_data: JSON.stringify({
      is_client: false,
      ff_danmaku_status: 1,
      danmaku_switch_status: 1,
      is_dash_user: 1,
      is_auto_play: 0,
      is_full_screen: 0,
      is_full_webscreen: 0,
      is_mute: 0,
      is_speed: 1,
      is_visible: 1,
      related_recommend: 1,
      is_xigua_user: 0,
    }),
    globalwid: '',
    pull_type: '2',
    min_window: '0',
    free_right: '0',
    view_count: '0',
    plug_block: '0',
    ug_source: '',
    creative_id: '',
    pc_client_type: '1',
    pc_libra_divert: 'Windows',
    support_h265: '1',
    support_dash: '1',
    webcast_sdk_version: '170400',
    webcast_version_code: '170400',
    version_code: '170400',
    version_name: '17.4.0',
    cookie_enabled: 'true',
    screen_width: '1920',
    screen_height: '1080',
    browser_language: 'zh-CN',
    browser_platform: 'Win32',
    browser_name: 'Chrome',
    browser_version: '150.0.0.0',
    browser_online: 'true',
    engine_name: 'Blink',
    engine_version: '150.0.0.0',
    os_name: 'Windows',
    os_version: '10',
    platform: 'PC',
    timestamp: String(Math.floor(Date.now() / 1000)),
  })
}

/** 取 url_list 里第一个非空字符串；结构不对就返回 null。 */
function firstUrl(holder) {
  if (!holder || !Array.isArray(holder.url_list)) return null
  for (const item of holder.url_list) {
    if (typeof item === 'string' && item.length > 0) return item
  }
  return null
}

/**
 * 播放地址优先级（契约 83-84 行）：
 * 含 /aweme/v1/play/ 的官方播放口 > play_addr > play_addr_h264 > play_addr_265 > bit_rate[].play_addr。
 * 官方播放口会 302 到当前网络可用的 CDN，直连 CDN 常 403，所以优先它。
 */
function pickPlayUrl(video) {
  const groups = []
  if (Array.isArray(video.play_addr && video.play_addr.url_list)) groups.push(video.play_addr.url_list)
  if (Array.isArray(video.play_addr_h264 && video.play_addr_h264.url_list)) groups.push(video.play_addr_h264.url_list)
  if (Array.isArray(video.play_addr_265 && video.play_addr_265.url_list)) groups.push(video.play_addr_265.url_list)
  if (Array.isArray(video.bit_rate)) {
    for (const rate of video.bit_rate) {
      if (rate && Array.isArray(rate.play_addr && rate.play_addr.url_list)) groups.push(rate.play_addr.url_list)
    }
  }
  const candidates = []
  for (const list of groups) {
    for (const url of list) {
      if (typeof url === 'string' && url.length > 0) candidates.push(url)
    }
  }
  let official = ''
  for (const url of candidates) {
    if (url.includes('/aweme/v1/play/')) {
      official = url
      break
    }
  }
  if (official) return official
  const ordered = [firstUrl(video.play_addr), firstUrl(video.play_addr_h264), firstUrl(video.play_addr_265)]
  for (const url of ordered) {
    if (url) return url
  }
  return candidates.length > 0 ? candidates[0] : ''
}

const toNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** 单条 aweme -> 契约 33-43 行的 item；拿不到 video 或播放地址就返回 null（丢弃）。 */
function toFeedItem(aweme) {
  if (!aweme || typeof aweme !== 'object') return null
  const video = aweme.video
  if (!video || typeof video !== 'object') return null
  const playUrl = pickPlayUrl(video)
  if (!playUrl) return null
  const id = String(aweme.aweme_id === undefined || aweme.aweme_id === null ? '' : aweme.aweme_id)
  if (!id) return null
  const statistics = aweme.statistics && typeof aweme.statistics === 'object' ? aweme.statistics : {}
  const author = aweme.author && typeof aweme.author === 'object' ? aweme.author : {}
  return {
    id,
    desc: typeof aweme.desc === 'string' ? aweme.desc : '',
    author: {
      name: typeof author.nickname === 'string' ? author.nickname : '',
      avatar: firstUrl(author.avatar_thumb) || firstUrl(author.avatar_medium) || null,
    },
    cover: firstUrl(video.cover) || firstUrl(video.origin_cover) || null,
    duration: toNumber(video.duration),
    // 契约要求相对路径且无前导斜杠：浏览器按 document.baseURI 解析。
    playUrl: 'api/douyin/media?u=' + encodeURIComponent(playUrl),
    stats: {
      digg: toNumber(statistics.digg_count),
      comment: toNumber(statistics.comment_count),
      share: toNumber(statistics.share_count),
    },
  }
}

/**
 * 解析 feed 响应体。
 * 抖音在 Cookie 缺失/失效时回 HTTP 200 + 空串或纯文本 blocked，必须识别成
 * 「Cookie 失效」，不能当正常 JSON 解析（契约明确要求）。
 */
function parseFeedBody(text) {
  const body = typeof text === 'string' ? text.trim() : ''
  if (body.length === 0) {
    return { ok: false, needCookie: true, error: '凭据已失效（抖音返回空响应），请重新复制 douyin.com 的 ttwid' }
  }
  const head = body.slice(0, 32).toLowerCase()
  if (head.startsWith('blocked') || head.startsWith('verify') || head.startsWith('captcha')) {
    return { ok: false, needCookie: true, error: '凭据已失效（抖音返回拦截页），请重新复制 douyin.com 的 ttwid' }
  }
  let payload
  try {
    payload = JSON.parse(body)
  } catch {
    return { ok: false, needCookie: true, error: '凭据已失效（抖音返回了非 JSON 响应），请重新复制 douyin.com 的 ttwid' }
  }
  if (!payload || typeof payload !== 'object') {
    return { ok: false, needCookie: true, error: '凭据已失效（抖音返回了意外结构），请重新复制 douyin.com 的 ttwid' }
  }
  const statusCode = toNumber(payload.status_code)
  if (statusCode !== 0) {
    const rawMessage = typeof payload.status_msg === 'string' ? payload.status_msg : ''
    const message = rawMessage || '抖音返回错误码 ' + statusCode
    const lower = message.toLowerCase()
    const authFailure =
      statusCode === 8 ||
      lower.includes('cookie') ||
      lower.includes('login') ||
      message.includes('登录') ||
      message.includes('会话')
    return {
      ok: false,
      needCookie: authFailure,
      error: authFailure ? '凭据已失效：' + message : message,
    }
  }
  const list = Array.isArray(payload.aweme_list) ? payload.aweme_list : []
  const items = []
  for (const aweme of list) {
    const item = toFeedItem(aweme)
    if (item) items.push(item)
  }
  return { ok: true, items }
}

/** 签名 + 抓取 + 解析；抛异常由路由层兜底成 500。 */
async function requestFeed(cookie, count, refreshIndex, request) {
  const query = feedParameters(count, refreshIndex).toString()
  const unsigned = FEED_ENDPOINT + '?' + query
  let signature = ''
  try {
    signature = signX(unsigned, UA)
  } catch (error) {
    throw new Error('生成 X-Bogus 签名失败：' + describe(error))
  }
  if (typeof signature !== 'string' || signature.length === 0) {
    throw new Error('生成 X-Bogus 签名失败：签名为空')
  }
  const response = await fetch(unsigned + '&X-Bogus=' + signature, {
    method: 'GET',
    headers: {
      'User-Agent': UA,
      Referer: FEED_REFERER,
      Origin: 'https://www.douyin.com',
      Accept: 'application/json, text/plain, */*',
      Cookie: cookie,
    },
    redirect: 'follow',
    signal: upstreamSignal(request, FEED_TIMEOUT_MS),
  })
  if (!response.ok) {
    const needCookie = response.status === 401 || response.status === 403
    return {
      ok: false,
      needCookie,
      error: '抖音接口返回 HTTP ' + response.status + (needCookie ? '，Cookie 可能已失效' : ''),
    }
  }
  const text = await response.text()
  return parseFeedBody(text)
}

/* ------------------------------------------------------------------ 媒体反代 */

/** 白名单校验：命中返回 URL 对象，否则 null。只允许 http/https。 */
function allowedMediaUrl(raw) {
  let url
  try {
    url = new URL(String(raw))
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase()
  for (const domain of MEDIA_ALLOWED_DOMAINS) {
    if (host === domain || host.endsWith('.' + domain)) return url
  }
  return null
}

/* ------------------------------------------------------------------ 路由处理 */

async function handleState() {
  try {
    const cookie = await readCookie()
    return json({ ok: true, hasCookie: cookie.length > 0, version: CONTRACT_VERSION })
  } catch (error) {
    return json({ ok: false, error: '读取 Cookie 状态失败：' + describe(error) }, 500)
  }
}

async function handleCookie(request) {
  try {
    let payload
    try {
      payload = await request.json()
    } catch {
      return json({ ok: false, error: '请求体不是合法 JSON' }, 400)
    }
    if (!payload || typeof payload.cookie !== 'string') {
      return json({ ok: false, error: '缺少 cookie 字段（应为字符串）' }, 400)
    }
    const cookie = payload.cookie.trim()
    try {
      await writeCookie(cookie)
    } catch (error) {
      return json({ ok: false, error: '保存 Cookie 失败：' + describe(error) }, 500)
    }
    return json({ ok: true, hasCookie: cookie.length > 0 })
  } catch (error) {
    return json({ ok: false, error: '保存 Cookie 失败：' + describe(error) }, 500)
  }
}

/**
 * 自动获取 ttwid：宿主起一次无头浏览器，把签发的设备标识取回来并落盘。
 *
 * ttwid 是服务端签名的（`1|…|时间戳|签名`），本地伪造会被抖音判成爬虫，
 * 所以「生成一个 id」在这里只能是「真的开一次浏览器去拿」。
 */
async function handleBootstrap() {
  try {
    const result = await bootstrapTtwid()
    if (result.ok !== true) {
      return json({ ok: false, error: result.error, needCookie: false }, 200)
    }
    const cookie = 'ttwid=' + result.ttwid
    try {
      await writeCookie(cookie)
    } catch (error) {
      return json({ ok: false, error: '拿到的 ttwid 存盘失败：' + describe(error) }, 500)
    }
    return json({ ok: true, hasCookie: true })
  } catch (error) {
    return json({ ok: false, error: '自动获取失败：' + describe(error) }, 500)
  }
}

async function handleFeed(request) {
  try {
    const url = new URL(request.url)
    const count = clampInteger(url.searchParams.get('count'), 10, 1, MAX_FEED_COUNT)
    const refreshIndex = clampInteger(url.searchParams.get('refreshIndex'), 1, 1, 100000)
    const cookie = await readCookie()
    if (!cookie) {
      return failure('尚未配置抖音凭据，请先在设置里粘贴 douyin.com 的 ttwid', true)
    }
    const result = await requestFeed(cookie, count, refreshIndex, request)
    return json(result)
  } catch (error) {
    return json({ ok: false, error: '获取抖音推荐流失败：' + describe(error), needCookie: false }, 500)
  }
}

async function handleMedia(request) {
  try {
    const raw = new URL(request.url).searchParams.get('u') || ''
    if (!raw) return json({ ok: false, error: '缺少播放地址参数 u' }, 400)
    const target = allowedMediaUrl(raw)
    if (!target) return json({ ok: false, error: '不允许的媒体地址（仅支持抖音 CDN）' }, 403)

    const cookie = await readCookie()
    const headers = {
      'User-Agent': UA,
      Referer: MEDIA_REFERER,
      // 不要 gzip：直接透传二进制，交给浏览器按原始字节处理。
      'accept-encoding': 'identity',
    }
    if (cookie) headers.Cookie = cookie
    const range = request.headers.get('range')
    if (range) headers.Range = range

    const method = request.method === 'HEAD' ? 'HEAD' : 'GET'
    let upstream
    try {
      upstream = await fetch(target.href, {
        method,
        headers,
        redirect: 'follow',
        signal: upstreamSignal(request, MEDIA_TIMEOUT_MS),
      })
    } catch (error) {
      return json({ ok: false, error: '拉取抖音媒体失败：' + describe(error) }, 502)
    }

    if (upstream.status >= 400) {
      try {
        await upstream.body.cancel()
      } catch {
        // 上游错误响应没有 body 或已关闭，忽略。
      }
      return json({ ok: false, error: '抖音媒体返回 HTTP ' + upstream.status }, 502)
    }

    // 只回传这四个头；content-length 一律不写（交给 chunked，Range 场景才正确）。
    const out = new Headers()
    for (const name of ['content-type', 'content-range', 'accept-ranges', 'cache-control']) {
      const value = upstream.headers.get(name)
      if (value !== null) out.set(name, value)
    }

    if (method === 'HEAD') {
      try {
        await upstream.body.cancel()
      } catch {
        // HEAD 没有 body，忽略。
      }
      return new Response(null, { status: upstream.status, headers: out })
    }

    const body = safeBody(upstream.body)
    return new Response(body, { status: upstream.status, headers: out })
  } catch (error) {
    return json({ ok: false, error: '媒体代理失败：' + describe(error) }, 502)
  }
}

/* ------------------------------------------------------------------ 插件入口 */

/** 从 cordis ctx 上取 connection 服务（属性 / get 两种取法都兼容）。 */
function resolveConnection(ctx) {
  const readers = [
    () => (ctx ? ctx.connection : undefined),
    () => (ctx && typeof ctx.get === 'function' ? ctx.get('connection') : undefined),
  ]
  for (const read of readers) {
    try {
      const service = read()
      if (service && service.fetch && typeof service.fetch.register === 'function') return service
    } catch {
      // 取不到就试下一种取法。
    }
  }
  return undefined
}

export function apply(ctx) {
  const connection = resolveConnection(ctx)
  if (!connection) {
    throw new Error('[dsh-moyu] 需要 connection 服务（ctx.connection.fetch.register）才能注册 /api/douyin/* 路由')
  }

  ctx.effect(() => {
    const disposers = [
      connection.fetch.register({
        path: ROUTE.state,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: () => handleState(),
      }),
      connection.fetch.register({
        path: ROUTE.cookie,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => handleCookie(request),
      }),
      connection.fetch.register({
        path: ROUTE.feed,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: (request) => handleFeed(request),
      }),
      connection.fetch.register({
        path: ROUTE.media,
        methods: ['GET', 'HEAD'],
        requestBody: 'buffered',
        fetch: (request) => handleMedia(request),
      }),
      connection.fetch.register({
        path: ROUTE.bootstrap,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: () => handleBootstrap(),
      }),
    ]
    return () => {
      for (const dispose of disposers) {
        try {
          void dispose()
        } catch {
          // 单条路由卸载失败不应阻断其它路由回收。
        }
      }
    }
  }, 'dsh-moyu: fetch routes')
}
