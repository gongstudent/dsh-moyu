# 架构

> 包名 `dsh-moyu`（摸鱼），当前只实现抖音模块。API 路由保留 `/api/douyin/*`，
> 因为路由描述的是数据源；新增平台时按 `/api/<平台>/*` 平行扩展。

## 两个运行时

DSH 插件分成两个 bundle，跑在完全不同的地方：

```
        ┌──────────────────────────────┐
        │  Harness 渲染进程（浏览器）    │
        │  lib/client.js               │
        │  · shell.overlay             │  ── 渲染、交互、播放
        │  · settings.general.item     │
        │  · localStorage 存界面设置     │
        └──────────────┬───────────────┘
                       │  fetch 相对路径（同源，自动带 cookie）
                       ▼
        ┌──────────────────────────────┐
        │  Harness 宿主进程（Node）      │
        │  lib/index.js                │
        │  · /api/douyin/* 路由         │  ── 签名、抓流、媒体反代
        │  · ~/.dsh/storages/*.json    │
        └──────────────────────────────┘
```

分界的理由只有一个：**抖音的接口在浏览器里发不出去**。

| 障碍 | 具体后果 |
|---|---|
| `X-Bogus` 签名 | 签名结果依赖实际发送的 User-Agent；先在浏览器签、再经代理转发，UA 一变签名即作废 |
| `Cookie` / `Referer` 是 forbidden header | 浏览器 JS 无法设置；跨域还要过预检，抖音不会回 CORS 头 |
| `/aweme/v1/play/` 需带凭据请求后 302 到 CDN | `<video>` 不携带 Cookie，也无法读取跨域 302 的结果 |

## 宿主半边

Cordis 函数插件：`export const name / inject / apply`，`inject = ['connection']`。

挂载方式是 `ctx.connection.fetch.register({ path, methods, requestBody, fetch })`——
path 必须以 `/api/` 开头，鉴权（Host/Origin 栅栏 + 浏览器 cookie）由 `/api` 前缀统一完成。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/douyin/state` | `{ ok, hasCookie, version }` |
| POST | `/api/douyin/cookie` | body `{ cookie }`，落盘 `~/.dsh/storages/dsh-moyu.json`；空串=清除 |
| GET | `/api/douyin/feed?count=10&refreshIndex=1` | 签名后抓推荐流，归一化成统一 item |
| POST | `/api/douyin/bootstrap` | 开一次无头浏览器把 `ttwid` 取回来并存盘 |
| GET/HEAD | `/api/douyin/media?u=<encoded>` | 媒体反代，透传 `Range` |

### feed 归一化

上游 `aweme_list` 被压成：

```json
{
  "id": "…", "desc": "…",
  "author": { "name": "…", "avatar": "https://… 或 null" },
  "cover": "https://… 或 null",
  "duration": 15000,
  "playUrl": "api/douyin/media?u=<encodeURIComponent(原始地址)>",
  "stats": { "digg": 0, "comment": 0, "share": 0 }
}
```

`playUrl` **故意不带前导斜杠**：浏览器按 `document.baseURI` 解析，这样桌面端的
`dsh-app://app` 和网页端的 `http://127.0.0.1:port/` 两种 origin 都成立。

没有 `video` 或取不到播放地址的条目直接丢弃。上游返回 `blocked` / 空串时不当作 JSON 解析，
而是映射成「凭据失效」的中文错误 + `needCookie: true`。

### 媒体反代

- 主机白名单：只放行 `douyin.com` / `douyinvod.com` / `bytecdn.com` 等域**及其子域**
  （用 `h === d || h.endsWith('.' + d)`，不是 `includes`——否则 `evildouyin.com` 会被放进来）。
  这是为了防止插件变成一个任意 URL 的本地出网代理。
- 透传 `Range`，回程保留 `content-type` / `content-range` / `accept-ranges` / `cache-control`。
- **不写 `content-length`**：桌面 shell 会剥掉它，而响应体是流式的，长度不符会把连接挂住。
- 上游补 `User-Agent` / `Referer` / `Cookie`——浏览器不会替你带。

## 浏览器半边

### 两个槽位

| 槽位 | kind / scope | id / order | 作用 |
|---|---|---|---|
| `settings.general.item` | list / root | `douyin` / 30 | 「设置 → 通用」里的开关与滑块 |
| `shell.overlay` | list / root | `douyin` / 60 | 悬浮播放器 |

注册一律走 `ctx.slots.inject(key, cb)` → `ctx.slots.register(options, Component)`，
两层各自 try/catch，组件外层再包一个 ErrorBoundary。

`exports.inject = ['slots']` 是硬要求：不声明的话，开机时 `slots` 服务还没就绪，
`apply` 里拿不到服务就会静默返回，表现为「插件每次重启后消失，且控制台一声不响」——
而 HMR 下却一切正常，非常容易误判。

### 状态

模块级单例 store，两个槽位共享（它们挂在页面的不同位置，必须靠订阅打通）：

```js
settingsStore.get()            // 当前值
settingsStore.set(patch)       // 改并立即落盘（开关、滑块）
settingsStore.setTransient(p)  // 只改内存（拖动中）
settingsStore.commit()         // 落盘一次（拖动结束）
settingsStore.subscribe(fn)    // 返回取消订阅函数
```

持久化到 `localStorage['dsh-moyu/settings']`：`{ enabled, opacity, x, y, muted }`。
`adjusting` 是窗口状态，序列化时排除。

x / y 是「自由空间的比例」而不是绝对像素：
`left = max(0, x * (100vw - 320px))`。换显示器、改窗口大小后不会跑到屏幕外。

## 几个不显眼但必要的实现决定

| 决定 | 原因 |
|---|---|
| 鼠标移开时**隐藏**面板而不是卸载 | 卸载会销毁 `<video>`，重新移入只能从头播；保留挂载才能从当前帧继续 |
| 命中测试读 `getBoundingClientRect()` | `position: fixed` 只在祖先没有 transform/filter 时才是相对视口。读真实矩形让 CSS 与命中判定共用一个事实来源 |
| 拖动起点取 store 里的比例，不取矩形 | 纯位移拖动只需要 delta。取矩形会在存在 containing block 时产生固定偏移，表现为抓起瞬间「跳一下」 |
| wheel 用原生监听 + `passive: false` | React 17+ 把 wheel 当 passive 挂在根节点，`onWheel` 里的 `preventDefault()` 无效，页面会跟着滚 |
| 监听 `volumechange` 回写设置 | 播放器用原生 `controls`，用户从控制条改静音时 React 感知不到；不回写的话，隐藏再显示会把旧值覆盖回去 |
| 控制条用 `controlsList="nofullscreen"` 去掉全屏键 | 控制条在 UA shadow root 里，CSS 够不到单个按钮，这是唯一受支持的单键隐藏方式。浮层是 320×460 的固定热点，全屏会占满整个界面；鼠标一移开就收起面板，全屏播放器会留在原地且没有可见的退出路径 |
| `volumechange` 的 effect 依赖里带 `feed` | `<video>` 是数据到位后才挂载的；只依赖 index/view/inside 时 effect 第一次跑在 `ref === null`，之后不再重跑，监听永远挂不上 |
| `Ctrl/Cmd + 滚轮` 放行 | 那是浏览器缩放，拦掉会让鼠标停在面板上时无法缩放 |
| 隐藏态加 `aria-hidden` | 看不见但会被读屏软件念出来的 dialog 是个陷阱 |
| `ttwid` 只能「去拿」不能「生成」 | 它是服务端签名的 `1|<base62>|<时间戳>|<签名>`，本地合成必被拒（实测三种形态全部返回 `blocked`） |
| 引导用 CDP over pipe 而非 WebSocket | 宿主跑在 `ELECTRON_RUN_AS_NODE` 子进程里，拿不到 Electron 的 `BrowserWindow`，只能外部起浏览器；`--remote-debugging-pipe` 走 fd 3/4 传 `\0` 分隔的裸 JSON，不依赖 `globalThis.WebSocket`，任何 Node 版本都能跑 |

## 与 touchFish 的差异

本项目从 [touchFish](https://github.com/ylw1997/touchFish) 的抖音模块提取，主要改动：

- 从 VS Code Webview 移植到 DSH 槽位，消息通道 `postMessage + uuid` 换成同源 `fetch`
- 去掉 Webview 专有依赖：`acquireVsCodeApi`、`ThemeWrapper`、CSP、FFmpeg 检测提示
- 只保留推荐流；喜欢列表（需 spawn Chrome + CDP 抓包）、直播弹幕（自研 protobuf + 私有签名）、评论、HLS 直播全部未移植
- 主题变量从 `--vscode-*` 换成 `--dsw-*`，每个 `var()` 都带字面量兜底
