# dsh-moyu

> **moyu** = 摸鱼。这是一个给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
> 用的摸鱼套件，**抖音是它的第一个模块**——名字不带平台，后面加 B 站、网易云、播客都不用改名。

在 DeepSeek Harness 的界面上刷抖音。

鼠标移到屏幕上一块隐形热点上，抖音推荐流就地展开成播放器；移开自动收起、暂停；
滚轮上下切视频。**全程不需要登录抖音账号。**

```
                    ┌──────────────────┐
  鼠标移入 ────────▶│  ▶ 视频 / 作者 / 文案 │
                    │  ‹ 上一条 · 下一条 › │
                    └──────────────────┘
  鼠标移出 ────────▶  ·  （只剩一个 6px 圆点）
```

> 这是一个 DSH 客户端插件（`dsh.client`），宿主半边负责签名与媒体反代，浏览器半边只负责渲染。

## 特性

- **悬停即用**：静息态只留一个 6px 半透明圆点，`pointer-events: none`，不挡任何操作
- **滚轮切换**：向下=下一条，向上=上一条；带累加阈值与冷却，一次手势只跳一条
- **暂停 / 恢复**：鼠标移开暂停在当前帧，移回从原处继续播放（不是重播）
- **位置随便摆**：设置里拖滑块，或进入调整模式直接拖动虚线框
- **透明度可调**：15% ~ 100%，方便和背景融为一体
- **声音记忆**：静音状态持久化；从原生控制条改也会被同步
- **不需要登录**：只要一个匿名 `ttwid`，见下

## 为什么不需要登录

这一点值得单独说，因为大部分抖音第三方工具都要求扫码或 Cookie 登录。

抖音的接口确实会拦爬虫——但它拦的**不是登录态**，而是匿名设备标识 `ttwid`。
实测：

| 请求方式 | 结果 |
|---|---|
| 完全不带 Cookie | HTTP 200，但响应体是 `blocked` |
| 伪造 Cookie | 同上 |
| 纯 Node 请求首页「取」Cookie | 只拿到 `__ac_nonce`，仍被拦 |
| 真实浏览器（无头）访问一次首页 | 自动获得 `ttwid` / `__ac_signature` / `s_v_web_id` |
| **只带 `ttwid` 一个（约 130 字符）** | `status_code=0`，推荐流与视频流（206 + mp4）全部正常 |

`ttwid` 由抖音自己的 JS 反爬挑战生成，纯 HTTP 请求拿不到，必须经过一次真实浏览器。
它是长期设备标识，通常能撑很久。

## 安装

**直接从这里装，不用克隆仓库。** 插件没有任何 npm 依赖（签名库已内联在 `vendor/`），
pnpm 拉下来就能用。

### 桌面版（Desktop / 任意 Electron 发行版）

`dsh` 全局命令只对 `plugin` 子命令放行 desktop profile，而且它的版本可能和应用本体不一致；
**用 Harness 自带的 CLI 最稳**，版本保证对齐：

```powershell
& "<Harness 安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add github:gongstudent/dsh-moyu
```

### Web / CLI 版

装了 `npm i -g @deepseek-ai/dsh` 的话：

```powershell
dsh plugin add github:gongstudent/dsh-moyu
```

### 装完

**完全退出并重启**——CLI 只改 profile 的 `package.json` 与 `node_modules`，不触发 HMR。

想固定版本，在规格后面加 ref：

```
github:gongstudent/dsh-moyu           # 默认分支，跟最新
github:gongstudent/dsh-moyu#main      # 显式指定分支
github:gongstudent/dsh-moyu#v0.1.0    # 指定 tag（发布后才有，见 Releases）
```

### 卸载

```powershell
dsh plugin remove dsh-moyu
```

### 通过插件市场安装

本仓库自带一份符合 **format 1** 规范的市场索引：[market/index.json](market/index.json)。

在 Harness 里打开 **插件** → 点实验性插件旁的「更多」→ 打开「自定义插件市场」→
在索引源里添加：

```
https://raw.githubusercontent.com/gongstudent/dsh-moyu/main/market/index.json
```

之后「发现」标签页里就能看到「抖音摸鱼」并一键安装。

索引钉在具体 commit 上，由 `scripts/update-market-index.mjs` 生成——每次发布前跑一次即可。

> 想改代码才需要 `git clone`，见下面「开发」。

## 首次配置：点一下「自动获取」

插件不发登录态，也不需要你登录抖音账号。它只需要一个**匿名设备标识 `ttwid`**——
抖音靠它区分「真实浏览器」和「爬虫」，跟账号无关。

**推荐路径：面板齿轮 → 设置 → 点「自动获取」。约 3~5 秒。**

- 插件会在本机开一次**隐形**的无头 Chrome / Edge，访问一次 douyin.com，
  把抖音签发的 `ttwid` 取回来存好，然后立刻用它拉流
- 全程使用**临时浏览器配置**，不碰你现有的浏览器数据；结束后进程和临时目录都会清掉
- 前提：本机装有 **Chrome 或 Edge**（绝大多数机器都有）

### 为什么不能「直接生成一个 id」

`ttwid` 是**服务端签名**的。解开看是 `1|<64位base62>|<时间戳>|<13位签名>`，
最后一段是对前面内容的签名。实测本地合成的三种形态**全部**被抖音判成爬虫（返回 `blocked`，7 字节）。

所以「自动生成」只能做成「自动去拿一次」——绕不过那一次真实浏览器。

### 手动方式（自动获取失败时，约 30 秒）

**第 1 步：用浏览器打开 <https://www.douyin.com/>，等页面完全加载。**

不用登录。页面能正常显示视频就说明 `ttwid` 已经下发了。

**第 2 步：打开开发者工具**

| 浏览器 | 快捷键 |
|---|---|
| Chrome / Edge | `F12` 或 `Ctrl + Shift + I` |
| Firefox | `F12` |

**第 3 步：找到 `ttwid`**

- **Chrome / Edge**：`Application`（应用）标签 → 左侧 `Storage` → `Cookies` → 点 `https://www.douyin.com`
- **Firefox**：`Storage`（存储）标签 → `Cookies` → `https://www.douyin.com`

在列表里找名字**恰好是** `ttwid` 的那一行。注意别选成 `ttwid_` 开头或别的相似名字。

**第 4 步：复制 value（不是 name）**

双击 `ttwid` 那一行的 **Value** 列，`Ctrl + C` 复制。这个值很长（一百多字符），
形如 `1%7Cxxxxxxxxxxxxxxxxxxxxxxx%7C...`。

⚠️ **不要对它做 URL 解码**。里面的 `%7C` 就是字面的百分号加 7C，原样复制粘贴即可。
解码后拼出来的 cookie 是错的，握手会失败。

**第 5 步：粘进插件**

面板上点齿轮 → 设置 → 输入框里写成：

```
ttwid=1%7C你刚才复制的值
```

也就是「`ttwid=` + 值」。保存。面板会自动重新拉取推荐流。

### 怎么确认成了

保存后视频能出来就是成了。如果仍提示失败，按顺序排查：

1. 值是不是**完整**的（复制时容易漏尾巴）
2. 有没有多余的**空格或换行**
3. 是不是只粘了值、忘了前面的 `ttwid=`
4. 值有没有被编辑器/输入法**自动换行或改大小写**（`%7C` 是大写 C）

### 什么时候会失效

抖音会定期轮换这个标识，或在你长时间不用后回收。表现为面板提示
「凭据已失效（抖音返回拦截页/空响应）」，浏览器里的抖音也可能要求你做一次人机验证。

**处理方式：回到第 1 步重来一遍。** 页面过掉验证后 `ttwid` 会换成新的，复制新值即可。

### 想要更个性化的推荐（可选，未验证）

上面拿到的是**匿名**推荐流，内容偏「热门」，不跟随你的兴趣。

如果你在浏览器里已经登录抖音，同一位置还能看到一个 `sessionid`。把整份 cookie 一起粘进去
（形式上 `sessionid=...; ttwid=...`），插件会原样带给抖音，理论上会得到更贴合的推荐。

> 说明：带 `sessionid` 的路径本项目**没有实测过**（作者环境不便登录）。仅 `ttwid` 这一条路是验证过的。
> 如果你试了，欢迎开 issue 反馈结果。

### 凭据存在哪、安不安全

存本机 `~/.dsh/storages/dsh-moyu.json`，纯文本。它只被用来拼 `Cookie` 请求头发给抖音，
**不经过任何第三方服务，不上传，不进 git 仓库**（`.gitignore` 已排除 `_session.json`）。

> 介意明文的话：这个文件只含匿名设备标识，不含账号密码。真登录过的 `sessionid` 才是敏感项，
> 所以上面把「更个性化」做成了可选项而不是默认。

## 使用

| 操作 | 效果 |
|---|---|
| 鼠标移入热点 | 展开播放器并开始播放 |
| 鼠标移出 | 收起为圆点，播放暂停在当前帧 |
| 滚轮向下 / 向上 | 下一条 / 上一条 |
| 齿轮按钮 | 切到凭据设置 |
| 准星按钮 | 进入调整模式，拖动虚线框换位置 |
| 底部三个按钮 | 上一条 / 下一条 / 换一批（滚轮的兜底） |
| 原生控制条 | 播放 / 进度 / 音量 / 倍速（全屏键已移除：浮层尺寸固定，全屏会盖住整个界面） |

## 设置

**设置 → 通用 → 抖音摸鱼**：

| 项 | 范围 | 默认 |
|---|---|---|
| 启用 | 开关 | 开 |
| 不透明度 | 15% ~ 100% | 85% |
| 水平位置 | 0 ~ 90% 自由空间 | 16% |
| 垂直位置 | 0 ~ 90% 自由空间 | 80% |
| 调整位置 | 进入拖动模式 | — |
| 关闭浮层 / 重新开启 | 一键切换 | — |

位置用「自由空间的比例」而不是绝对坐标，所以换显示器 / 改窗口大小后不会跑到屏幕外。
设置存在浏览器 `localStorage`（`dsh-moyu/settings`），只影响本机界面。

### 老板键

**鼠标停在浮层上时按空格 = 立即关闭**（等同于把「启用」关掉，会记住，刷新也不会自己回来）。

- 鼠标不在浮层上时，空格保持页面原本的行为，插件完全不介入
- 正在输入框里打字（比如粘贴 `ttwid`）时，空格正常输入，不会误触
- 带修饰键的空格（`Ctrl+空格` 等）放行给宿主

重新打开：设置 → 通用 → 抖音摸鱼 → 勾选「启用」，或点旁边的「重新开启」。

## 架构

宿主半边和浏览器半边各司其职，原因是抖音的接口在浏览器里根本发不出去：

| 障碍 | 后果 |
|---|---|
| `X-Bogus` 签名 | 签名依赖实际发送的 User-Agent，先在浏览器签、再经代理发就作废 |
| `Cookie` / `Referer` 是 forbidden header | 浏览器 JS 无法设置，跨域还有预检 |
| `/aweme/v1/play/` 要带凭据请求后才 302 到 CDN | `<video>` 不带 Cookie，也读不到跨域 302 |

所以：

- **`lib/index.js`（Node）**：签名、带凭据抓推荐流、把视频字节反代回浏览器
- **`lib/client.js`（浏览器）**：注册两个槽位，只做渲染

细节见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 已知限制

- **只做了推荐流**。关注流、喜欢列表、直播、弹幕、评论都还没有。
- **分页靠 `refresh_index` 递增**。实测 1/2/3 分别返回 2/6/6 条且互不重复，翻页有效；
  但单页条数不受 `count` 控制，抖音给多少算多少。
- **视频可能没声音**：Electron 自带的媒体库可能缺 AAC 解码器。这是编辑器层面的问题，
  和插件无关，换 FFmpeg 才能解决。
- **抖音随时可能改接口**。签名参数、字段名一变就得跟。

## 开发

发布与收录渠道（市场索引、GitHub topics、awesome-dsh-plugin、npm）见 [PROMOTION.md](PROMOTION.md)。

要改代码时：

```powershell
git clone https://github.com/gongstudent/dsh-moyu.git
& "<Harness 安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "<克隆下来的目录>"
```

以本地目录安装时，profile 里记的是 `link:`（软链），改完源码立刻生效，不用重装。

```
lib/index.js     宿主半边：签名 / feed / 媒体反代 / 凭据存储
lib/client.js    浏览器半边：两个槽位的 UI 与交互
vendor/          内联的 xbogus 1.0.2（ISC），理由见 vendor/README.md
cordis.patch.yml bundle patch，一行 insert
```

新增平台时按同样的形状加：`/api/<平台>/*` 路由 + 一个 `lib/<平台>.js`，
槽位 id 用 `<平台>` 区分（当前是 `douyin`）。API 路由保留平台名而不是套一层 `/api/moyu/`——
路由描述的是数据源，不是包名。

改 `lib/client.js` 后刷新窗口（`Ctrl+R`）即可生效；改 `lib/index.js` 需要重启 Harness。

语法检查：

```powershell
node --check lib/index.js
node --check lib/client.js
```

## 致谢

- 抖音接口的调用方式、签名流程与播放器实现参考了 [touchFish](https://github.com/ylw1997/touchFish)（作者 ylw1997），项目以 VS Code 扩展形式实现，本项目把它移植成了 DSH 插件。
- `vendor/xbogus` 来自 [iamatef/xbogus](https://github.com/iamatef/xbogus)，ISC 许可。

## License

[MIT](LICENSE)
