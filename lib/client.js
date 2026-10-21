/**
 * dsh-douyin - browser half.
 *
 * A hover-reveal Douyin (抖音) player that floats over the shell:
 *
 *   - shell.overlay: a 320x460 fixed hotspot whose position is chosen in
 *     Settings. At rest it draws nothing but a 6px dot; the pointer entering
 *     the hotspot reveals the player, leaving hides it again;
 *   - settings.general.item: the switch plus the opacity and position sliders.
 *
 * Both seats are separate components in unrelated parts of the tree, so they
 * share one module-level settings store and re-render each other immediately.
 *
 * The host half owns every upstream request and every cookie. This bundle only
 * calls the plugin's own api/douyin/* routes on the page origin, and playUrl
 * already arrives as a leading-slash-free relative path, so <video src> uses
 * it verbatim.
 *
 * @module dsh-douyin/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-douyin',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    const NS = 'douyin'
    const OVERLAY_SLOT = 'shell.overlay'
    const GENERAL_SLOT = 'settings.general.item'
    const ENTRY_ID = 'douyin'
    const OVERLAY_ORDER = 60
    const GENERAL_ORDER = 30
    const CSS_TAG_ID = 'dsh-douyin/client.css'
    /** The hotspot is a fixed size; the sliders move it inside the free space. */
    const ZONE_WIDTH = 320
    const ZONE_HEIGHT = 460
    const OVERLAY_Z_INDEX = 45
    /** Settings bounds. Positions are ratios of the free space, so they stop at 90%. */
    const MIN_OPACITY = 0.15
    const OPACITY_STEP = 0.05
    const MAX_POSITION = 0.9
    const POSITION_STEP = 0.01
    /** Wheel gesture: pixels of travel before one switch, then a cooldown. */
    const WHEEL_THRESHOLD = 80
    const WHEEL_COOLDOWN = 350
    const WHEEL_LINE_HEIGHT = 16
    const WHEEL_PAGE_HEIGHT = 100
    const STORAGE_KEY = 'dsh-douyin/settings'
    const DEFAULT_SETTINGS = { enabled: true, opacity: 0.85, x: 0.16, y: 0.8, muted: true }
    /** The host serves ten items per page; prefetch two from the tail. */
    const PAGE_SIZE = 10
    const PREFETCH_AHEAD = 2
    const MAX_ITEMS = 60
    const STATE_API = 'api/douyin/state'
    const COOKIE_API = 'api/douyin/cookie'
    const FEED_API = 'api/douyin/feed?count='


    //#region stylesheet
    const css = [
      // ---- overlay shell: the layer must never eat the app's pointer events ----
      '.dy-layer{position:fixed;inset:0;z-index:45;pointer-events:none}',
      '.dy-zone{position:absolute;display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:320px;height:460px;pointer-events:none}',
      '.dy-dot{display:block;width:6px;height:6px;border-radius:999px;background:var(--dsw-alias-label-tertiary,#81858c);opacity:.3;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)}',
      '.dy-zone-idle .dy-panel{visibility:hidden}',
      // ---- panel ----
      '.dy-panel{display:flex;flex-direction:column;width:100%;height:100%;box-sizing:border-box;overflow:hidden;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#0f1115);box-shadow:var(--dsw-elevation-panel,0 6px 24px rgba(0,0,0,.18));font-size:12px;line-height:18px;text-align:left}',
      '.dy-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:none;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06))}',
      '.dy-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#0f1115)}',
      '.dy-actions{display:flex;align-items:center;gap:2px;flex:none}',
      '.dy-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;margin:0;padding:0;border:0;border-radius:var(--dsw-radius-xs,4px);background:transparent;color:var(--dsw-alias-label-tertiary,#81858c);cursor:pointer}',
      '.dy-iconbtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08));color:var(--dsw-alias-label-primary,#0f1115)}',
      '.dy-iconbtn:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-brand-primary,#4d6bfe)}',
      // ---- video view ----
      '.dy-body{display:flex;flex-direction:column;flex:1 1 auto;min-height:0}',
      '.dy-stage{position:relative;flex:1 1 auto;min-height:0;background:#000}',
      '.dy-video{display:block;width:100%;height:100%;object-fit:contain;background:#000}',
      '.dy-mute{position:absolute;right:8px;bottom:8px;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;margin:0;padding:0;border:0;border-radius:999px;background:rgba(0,0,0,.55);color:#fff;cursor:pointer}',
      '.dy-mute:hover{background:rgba(0,0,0,.72)}',
      '.dy-mute:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.dy-stage-error{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;box-sizing:border-box;padding:16px;background:rgba(0,0,0,.72);color:#fff;text-align:center}',
      '.dy-stage-error-text{margin:0;font-size:12px;line-height:18px;color:#fff}',
      '.dy-stage-error .dy-btn{flex:none;padding:3px 14px;border-color:rgba(255,255,255,.5);color:#fff}',
      // ---- item meta ----
      '.dy-meta{display:flex;flex-direction:column;gap:5px;flex:none;padding:8px 10px 6px}',
      '.dy-author{display:flex;align-items:center;gap:6px;min-width:0}',
      '.dy-avatar{flex:none;width:18px;height:18px;border-radius:999px;object-fit:cover;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
      '.dy-author-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#61666b)}',
      '.dy-desc{margin:0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;max-height:32px;overflow:hidden;overflow-wrap:anywhere;font-size:12px;line-height:16px;color:var(--dsw-alias-label-primary,#0f1115)}',
      '.dy-stats{display:flex;align-items:center;gap:10px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#81858c)}',
      '.dy-like{display:inline-flex;align-items:center;gap:4px}',
      '.dy-controls{display:flex;align-items:center;flex-wrap:wrap;gap:6px;flex:none;padding:0 10px 10px}',
      '.dy-wheel-hint{flex:0 0 100%;margin-top:2px;text-align:center;font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary,#81858c)}',
      // ---- shared buttons ----
      '.dy-btn{flex:1 1 0;min-width:0;margin:0;padding:4px 8px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06));border-radius:var(--dsw-radius-xs,4px);background:transparent;color:var(--dsw-alias-label-secondary,#61666b);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}',
      '.dy-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08));color:var(--dsw-alias-label-primary,#0f1115)}',
      '.dy-btn:disabled{opacity:.45;cursor:default}',
      '.dy-btn:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.dy-btn.dy-btn-accent{border-color:transparent;background:var(--dsw-alias-state-business-primary,#4d6bfe);color:var(--dsw-alias-label-primary-inverted,#fff)}',
      '.dy-btn.dy-btn-accent:hover:not(:disabled){background:var(--dsw-alias-state-business-primary,#4d6bfe);color:var(--dsw-alias-label-primary-inverted,#fff)}',
      // ---- loading / empty / error / no-cookie ----
      '.dy-status{display:flex;flex:1 1 auto;flex-direction:column;align-items:center;justify-content:center;gap:10px;box-sizing:border-box;padding:18px;text-align:center}',
      '.dy-status-text{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#61666b)}',
      '.dy-status .dy-btn{flex:none;padding:3px 14px}',
      '.dy-spinner{width:16px;height:16px;border:2px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));border-top-color:var(--dsw-alias-state-business-primary,#4d6bfe);border-radius:999px;animation:dy-spin .8s linear infinite}',
      '@keyframes dy-spin{to{transform:rotate(360deg)}}',
      // ---- cookie settings view ----
      '.dy-settings{display:flex;flex-direction:column;gap:8px;flex:1 1 auto;min-height:0;box-sizing:border-box;padding:10px;overflow:auto}',
      '.dy-hint{margin:0;font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary,#81858c)}',
      '.dy-cookie{flex:1 1 auto;min-height:96px;width:100%;box-sizing:border-box;margin:0;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));border-radius:var(--dsw-radius-xs,4px);background:transparent;color:var(--dsw-alias-label-primary,#0f1115);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:16px;resize:none;overflow:auto;word-break:break-all}',
      '.dy-cookie:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.dy-error{margin:0;font-size:11px;line-height:16px;color:var(--dsw-alias-state-error-primary,#ec1313);overflow-wrap:anywhere}',
      '.dy-settings-actions{display:flex;align-items:center;gap:6px;flex:none}',
      '.dy-settings-actions .dy-btn{flex:1 1 0}',
      // ---- settings -> general row ----
      '.dy-general{padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06));display:flex;flex-direction:column;gap:10px;font-size:14px;line-height:22px}',
      '.dy-general-head{display:flex;align-items:center;justify-content:space-between;gap:12px}',
      '.dy-general-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;color:var(--dsw-alias-label-primary,#0f1115)}',
      '.dy-check{flex:none;width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-state-business-primary,#4d6bfe);cursor:pointer}',
      '.dy-check:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.dy-range-row{display:flex;align-items:center;gap:10px;min-width:0}',
      '.dy-range-label{flex:none;width:76px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary,#61666b)}',
      '.dy-range{flex:1 1 auto;min-width:0;margin:0;accent-color:var(--dsw-alias-state-business-primary,#4d6bfe);cursor:pointer}',
      '.dy-range:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.dy-range-value{flex:none;width:44px;text-align:right;font-size:12px;line-height:20px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#81858c)}',
      // ---- adjust mode ----
      '.dy-zone.dy-zone-adjust{border:1px dashed var(--dsw-alias-brand-primary,#4d6bfe);background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08));pointer-events:auto;cursor:move;user-select:none;-webkit-user-select:none;touch-action:none}',
      '.dy-adjust{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;width:100%;height:100%;box-sizing:border-box;padding:16px}',
      '.dy-adjust-hint{margin:0;max-width:220px;text-align:center;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#61666b);pointer-events:none}',
      '.dy-handle{position:absolute;width:14px;height:14px;pointer-events:none;border:0 solid var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.dy-handle-tl{left:-1px;top:-1px;border-left-width:2px;border-top-width:2px}',
      '.dy-handle-tr{right:-1px;top:-1px;border-right-width:2px;border-top-width:2px}',
      '.dy-handle-bl{left:-1px;bottom:-1px;border-left-width:2px;border-bottom-width:2px}',
      '.dy-handle-br{right:-1px;bottom:-1px;border-right-width:2px;border-bottom-width:2px}',
      '.dy-adjust-done{position:absolute;right:8px;bottom:8px;flex:none;padding:4px 14px;z-index:1}',
      '.dy-adjust-open{flex:none;align-self:flex-start;padding:4px 14px}',
      // ---- dark theme ----
      // The stage is deliberately black; the neutral surfaces need an explicit
      // reading because a missing theme variable would fall back to the light
      // literal above.
      'body[data-ds-dark-theme] .dy-panel{background:var(--dsw-alias-bg-layer-1,#1f2023);border-color:var(--dsw-alias-border-l1,rgba(255,255,255,.08))}',
      'body[data-ds-dark-theme] .dy-cookie{border-color:var(--dsw-alias-border-l1,rgba(255,255,255,.12))}',
      '@media (prefers-reduced-motion:reduce){.dy-spinner{animation:none}}',
    ].join('')

    /**
     * Install the stylesheet, comparing CONTENT rather than identity.
     *
     * A client HMR swap replaces this bundle without reloading the page, so a
     * node from the previous release is still in the document. Skipping on
     * "a node with this id exists" would leave the new rules unapplied.
     */
    function injectCss() {
      if (typeof document === 'undefined' || document === null || document.head === undefined) return
      const existing = document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG_ID) + ']')
      if (existing !== null && existing !== undefined && existing.textContent === css) return
      const tag = existing !== null && existing !== undefined ? existing : document.createElement('style')
      tag.dataset.plugin = 'dsh-douyin'
      tag.dataset.pluginCss = CSS_TAG_ID
      tag.textContent = css
      if (existing === null || existing === undefined) document.head.appendChild(tag)
    }

    /**
     * Remove our own stylesheet, but only while it still holds OUR content: a
     * newer release's node must survive this instance's teardown.
     */
    function removeCss() {
      try {
        if (typeof document === 'undefined' || document === null) return
        const tag = document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG_ID) + ']')
        if (tag !== null && tag !== undefined && tag.textContent === css && typeof tag.remove === 'function') tag.remove()
      } catch (error) {
        report(error, 'stylesheet removal')
      }
    }
    //#endregion


    //#region dictionaries
    /**
     * Bilingual copy. Both dictionaries declare exactly the same keys and the
     * same placeholders, so a one-sided edit cannot ship half a translation.
     */
    const MESSAGES = {
      zh: {
        panelTitle: '抖音推荐',
        settingsTitle: '抖音设置',
        settingsAria: 'Cookie 设置',
        feedAria: '返回视频',
        loading: '加载中…',
        retry: '重试',
        needCookie: '还没有配置抖音 Cookie。需要一条已登录 douyin.com 的 Cookie 才能拉取推荐流。',
        openSettings: '去设置',
        empty: '这一批没有可播放的视频，换一批试试。',
        genericError: '加载失败，请稍后重试。',
        networkError: '网络请求失败，请检查连接。',
        settingsHelp: '不需要登录。浏览器打开 douyin.com，按 F12 → Application（应用）→ Cookies，找到 ttwid 复制它的值，粘贴成 ttwid=<值> 即可。',
        cookiePlaceholder: '例如：ttwid=1%7Cxxxxxxxx...',
        save: '保存',
        saving: '保存中…',
        clear: '清空',
        saveFailed: '保存失败：{message}',
        prev: '上一条',
        next: '下一条',
        shuffle: '换一批',
        mute: '静音',
        unmute: '取消静音',
        playFailed: '播放失败，可能是 Cookie 失效',
        playAnother: '换一条',
        noDesc: '（无文案）',
        authorFallback: '抖音用户',
        statsAria: '{count} 个赞',
        generalTitle: '抖音摸鱼',
        generalEnable: '启用抖音摸鱼浮层',
        opacityLabel: '不透明度',
        xLabel: '水平位置',
        yLabel: '垂直位置',
        locateAria: '调整浮层位置',
        adjustOpen: '调整位置',
        adjustHint: '拖动到想要的位置，完成后点「完成」',
        adjustDone: '完成',
        wheelHint: '滚轮切换',
      },
      en: {
        panelTitle: 'Douyin feed',
        settingsTitle: 'Douyin settings',
        settingsAria: 'Cookie settings',
        feedAria: 'Back to the video',
        loading: 'Loading…',
        retry: 'Retry',
        needCookie: 'No Douyin cookie yet. A cookie for a signed-in douyin.com account is required to load the feed.',
        openSettings: 'Open settings',
        empty: 'No playable video in this batch. Try another one.',
        genericError: 'Could not load. Please try again.',
        networkError: 'Network request failed. Check your connection.',
        settingsHelp: 'No sign-in needed. Open douyin.com, press F12 → Application → Cookies, copy the value of ttwid and paste it as ttwid=<value>.',
        cookiePlaceholder: 'e.g. ttwid=1%7Cxxxxxxxx...',
        save: 'Save',
        saving: 'Saving…',
        clear: 'Clear',
        saveFailed: 'Save failed: {message}',
        prev: 'Previous',
        next: 'Next',
        shuffle: 'New batch',
        mute: 'Mute',
        unmute: 'Unmute',
        playFailed: 'Playback failed — the cookie may have expired',
        playAnother: 'Play another',
        noDesc: '(No caption)',
        authorFallback: 'Douyin user',
        statsAria: '{count} likes',
        generalTitle: 'Douyin slacking',
        generalEnable: 'Enable the Douyin overlay',
        opacityLabel: 'Opacity',
        xLabel: 'Horizontal position',
        yLabel: 'Vertical position',
        locateAria: 'Adjust the overlay position',
        adjustOpen: 'Adjust position',
        adjustHint: 'Drag it where you want it, then press Done',
        adjustDone: 'Done',
        wheelHint: 'Scroll to switch',
      },
    }

    /** Browser language, used only when the host injects no t. Defaults to zh. */
    function currentLocale() {
      try {
        const language = typeof navigator !== 'undefined' && navigator !== null && typeof navigator.language === 'string'
          ? navigator.language.toLowerCase()
          : ''
        if (language.indexOf('en') === 0) return 'en'
      } catch (error) {
        return 'zh'
      }
      return 'zh'
    }

    /** Bind the active locale once; the returned t mirrors the host's. */
    function makeT(locale) {
      const dict = locale === 'en' ? MESSAGES.en : MESSAGES.zh
      return function (key, vars) {
        let text = dict[key] !== undefined ? dict[key] : MESSAGES.zh[key] !== undefined ? MESSAGES.zh[key] : key
        if (vars) for (const name of Object.keys(vars)) text = text.split('{' + name + '}').join(String(vars[name]))
        return text
      }
    }
    //#endregion


    //#region helpers
    /** Never let diagnostics become the failure they are reporting. */
    function report(error, where) {
      try {
        if (typeof console !== 'undefined' && console !== null && typeof console.error === 'function') {
          console.error('[dsh-douyin] ' + where + ' failed:', error)
        }
      } catch (ignored) {
        // A host without a usable console is not a reason to throw.
      }
    }

    /** Human text for anything thrown by fetch, a route or JSON parsing. */
    function messageOf(error) {
      if (error === null || error === undefined) return ''
      if (typeof error === 'string') return error
      if (typeof error.message === 'string' && error.message.length > 0) return error.message
      return String(error)
    }

    /** 842 / 1.2万 / 3.4亿 - Douyin's own reading of a like count. */
    function compact(value) {
      const parsed = Number(value)
      if (!Number.isFinite(parsed) || parsed <= 0) return '0'
      if (parsed < 10000) return String(Math.floor(parsed))
      const unit = parsed >= 100000000 ? 100000000 : 10000
      const scaled = parsed / unit
      const text = scaled >= 100 ? String(Math.round(scaled)) : String(Math.round(scaled * 10) / 10)
      return text + (unit === 100000000 ? '亿' : '万')
    }

    /** Only an item with a playable relative URL can be shown at all. */
    function isPlayable(item) {
      return item !== null && item !== undefined
        && typeof item.playUrl === 'string'
        && item.playUrl.length > 0
    }

    /** Append a page, dropping ids the client already holds. */
    function mergeItems(existing, incoming) {
      const seen = {}
      const merged = []
      for (const item of existing) {
        seen[String(item.id)] = true
        merged.push(item)
      }
      for (const item of incoming) {
        const key = String(item.id)
        if (seen[key] === true) continue
        seen[key] = true
        merged.push(item)
      }
      return merged
    }

    function httpFetch(url, init) {
      if (typeof fetch !== 'function') throw new Error('fetch is unavailable in this renderer')
      return fetch(url, init)
    }

    /** A body we can inspect; an unreadable body becomes null, never a throw. */
    function readJson(response) {
      try {
        return response.json().then(function (body) { return body }, function () { return null })
      } catch (error) {
        return Promise.resolve(null)
      }
    }

    /** GET api/douyin/state -> whether a cookie is stored. */
    async function requestState() {
      const response = await httpFetch(STATE_API, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })
      const body = await readJson(response)
      if (response.ok !== true) {
        throw new Error(body !== null && typeof body.error === 'string' ? body.error : 'HTTP ' + response.status)
      }
      return body !== null && body.ok === true && body.hasCookie === true
    }

    /** GET api/douyin/feed -> playable items, or a flagged cookie error. */
    async function requestFeed(refreshIndex) {
      const url = FEED_API + PAGE_SIZE + '&refreshIndex=' + String(refreshIndex)
      const response = await httpFetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })
      const body = await readJson(response)
      if (body !== null && body.ok === false) {
        const failure = new Error(typeof body.error === 'string' && body.error.length > 0 ? body.error : 'feed failed')
        failure.needCookie = body.needCookie === true
        throw failure
      }
      if (response.ok !== true || body === null || body.ok !== true) {
        throw new Error('HTTP ' + response.status)
      }
      const items = Array.isArray(body.items) ? body.items : []
      return items.filter(isPlayable)
    }

    /** POST api/douyin/cookie -> whether a cookie is now stored. */
    async function postCookie(cookie) {
      const response = await httpFetch(COOKIE_API, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ cookie: String(cookie === null || cookie === undefined ? '' : cookie) }),
      })
      const body = await readJson(response)
      if (body !== null && body.ok === true) return body.hasCookie === true
      throw new Error(body !== null && typeof body.error === 'string' ? body.error : 'HTTP ' + response.status)
    }
    //#endregion


    //#region settings store
    /**
     * The two seats live in unrelated parts of the tree, so the settings are a
     * module-level singleton: one object plus a listener set. Every write is
     * mirrored to localStorage; every read is validated, so a hand-edited or
     * half-written value can never break a render.
     */
    function clampSetting(value, min, max, fallback, precision) {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) return fallback
      const clamped = Math.min(max, Math.max(min, parsed))
      const factor = Math.pow(10, precision === undefined ? 2 : precision)
      return Math.round(clamped * factor) / factor
    }

    function normalizeSettings(raw) {
      const input = raw !== null && typeof raw === 'object' ? raw : {}
      return {
        enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_SETTINGS.enabled,
        opacity: clampSetting(input.opacity, MIN_OPACITY, 1, DEFAULT_SETTINGS.opacity, 2),
        // Positions keep three decimals so a dragged frame does not snap in
        // 1% steps; the sliders still speak in 1% steps.
        x: clampSetting(input.x, 0, MAX_POSITION, DEFAULT_SETTINGS.x, 3),
        y: clampSetting(input.y, 0, MAX_POSITION, DEFAULT_SETTINGS.y, 3),
        // Sound preference: persisted, and never touched by a video change.
        muted: typeof input.muted === 'boolean' ? input.muted : DEFAULT_SETTINGS.muted,
        // Transient, never persisted: a reload always leaves adjust mode.
        adjusting: typeof input.adjusting === 'boolean' ? input.adjusting : false,
      }
    }

    function sameSettings(left, right) {
      return left.enabled === right.enabled
        && left.opacity === right.opacity
        && left.x === right.x
        && left.y === right.y
        && left.muted === right.muted
        && left.adjusting === right.adjusting
    }

    function readStoredSettings() {
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return normalizeSettings(null)
        const text = localStorage.getItem(STORAGE_KEY)
        if (typeof text !== 'string' || text.length === 0) return normalizeSettings(null)
        return normalizeSettings(JSON.parse(text))
      } catch (error) {
        return normalizeSettings(null)
      }
    }

    function writeStoredSettings(settings) {
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return
        // adjusting is window state, not configuration: keep it out of the file.
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          enabled: settings.enabled,
          opacity: settings.opacity,
          x: settings.x,
          y: settings.y,
          muted: settings.muted,
        }))
      } catch (error) {
        // Quota or a locked-down profile: the in-memory value still drives the UI.
        report(error, 'settings persistence')
      }
    }

    const settingsStore = (function () {
      let current = readStoredSettings()
      const listeners = new Set()
      const publish = function () {
        for (const listener of Array.from(listeners)) {
          try {
            listener(current)
          } catch (error) {
            report(error, 'settings listener')
          }
        }
      }
      const apply = function (patch, persist) {
        const next = normalizeSettings(Object.assign({}, current, patch))
        if (sameSettings(current, next)) return
        current = next
        if (persist === true) writeStoredSettings(current)
        publish()
      }
      return {
        get: function () { return current },
        /** Persisted write: the switch and the sliders keep this behaviour. */
        set: function (patch, options) {
          const persist = !(options !== null && options !== undefined && options.persist === false)
          apply(patch, persist)
        },
        /** Memory-only write, used once per pointermove while dragging. */
        setTransient: function (patch) { apply(patch, false) },
        /** Flush the in-memory value: exactly one write per drag. */
        commit: function () { writeStoredSettings(current) },
        /** Adjust mode is per-window state and never stored. */
        setAdjusting: function (value) { apply({ adjusting: value === true }, false) },
        subscribe: function (listener) {
          listeners.add(listener)
          return function () { listeners.delete(listener) }
        },
      }
    })()

    /** Subscribe one seat to the shared settings. */
    function useSettings() {
      const state = React.useState(settingsStore.get)
      const settings = state[0]
      const setSettings = state[1]
      React.useEffect(function () {
        const unsubscribe = settingsStore.subscribe(setSettings)
        // Resync in case another seat wrote between render and subscription.
        setSettings(settingsStore.get())
        return unsubscribe
      }, [])
      return settings
    }

    /**
     * The hotspot geometry. The CSS and the hit test must agree, so both are
     * derived from the same two expressions: a ratio of the free space.
     */
    function zoneStyle(settings) {
      return {
        left: 'max(0px, calc(' + String(settings.x) + ' * (100vw - ' + ZONE_WIDTH + 'px)))',
        top: 'max(0px, calc(' + String(settings.y) + ' * (100vh - ' + ZONE_HEIGHT + 'px)))',
      }
    }

    /** Keep a dragged ratio inside the same bounds the sliders use. */
    function clampRatio(value) {
      if (!Number.isFinite(value)) return 0
      return Math.min(MAX_POSITION, Math.max(0, value))
    }

    /**
     * Hit test against the live DOM rect rather than re-deriving the geometry.
     *
     * `position: fixed` is only viewport-relative while no ancestor establishes
     * a containing block (transform / filter / perspective). If the host ever
     * wraps the overlay in one, a re-derived geometry would disagree with where
     * the dot actually is - and the resting state shows almost nothing, so the
     * failure would read as "the plugin does nothing". Reading the rect keeps
     * the CSS and the pointer test on one source of truth.
     */
    function isInsideRect(clientX, clientY, rect) {
      if (rect === null || rect === undefined) return false
      return clientX >= rect.left && clientX <= rect.right
        && clientY >= rect.top && clientY <= rect.bottom
    }
    //#endregion


    //#region glyphs
    /**
     * Self-drawn glyphs: the overlay ships no icon font, and an inline SVG
     * inherits currentColor from every theme.
     */
    function gearGlyph() {
      const teeth = []
      for (let index = 0; index < 8; index += 1) {
        const angle = Math.PI / 4 * index
        teeth.push(h('circle', {
          key: 'tooth-' + index,
          cx: 8 + Math.cos(angle) * 5.1,
          cy: 8 + Math.sin(angle) * 5.1,
          r: 1.05,
          fill: 'currentColor',
        }))
      }
      return h('svg', { className: 'dy-icon', width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false },
        teeth,
        h('circle', { cx: 8, cy: 8, r: 4.1, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }),
        h('circle', { cx: 8, cy: 8, r: 1.5, fill: 'currentColor' }))
    }

    function locateGlyph() {
      return h('svg', { className: 'dy-icon', width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false },
        h('circle', { cx: 8, cy: 8, r: 4.2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }),
        h('circle', { cx: 8, cy: 8, r: 1.1, fill: 'currentColor' }),
        h('path', { d: 'M8 1.4v2.2M8 12.4v2.2M1.4 8h2.2M12.4 8h2.2', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }))
    }

    function backGlyph() {
      return h('svg', { className: 'dy-icon', width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false },
        h('path', { d: 'M7.4 3.2 2.6 8l4.8 4.8', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M2.8 8h10', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }))
    }

    function heartGlyph() {
      return h('svg', { className: 'dy-icon', width: 11, height: 11, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false },
        h('path', { d: 'M8 13.4S2.2 9.9 2.2 6.2A3.1 3.1 0 0 1 8 4.6a3.1 3.1 0 0 1 5.8 1.6c0 3.7-5.8 7.2-5.8 7.2z', fill: 'currentColor' }))
    }

    function muteGlyph() {
      return h('svg', { className: 'dy-icon', width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false },
        h('path', { d: 'M3 6h2.2L8.4 3.4v9.2L5.2 10H3z', fill: 'currentColor' }),
        h('path', { d: 'M10.4 5.6 13.6 8.8M13.6 5.6 10.4 8.8', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }))
    }

    function soundGlyph() {
      return h('svg', { className: 'dy-icon', width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false },
        h('path', { d: 'M3 6h2.2L8.4 3.4v9.2L5.2 10H3z', fill: 'currentColor' }),
        h('path', { d: 'M10.6 5.7a3 3 0 0 1 0 4.6', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
        h('path', { d: 'M12.4 4a5.4 5.4 0 0 1 0 8', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }))
    }
    //#endregion


    //#region crash guard
    /**
     * Per-entry crash guard. The host already isolates slot entries, but this
     * boundary renders NOTHING on failure instead of leaving the host's
     * data-slot-error placeholder on the overlay or in the settings page.
     */
    class DouyinBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }
      static getDerivedStateFromError() {
        return { failed: true }
      }
      componentDidCatch(error) {
        report(error, 'render')
      }
      render() {
        return this.state.failed ? null : this.props.children
      }
    }
    //#endregion


    //#region overlay seat
    const FEED_IDLE = {
      phase: 'idle',
      items: [],
      error: '',
      refreshIndex: 0,
      loadingMore: false,
      pageEnded: false,
    }
    const SAVING_IDLE = { busy: false, error: '' }

    /**
     * The floating seat.
     *
     * Every hook runs before the "enabled" early return, so switching the
     * feature off never changes the hook order. Pointer tracking happens on
     * the document rather than through mouse events on the hotspot: while the
     * panel is hidden the hotspot must NOT intercept clicks, so it cannot be
     * the element that reports the pointer entering it.
     */
    function DouyinOverlay(props) {
      const settings = useSettings()
      const locale = props !== null && props !== undefined && typeof props.locale === 'string'
        ? props.locale
        : currentLocale()
      const t = props !== null && props !== undefined && typeof props.t === 'function'
        ? props.t
        : makeT(locale)

      /** Route failures through the dictionary when fetch itself failed. */
      const describeError = function (error) {
        if (error !== null && error !== undefined && error.name === 'TypeError') return t('networkError')
        const text = messageOf(error)
        return text.length > 0 ? text : t('genericError')
      }

      const insideState = React.useState(false)
      const inside = insideState[0]
      const setInside = insideState[1]

      const viewState = React.useState('feed')
      const view = viewState[0]
      const setView = viewState[1]

      const feedState = React.useState(FEED_IDLE)
      const feed = feedState[0]
      const setFeed = feedState[1]
      const feedRef = React.useRef(feed)

      const indexState = React.useState(0)
      const index = indexState[0]
      const setIndex = indexState[1]

      // Sound lives in the shared settings store: it survives a reload and no
      // video change may reset it.
      const muted = settings.muted !== false

      const videoFailedState = React.useState(false)
      const videoFailed = videoFailedState[0]
      const setVideoFailed = videoFailedState[1]

      const draftState = React.useState('')
      const draft = draftState[0]
      const setDraft = draftState[1]

      const savingState = React.useState(SAVING_IDLE)
      const saving = savingState[0]
      const setSaving = savingState[1]

      const videoRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const zoneRef = React.useRef(null)
      const dragRef = React.useRef(null)
      const insideRef = React.useRef(false)
      const generationRef = React.useRef(0)
      const wheelRef = React.useRef({ total: 0, at: 0 })
      const wheelHandlerRef = React.useRef(null)

      // Keep the latest feed reachable from callbacks without re-creating them.
      feedRef.current = feed

      /** Single funnel for the hover flag: a no-op move must not re-render. */
      const markInside = function (next) {
        if (insideRef.current === next) return
        insideRef.current = next
        setInside(next)
      }
      const markInsideRef = React.useRef(markInside)
      markInsideRef.current = markInside

      React.useEffect(function () {
        if (settings.enabled !== true) {
          markInsideRef.current(false)
          return undefined
        }
        if (typeof document === 'undefined' || document === null) return undefined
        const onPointerMove = function (event) {
          // While adjusting, the frame owns the pointer: no hover reveal.
          if (settingsStore.get().adjusting === true) {
            markInsideRef.current(false)
            return
          }
          const node = zoneRef.current
          let rect = null
          try {
            if (node !== null && node !== undefined && typeof node.getBoundingClientRect === 'function') rect = node.getBoundingClientRect()
          } catch {
            rect = null
          }
          markInsideRef.current(isInsideRect(event.clientX, event.clientY, rect))
        }
        const hide = function () { markInsideRef.current(false) }
        // pointerout with a null relatedTarget is the only reliable "the
        // pointer left the document" signal: a pointerleave listener on
        // document also fires whenever the pointer crosses an element inside
        // the panel, which would hide the player mid-hover.
        const onPointerOut = function (event) {
          if (event.relatedTarget === null || event.relatedTarget === undefined) hide()
        }
        document.addEventListener('pointermove', onPointerMove, true)
        document.addEventListener('pointerout', onPointerOut, true)
        if (typeof window !== 'undefined' && window !== null) window.addEventListener('blur', hide)
        return function () {
          document.removeEventListener('pointermove', onPointerMove, true)
          document.removeEventListener('pointerout', onPointerOut, true)
          if (typeof window !== 'undefined' && window !== null) window.removeEventListener('blur', hide)
        }
      }, [settings.enabled])

      // Adjust mode owns the keyboard: Escape always leaves it, and entering
      // it drops any hover reveal so the player cannot cover the frame.
      React.useEffect(function () {
        if (settings.adjusting !== true) return undefined
        markInsideRef.current(false)
        if (typeof document === 'undefined' || document === null) return undefined
        const onKeyDown = function (event) {
          if (event.key === 'Escape') {
            event.stopPropagation()
            settingsStore.setAdjusting(false)
          }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return function () { document.removeEventListener('keydown', onKeyDown, true) }
      }, [settings.adjusting])

      /**
       * Drag-to-place.
       *
       * The pointer is captured on the frame, so it keeps following the mouse
       * after leaving the box. Every move writes memory only (setTransient);
       * the single storage write happens on release (commit).
       *
       * The ratio is the strict inverse of zoneStyle(): the same free space
       * (viewport minus the frame) is the denominator and the drag starts from
       * the stored ratio, so the frame never jumps when a grab begins.
       */
      const dragStart = function (event) {
        if (settings.adjusting !== true) return
        if (event === null || event === undefined) return
        if (event.button !== undefined && event.button !== 0) return
        if (event.isPrimary === false) return
        const element = zoneRef.current
        if (element === null || element === undefined) return
        const current = settingsStore.get()
        const viewportWidth = typeof window !== 'undefined' && window !== null ? window.innerWidth || 0 : 0
        const viewportHeight = typeof window !== 'undefined' && window !== null ? window.innerHeight || 0 : 0
        // A viewport smaller than the frame would make the denominator
        // negative; clamp it to 1 so the ratio stays finite.
        const freeWidth = Math.max(1, viewportWidth - ZONE_WIDTH)
        const freeHeight = Math.max(1, viewportHeight - ZONE_HEIGHT)
        dragRef.current = {
          pointerId: event.pointerId === undefined ? 0 : event.pointerId,
          startX: Number(event.clientX) || 0,
          startY: Number(event.clientY) || 0,
          // The origin is the STORED ratio, never the measured rect: the frame
          // is painted by the same `calc()` that reads this ratio, so the two
          // agree by construction. Deriving it from getBoundingClientRect would
          // silently disagree whenever an ancestor establishes a containing
          // block, and the only symptom would be a one-frame jump on grab.
          originX: clampRatio(current.x),
          originY: clampRatio(current.y),
          freeWidth: freeWidth,
          freeHeight: freeHeight,
        }
        try {
          if (typeof element.setPointerCapture === 'function') element.setPointerCapture(dragRef.current.pointerId)
        } catch (error) {
          report(error, 'pointer capture')
        }
        if (typeof event.preventDefault === 'function') event.preventDefault()
      }

      const dragMove = function (event) {
        const drag = dragRef.current
        if (drag === null || drag === undefined || event === null || event === undefined) return
        const pointerId = event.pointerId === undefined ? 0 : event.pointerId
        if (drag.pointerId !== pointerId) return
        const nextX = clampRatio(drag.originX + ((Number(event.clientX) || 0) - drag.startX) / drag.freeWidth)
        const nextY = clampRatio(drag.originY + ((Number(event.clientY) || 0) - drag.startY) / drag.freeHeight)
        settingsStore.setTransient({ x: nextX, y: nextY })
        if (typeof event.preventDefault === 'function') event.preventDefault()
      }

      const dragEnd = function (event) {
        const drag = dragRef.current
        if (drag === null || drag === undefined) return
        if (event !== null && event !== undefined && event.pointerId !== undefined && drag.pointerId !== event.pointerId) return
        dragRef.current = null
        const element = zoneRef.current
        if (element !== null && element !== undefined && typeof element.releasePointerCapture === 'function') {
          try {
            element.releasePointerCapture(drag.pointerId)
          } catch (error) {
            // Already released; nothing to do.
          }
        }
        settingsStore.commit()
      }

      /**
       * One loader for three intents:
       *   check   - ask the host for the cookie state, then page one;
       *   refresh - replace the list (换一批 / 重试);
       *   append  - add the next page behind the current one.
       * A generation counter turns a superseded request into a no-op.
       */
      const load = React.useCallback(function (mode) {
        const previous = feedRef.current
        const append = mode === 'append'
        if (append) {
          if (previous.phase !== 'ready') return
          if (previous.loadingMore === true || previous.pageEnded === true) return
          if (previous.items.length === 0 || previous.items.length >= MAX_ITEMS) return
        } else if (previous.phase === 'loading') {
          return
        }

        const generation = generationRef.current + 1
        generationRef.current = generation
        const refreshIndex = (Number.isFinite(previous.refreshIndex) ? previous.refreshIndex : 0) + 1

        if (append === false) {
          setIndex(0)
          setVideoFailed(false)
        }

        const pending = append
          ? {
            phase: previous.phase,
            items: previous.items,
            error: previous.error,
            refreshIndex: refreshIndex,
            loadingMore: true,
            pageEnded: previous.pageEnded,
          }
          : {
            phase: 'loading',
            items: [],
            error: '',
            refreshIndex: refreshIndex,
            loadingMore: false,
            pageEnded: false,
          }
        feedRef.current = pending
        setFeed(pending)

        const settle = function (patch) {
          if (generationRef.current !== generation) return
          const current = feedRef.current
          const next = {
            phase: patch.phase !== undefined ? patch.phase : current.phase,
            items: patch.items !== undefined ? patch.items : current.items,
            error: patch.error !== undefined ? patch.error : current.error,
            refreshIndex: current.refreshIndex,
            loadingMore: patch.loadingMore !== undefined ? patch.loadingMore : current.loadingMore,
            pageEnded: patch.pageEnded !== undefined ? patch.pageEnded : current.pageEnded,
          }
          feedRef.current = next
          setFeed(next)
        }

        const run = async function () {
          try {
            if (mode === 'check') {
              const hasCookie = await requestState()
              if (generationRef.current !== generation) return
              if (!hasCookie) {
                settle({ phase: 'nocookie', items: [], loadingMore: false, pageEnded: true })
                return
              }
            }
            const items = await requestFeed(refreshIndex)
            if (append) {
              const merged = mergeItems(previous.items, items)
              settle({
                phase: 'ready',
                items: merged,
                loadingMore: false,
                // A page that added nothing means the tail is reached. Stop
                // prefetching instead of asking again on every render.
                pageEnded: merged.length === previous.items.length,
              })
              return
            }
            settle({
              phase: items.length === 0 ? 'empty' : 'ready',
              items: items,
              error: '',
              loadingMore: false,
              pageEnded: false,
            })
          } catch (error) {
            if (generationRef.current !== generation) return
            if (append) {
              settle({ loadingMore: false, pageEnded: true })
              report(error, 'feed append')
              return
            }
            settle({
              phase: error !== null && error !== undefined && error.needCookie === true ? 'nocookie' : 'error',
              items: [],
              error: describeError(error),
              loadingMore: false,
              pageEnded: false,
            })
          }
        }
        run()
        // The loader must stay referentially stable: the prefetch effect lists
        // it as a dependency, and a fresh identity there would loop forever.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      // The first reveal asks the host whether a cookie exists, then page one.
      React.useEffect(function () {
        if (settings.enabled !== true || inside !== true) return
        if (feedRef.current.phase !== 'idle') return
        load('check')
      }, [settings.enabled, inside, load])

      // The poster and the avatar point straight at the Douyin CDN, so the
      // referrer has to be scrubbed on the element itself; a prop is not
      // reliable across every host React release.
      React.useEffect(function () {
        const element = videoRef.current
        if (element === null || element === undefined) return
        try {
          element.setAttribute('referrerpolicy', 'no-referrer')
          element.setAttribute('playsinline', '')
          element.muted = muted
        } catch (error) {
          report(error, 'video attributes')
        }
      }, [index, view, inside, muted])

      // The player renders native controls, so the user can unmute from the
      // control bar as well. That path mutates the element directly and React
      // never hears about it; without this sync the hide/show pass would write
      // the stale store value back over the user's choice.
      React.useEffect(function () {
        if (view !== 'feed') return undefined
        const element = videoRef.current
        if (element === null || element === undefined || typeof element.addEventListener !== 'function') return undefined
        const onVolumeChange = function () {
          try {
            const actual = element.muted === true
            if (settingsStore.get().muted === actual) return
            settingsStore.set({ muted: actual })
          } catch (error) {
            report(error, 'volume sync')
          }
        }
        element.addEventListener('volumechange', onVolumeChange)
        return function () {
          try {
            if (typeof element.removeEventListener === 'function') element.removeEventListener('volumechange', onVolumeChange)
          } catch (ignored) {
            // The element may already be gone.
          }
        }
        // `feed` is in the deps on purpose: the <video> only mounts once the
        // first page has arrived, so an effect keyed on index/view/inside alone
        // would run while videoRef is still null and never attach afterwards.
      }, [index, view, inside, feed])

      // Play while the pointer is in the hotspot, pause when it leaves.
      //
      // Pausing (rather than unmounting) is what keeps the position: the same
      // <video> element survives the hide, so re-entry resumes mid-clip and the
      // mute state stored in the settings is still the one in effect.
      React.useEffect(function () {
        const element = videoRef.current
        if (element === null || element === undefined) return
        if (inside !== true || view !== 'feed') {
          try {
            if (typeof element.pause === 'function') element.pause()
          } catch (ignored) {
            // Nothing to report: the element is going away anyway.
          }
          return
        }
        try {
          // Re-assert before every play: the volume can have been changed from
          // the native control bar since the attribute effect last ran.
          element.muted = muted
          const playback = element.play()
          if (playback !== null && playback !== undefined && typeof playback.catch === 'function') {
            playback.catch(function () {})
          }
        } catch (ignored) {
          // The controls stay available; nothing to report.
        }
      }, [index, inside, view, muted])

      // Prefetch the next page before the tail, and never in a loop.
      React.useEffect(function () {
        if (inside !== true || view !== 'feed') return
        if (feed.phase !== 'ready') return
        if (feed.loadingMore === true || feed.pageEnded === true) return
        if (feed.items.length === 0 || feed.items.length >= MAX_ITEMS) return
        if (index < feed.items.length - PREFETCH_AHEAD) return
        load('append')
      }, [inside, view, index, feed, load])

      /**
       * The wheel is the primary way to switch videos, so it is attached
       * natively with passive:false: React 17+ registers wheel handlers as
       * passive at the root, where preventDefault() would be ignored.
       * It only exists in the feed view - the cookie textarea keeps its own
       * scrolling untouched.
       */
      React.useEffect(function () {
        if (settings.enabled !== true || inside !== true || view !== 'feed') return undefined
        const element = panelRef.current
        if (element === null || element === undefined || typeof element.addEventListener !== 'function') return undefined
        const onWheel = function (event) {
          const handler = wheelHandlerRef.current
          if (typeof handler === 'function') handler(event)
        }
        element.addEventListener('wheel', onWheel, { passive: false })
        return function () {
          element.removeEventListener('wheel', onWheel, { passive: false })
        }
      }, [settings.enabled, inside, view])

      const item = feed.items.length > 0 && index >= 0 && index < feed.items.length ? feed.items[index] : null

      const toggleMute = function () {
        const next = muted !== true
        settingsStore.set({ muted: next })
        const element = videoRef.current
        if (element !== null && element !== undefined) {
          try {
            element.muted = next
          } catch (error) {
            report(error, 'mute')
          }
        }
      }

      const retry = function () { load('refresh') }
      const shuffle = function () { load('refresh') }

      const previousItem = function () {
        if (index <= 0) return
        setVideoFailed(false)
        setIndex(index - 1)
      }

      const nextItem = function () {
        setVideoFailed(false)
        if (index < feed.items.length - 1) {
          setIndex(index + 1)
          return
        }
        load('append')
      }

      const playAnother = function () {
        setVideoFailed(false)
        if (index < feed.items.length - 1) {
          setIndex(index + 1)
          return
        }
        load('refresh')
      }

      /**
       * Wheel -> next / previous.
       *
       * A trackpad emits dozens of events per gesture, so travel accumulates
       * until it passes WHEEL_THRESHOLD, and one switch happens at most once
       * per WHEEL_COOLDOWN. A reversed gesture starts a fresh accumulation,
       * otherwise the old total would cancel it out and the wheel would feel
       * dead after changing direction.
       */
      const onWheelSwitch = function (event) {
        if (view !== 'feed') return
        if (event === null || event === undefined) return
        // Ctrl/Cmd + wheel is browser zoom. Swallowing it here would make the
        // page refuse to zoom whenever the pointer happens to be over the panel.
        if (event.ctrlKey === true || event.metaKey === true) return
        if (typeof event.preventDefault === 'function') event.preventDefault()
        if (typeof event.stopPropagation === 'function') event.stopPropagation()
        const mode = event.deltaMode === 1 ? 1 : event.deltaMode === 2 ? 2 : 0
        const raw = Number(event.deltaY)
        if (!Number.isFinite(raw)) return
        const unit = mode === 2 ? WHEEL_PAGE_HEIGHT : mode === 1 ? WHEEL_LINE_HEIGHT : 1
        const delta = raw * unit
        if (delta === 0) return
        const now = Date.now()
        const state = wheelRef.current
        if (state.total !== 0 && (state.total > 0) !== (delta > 0)) state.total = 0
        state.total += delta
        if (Math.abs(state.total) < WHEEL_THRESHOLD) return
        if (now - state.at < WHEEL_COOLDOWN) return
        const forward = state.total > 0
        state.total = 0
        state.at = now
        if (forward) nextItem()
        else previousItem()
      }
      wheelHandlerRef.current = onWheelSwitch

      const openSettings = function () { setView('settings') }
      const toggleView = function () { setView(view === 'settings' ? 'feed' : 'settings') }

      /** Persist whatever is in the textarea; an empty box clears the cookie. */
      const persistCookie = function (value) {
        if (saving.busy === true) return
        setSaving({ busy: true, error: '' })
        postCookie(value).then(function (hasCookie) {
          setSaving(SAVING_IDLE)
          setDraft('')
          generationRef.current += 1
          const base = feedRef.current
          const next = {
            phase: hasCookie ? 'idle' : 'nocookie',
            items: [],
            error: '',
            refreshIndex: base.refreshIndex,
            loadingMore: false,
            pageEnded: hasCookie ? false : true,
          }
          feedRef.current = next
          setFeed(next)
          setView('feed')
          if (hasCookie) load('check')
        }, function (error) {
          setSaving({ busy: false, error: describeError(error) })
        })
      }

      const submitCookie = function () { persistCookie(draft.trim()) }
      const clearCookie = function () { persistCookie('') }

      const actionButton = function (label, onClick, accent) {
        return h('button', {
          type: 'button',
          className: accent === true ? 'dy-btn dy-btn-accent' : 'dy-btn',
          onClick: onClick,
        }, label)
      }

      const statusBlock = function (text, spinner, action) {
        return h('div', { className: 'dy-status' },
          spinner === true ? h('span', { className: 'dy-spinner', 'aria-hidden': true }) : null,
          h('p', { className: 'dy-status-text' }, text),
          action === null || action === undefined ? null : action)
      }

      /** Keep the wheel inside the panel: never scroll the chat behind it. */
      const stopWheel = function (event) {
        event.stopPropagation()
      }

      const videoStage = function (current) {
        return h('div', { className: 'dy-stage' },
          h('video', {
            key: String(current.id),
            ref: videoRef,
            className: 'dy-video',
            src: current.playUrl,
            poster: typeof current.cover === 'string' && current.cover.length > 0 ? current.cover : undefined,
            controls: true,
            playsInline: true,
            autoPlay: true,
            muted: muted,
            loop: true,
            preload: 'metadata',
            referrerPolicy: 'no-referrer',
            onError: function () { setVideoFailed(true) },
          }),
          videoFailed === true
            ? h('div', { className: 'dy-stage-error' },
              h('p', { className: 'dy-stage-error-text' }, t('playFailed')),
              actionButton(t('playAnother'), playAnother, false))
            : null,
          h('button', {
            type: 'button',
            className: 'dy-mute',
            title: muted === true ? t('unmute') : t('mute'),
            'aria-label': muted === true ? t('unmute') : t('mute'),
            onClick: toggleMute,
          }, muted === true ? muteGlyph() : soundGlyph()))
      }

      const metaBlock = function (current) {
        const author = current.author !== null && current.author !== undefined ? current.author : null
        const authorName = author !== null && typeof author.name === 'string' && author.name.length > 0
          ? author.name
          : t('authorFallback')
        const avatar = author !== null && typeof author.avatar === 'string' && author.avatar.length > 0
          ? author.avatar
          : null
        const desc = typeof current.desc === 'string' && current.desc.trim().length > 0
          ? current.desc
          : t('noDesc')
        const stats = current.stats !== null && current.stats !== undefined ? current.stats : {}
        const digg = compact(stats.digg)

        return h('div', { className: 'dy-meta' },
          h('div', { className: 'dy-author' },
            avatar === null
              ? null
              : h('img', {
                className: 'dy-avatar',
                src: avatar,
                alt: '',
                loading: 'lazy',
                referrerPolicy: 'no-referrer',
              }),
            h('span', { className: 'dy-author-name' }, authorName)),
          h('p', { className: 'dy-desc' }, desc),
          h('div', { className: 'dy-stats' },
            h('span', { className: 'dy-like', 'aria-label': t('statsAria', { count: digg }) },
              heartGlyph(),
              h('span', null, digg))))
      }

      const feedBody = function () {
        if (feed.phase === 'idle' || feed.phase === 'loading') {
          return statusBlock(t('loading'), true, null)
        }
        if (feed.phase === 'nocookie') {
          return statusBlock(t('needCookie'), false, actionButton(t('openSettings'), openSettings, true))
        }
        if (feed.phase === 'error') {
          return statusBlock(feed.error.length > 0 ? feed.error : t('genericError'), false, actionButton(t('retry'), retry, false))
        }
        if (item === null) {
          return statusBlock(t('empty'), false, actionButton(t('shuffle'), shuffle, true))
        }

        const atStart = index <= 0
        const atEnd = index >= feed.items.length - 1 && feed.pageEnded === true
        return h('div', { className: 'dy-body' },
          videoStage(item),
          metaBlock(item),
          h('div', { className: 'dy-controls' },
            h('button', { type: 'button', className: 'dy-btn', disabled: atStart, onClick: previousItem }, t('prev')),
            h('button', { type: 'button', className: 'dy-btn', disabled: atEnd, onClick: nextItem }, t('next')),
            h('button', { type: 'button', className: 'dy-btn dy-btn-accent', onClick: shuffle }, t('shuffle')),
            h('span', { className: 'dy-wheel-hint' }, t('wheelHint'))))
      }

      const settingsBody = function () {
        return h('div', { className: 'dy-settings' },
          h('p', { className: 'dy-hint' }, t('settingsHelp')),
          h('textarea', {
            className: 'dy-cookie',
            value: draft,
            spellCheck: false,
            placeholder: t('cookiePlaceholder'),
            'aria-label': t('settingsAria'),
            onChange: function (event) { setDraft(event.target.value) },
          }),
          saving.error.length > 0
            ? h('p', { className: 'dy-error' }, t('saveFailed', { message: saving.error }))
            : null,
          h('div', { className: 'dy-settings-actions' },
            h('button', {
              type: 'button',
              className: 'dy-btn dy-btn-accent',
              disabled: saving.busy === true,
              onClick: submitCookie,
            }, saving.busy === true ? t('saving') : t('save')),
            h('button', {
              type: 'button',
              className: 'dy-btn',
              disabled: saving.busy === true,
              onClick: clearCookie,
            }, t('clear'))))
      }

      if (settings.enabled !== true) return null

      const adjusting = settings.adjusting === true

      /**
       * The adjustment frame: a dashed box with corner handles that follows
       * the pointer. It renders instead of the player, so dragging can never
       * pop the video up under the cursor.
       */
      const adjustFrame = function () {
        return h('div', { className: 'dy-adjust' },
          h('span', { className: 'dy-handle dy-handle-tl', 'aria-hidden': true }),
          h('span', { className: 'dy-handle dy-handle-tr', 'aria-hidden': true }),
          h('span', { className: 'dy-handle dy-handle-bl', 'aria-hidden': true }),
          h('span', { className: 'dy-handle dy-handle-br', 'aria-hidden': true }),
          h('p', { className: 'dy-adjust-hint' }, t('adjustHint')),
          h('button', {
            type: 'button',
            className: 'dy-btn dy-btn-accent dy-adjust-done',
            onPointerDown: function (event) { event.stopPropagation() },
            onClick: function () { settingsStore.setAdjusting(false) },
          }, t('adjustDone')))
      }

      const panel = adjusting === true ? null : h('div', {
        key: 'panel',
        className: 'dy-panel',
        ref: panelRef,
        role: 'dialog',
        'aria-label': view === 'settings' ? t('settingsTitle') : t('panelTitle'),
        style: { opacity: settings.opacity },
        onWheel: stopWheel,
      },
      h('div', { className: 'dy-head' },
        h('span', { className: 'dy-title' }, view === 'settings' ? t('settingsTitle') : t('panelTitle')),
        h('div', { className: 'dy-actions' },
          h('button', {
            type: 'button',
            className: 'dy-iconbtn',
            title: t('locateAria'),
            'aria-label': t('locateAria'),
            onClick: function () { settingsStore.setAdjusting(true) },
          }, locateGlyph()),
          h('button', {
            type: 'button',
            className: 'dy-iconbtn',
            title: view === 'settings' ? t('feedAria') : t('settingsAria'),
            'aria-label': view === 'settings' ? t('feedAria') : t('settingsAria'),
            onClick: toggleView,
          }, view === 'settings' ? backGlyph() : gearGlyph()))),
      view === 'settings' ? settingsBody() : feedBody())

      const dot = h('span', { key: 'dot', className: 'dy-dot', 'aria-hidden': true })

      const zoneProps = {
        className: adjusting === true
          ? 'dy-zone dy-zone-adjust'
          : (inside === true ? 'dy-zone' : 'dy-zone dy-zone-idle'),
        // The hidden player is still mounted, so hide it from assistive tech
        // as well: a dialog that is invisible but announced is a trap.
        'aria-hidden': adjusting !== true && inside !== true ? true : undefined,
        ref: zoneRef,
        style: adjusting === true
          ? Object.assign(zoneStyle(settings), { pointerEvents: 'auto', cursor: 'move', userSelect: 'none' })
          : Object.assign(zoneStyle(settings), { pointerEvents: inside === true ? 'auto' : 'none' }),
      }
      if (adjusting === true) {
        zoneProps.onPointerDown = dragStart
        zoneProps.onPointerMove = dragMove
        zoneProps.onPointerUp = dragEnd
        zoneProps.onPointerCancel = dragEnd
        zoneProps.onLostPointerCapture = dragEnd
      }

      return h('div', { className: 'dy-layer' },
        h('div', zoneProps, adjusting === true
          ? adjustFrame()
          // The player stays MOUNTED while the pointer is away and is only
          // hidden: unmounting would destroy the <video>, so re-entry would
          // restart the clip at zero instead of resuming where it paused.
          : [panel, inside === true ? null : dot]))
    }


    //#region settings -> general seat
    /**
     * The row inside Settings -> General. Its visuals mirror the host's own
     * rows: native inputs, theme variables with literal fallbacks, and the
     * standard padded block with a separating border.
     */
    function DouyinGeneral(props) {
      const settings = useSettings()
      const locale = props !== null && props !== undefined && typeof props.locale === 'string'
        ? props.locale
        : currentLocale()
      const t = props !== null && props !== undefined && typeof props.t === 'function'
        ? props.t
        : makeT(locale)

      const percent = function (value) { return Math.round(value * 100) + '%' }

      const rangeRow = function (label, value, min, max, step, display, onChange) {
        return h('div', { className: 'dy-range-row' },
          h('span', { className: 'dy-range-label' }, label),
          h('input', {
            type: 'range',
            className: 'dy-range',
            min: min,
            max: max,
            step: step,
            value: value,
            'aria-label': label,
            onChange: function (event) { onChange(event.target.value) },
          }),
          h('span', { className: 'dy-range-value' }, display))
      }

      return h('div', { className: 'dy-general' },
        h('div', { className: 'dy-general-head' },
          h('span', { className: 'dy-general-title' }, t('generalTitle')),
          h('input', {
            type: 'checkbox',
            className: 'dy-check',
            checked: settings.enabled === true,
            'aria-label': t('generalEnable'),
            onChange: function (event) { settingsStore.set({ enabled: event.target.checked === true }) },
          })),
        rangeRow(t('opacityLabel'), settings.opacity, MIN_OPACITY, 1, OPACITY_STEP, percent(settings.opacity),
          function (value) { settingsStore.set({ opacity: Number(value) }) }),
        rangeRow(t('xLabel'), settings.x, 0, MAX_POSITION, POSITION_STEP, percent(settings.x),
          function (value) { settingsStore.set({ x: Number(value) }) }),
        rangeRow(t('yLabel'), settings.y, 0, MAX_POSITION, POSITION_STEP, percent(settings.y),
          function (value) { settingsStore.set({ y: Number(value) }) }),
        h('button', {
          type: 'button',
          className: 'dy-btn dy-adjust-open',
          onClick: function () { settingsStore.setAdjusting(true) },
        }, t('adjustOpen')))
    }
    //#endregion


    //#region entries
    /** Registered overlay component: the boundary owns the layer. */
    function OverlayEntry(props) {
      return h(DouyinBoundary, null, h(DouyinOverlay, props))
    }

    /** Registered settings component: the boundary owns the row. */
    function GeneralEntry(props) {
      return h(DouyinBoundary, null, h(DouyinGeneral, props))
    }
    //#endregion


    //#region plugin
    /**
     * Client plugin body. Every step is individually guarded: a plugin that
     * fails to register must cost nothing but its own absence.
     */
    function apply(ctx) {
      if (ctx === null || ctx === undefined) return

      try {
        injectCss()
        if (typeof ctx.effect === 'function') ctx.effect(function () { return removeCss }, 'douyin: stylesheet')
      } catch (error) {
        report(error, 'stylesheet')
      }

      // The dictionaries and the slot's locale option are a matched pair: a
      // declared namespace without the locale face throws while the slot is
      // assembled, and an assembly error outruns per-entry isolation.
      let localeReady = false
      try {
        const localeService = typeof ctx.get === 'function' ? ctx.get('locale') : undefined
        if (localeService !== null && localeService !== undefined
          && typeof localeService.register === 'function'
          && typeof ctx.effect === 'function') {
          ctx.effect(function () { return localeService.register(NS, MESSAGES) }, 'douyin: dictionaries')
          localeReady = true
        }
      } catch (error) {
        localeReady = false
        report(error, 'locale')
      }

      let slots
      try {
        slots = typeof ctx.get === 'function' ? ctx.get('slots') : undefined
      } catch (error) {
        report(error, 'service lookup')
        return
      }
      if (slots === null || slots === undefined || typeof slots.inject !== 'function') {
        report(new Error('the slots service is unavailable, no seat can be claimed'), 'slots')
        return
      }

      /**
       * Claim one seat through slots.inject: the slot key may simply never be
       * declared, and a missing slot must not throw here. slots.register alone
       * would throw in that case, which is why both layers are guarded.
       */
      const seat = function (slotKey, order, component) {
        try {
          return slots.inject(slotKey, function () {
            if (typeof slots.register !== 'function') return undefined
            const options = { name: slotKey, id: ENTRY_ID, order: order }
            if (localeReady === true) options.locale = NS
            try {
              return slots.register(options, component)
            } catch (error) {
              report(error, slotKey + ' register')
              return undefined
            }
          })
        } catch (error) {
          report(error, slotKey + ' inject')
          return undefined
        }
      }

      seat(OVERLAY_SLOT, OVERLAY_ORDER, OverlayEntry)
      seat(GENERAL_SLOT, GENERAL_ORDER, GeneralEntry)
    }

    exports.apply = apply
    /**
     * Wait for the slot registry before applying.
     *
     * Declaring nothing made the client Loader run apply() immediately at boot,
     * which is BEFORE the renderer provides the slots service; the guard in
     * apply() then saw no service and returned, so nothing was ever registered -
     * silently, because the HMR path happens to have the service already.
     */
    exports.inject = ['slots']
    /** Exposed for the dictionary-parity gate; not a public API. */
    exports.__messages = MESSAGES
    /** Exposed for the settings gate; not a public API. */
    exports.__defaultSettings = DEFAULT_SETTINGS
    return module.exports
  },
})
