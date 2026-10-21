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

需要已经装好 DeepSeek Harness（桌面版）。

```powershell
# 克隆
git clone https://github.com/gongstudent/dsh-moyu.git D:\个人项目\dsh-moyu

# 装进 desktop profile（必须用 Desktop 自带的 CLI，全局 dsh 会拒绝 desktop profile）
& "<Harness 安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "D:\个人项目\dsh-moyu"
```

装完**完全退出并重启** Harness——CLI 只改 `package.json` 与 `node_modules`，不触发 HMR。

## 首次配置：拿一个 `ttwid`

第一次打开面板会提示没有凭据。拿法很简单，**不用登录**：

1. 浏览器打开 <https://www.douyin.com/>，等页面加载完
2. `F12` → Application → Cookies → `https://www.douyin.com`
3. 复制 `ttwid` 的值
4. 面板齿轮 → 设置 → 粘贴 `ttwid=<值>`

凭据存在本机 `~/.dsh/storages/dsh-moyu.json`，不经过网络、不上传任何地方。

> 哪天又变 `blocked`，重复上面四步即可。

## 使用

| 操作 | 效果 |
|---|---|
| 鼠标移入热点 | 展开播放器并开始播放 |
| 鼠标移出 | 收起为圆点，播放暂停在当前帧 |
| 滚轮向下 / 向上 | 下一条 / 上一条 |
| 齿轮按钮 | 切到凭据设置 |
| 准星按钮 | 进入调整模式，拖动虚线框换位置 |
| 底部三个按钮 | 上一条 / 下一条 / 换一批（滚轮的兜底） |

## 设置

**设置 → 通用 → 抖音摸鱼**：

| 项 | 范围 | 默认 |
|---|---|---|
| 启用 | 开关 | 开 |
| 不透明度 | 15% ~ 100% | 85% |
| 水平位置 | 0 ~ 90% 自由空间 | 16% |
| 垂直位置 | 0 ~ 90% 自由空间 | 80% |
| 调整位置 | 进入拖动模式 | — |

位置用「自由空间的比例」而不是绝对坐标，所以换显示器 / 改窗口大小后不会跑到屏幕外。
设置存在浏览器 `localStorage`（`dsh-moyu/settings`），只影响本机界面。

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
