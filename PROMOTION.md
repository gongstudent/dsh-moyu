# 发布与收录

一句话背景：**DSH 没有统一的插件提交入口。** 官方定义是「插件市场就是一个 JSON 索引文件」，
所以「发布插件」其实是「让不同的发现渠道都能找到你」。这个文件记录每个渠道的状态和操作方式。

## 渠道总表

| 渠道 | 状态 | 入口 | 需要什么 |
|---|---|---|---|
| GitHub 仓库 | ✅ 已上线 | <https://github.com/gongstudent/dsh-moyu> | — |
| `github:` 规格安装 | ✅ 可用 | `dsh plugin --profile desktop add github:gongstudent/dsh-moyu` | — |
| 自建市场索引 | ✅ 已上线 | `market/index.json` | — |
| GitHub topics | ⬜ 待做 | 仓库 Settings → Topics | 浏览器操作 |
| awesome-dsh-plugin | ⬜ 待提 PR | `data/plugins/*.yml` | GitHub PR |
| dshplugin.market | ⬜ 等采集 | 靠 GitHub topic 自动扫 | 先完成 topics |
| npm | ⬜ 可选 | registry.npmjs.org | 账号 + 强密码 + 2FA |

## 每次发版的顺序

```powershell
# 1. 改版本号
#    package.json  -> version

# 2. 重新钉索引（必须做：市场的 git 来源钉在精确 commit 上）
node scripts/update-market-index.mjs

# 3. 提交并打 tag
git add -A
git commit -m "chore(release): vX.Y.Z"
git tag vX.Y.Z
git push && git push --tags

# 4.（可选）发 npm
npm publish
```

> `scripts/update-market-index.mjs` 负责两件手工必错的事：把 commit 钉成 40 位小写 hex，
> 以及把时间戳写成**秒级**（市场的上限是 1e11，毫秒会直接超限被拒）。

## 渠道一：自建市场索引（✅ 已完成）

`market/index.json` 是一份符合 **format 1** 规范的索引，官方校验器
（`@deepseek-ai/dsh-plugin-market-index` 的 `parseMarketIndex`）验证通过。

用户在 Harness 里打开 **插件** → 实验性插件旁的「更多」→ 打开「自定义插件市场」→ 添加索引地址：

```
https://raw.githubusercontent.com/gongstudent/dsh-moyu/main/market/index.json
```

之后就能在「发现」页看到「抖音摸鱼」，按 commit 钉死的版本一键安装。

**格式要点**（改索引前必读）：

- `format` 必须是 `1`
- `source.type` 只接受 `npm` 或 `git`
- `git` 来源的 `commit` 必须是**完整 40 位小写 hex**，不接受分支名/tag
- `publishTimestamp` 是**秒级** Unix 时间戳
- `title` / `description` 要么是字符串，要么是「语言码 → 文本」的对象，且**必须含 `en`
- `icon` 必须是 https，或与索引同源；也可以是 base64 data URL（解码后 ≤ 32 KiB）
- `metadata.category` / `labels` 必须先在索引顶层 `metadata` 里声明过

## 渠道二：GitHub topics（⬜ 待做，1 分钟）

`dshplugin.market` 的采集器按 GitHub topic 扫仓库，不用提交任何表单。

在仓库主页右侧齿轮 → **Topics**，添加：

```
dsh-plugin  deepseek-harness  dsh  douyin  video  hover-ui
```

## 渠道三：awesome-dsh-plugin（⬜ 待提 PR）

`dshmarket.com`（6000+ 插件）和 npm 上的 `dsh-plugin-catalog` 都以
[`awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 为数据源。

- 收录方式：**在该仓库 `data/plugins/` 下新增一个 YAML 文件，然后提 PR**
- 两个 README 由脚本生成，**不要手改**
- 提 PR 前先读它的 `contributing.md` 拿当前 schema；本文件的作者曾因缺少样例而没有代写条目

## 渠道四：npm（⬜ 可选）

不是必需项——上面三条都不依赖 npm。npm 的额外收益只有：安装命令最短
（`dsh plugin add dsh-moyu`）、可锁版本、pnpm 可缓存。

发布前的要求：

| 项 | 要求 |
|---|---|
| 账号 | 免费注册 |
| 密码 | 最少 10 位 |
| 邮箱 | 必须验证；**会公开出现在包的元数据里** |
| 2FA | 发布强制：TOTP 应用 / 安全密钥 / 带 bypass 的 granular token |
| registry | 必须发到 `registry.npmjs.org`，发到镜像是无效的 |

```powershell
npm config set registry https://registry.npmjs.org/
npm login
npm publish
```

发完之后还有两件事：

1. 把 `market/index.json` 的 `source` 从 `{ "type": "git", ... }` 改成 `{ "type": "npm" }`
   （不再需要钉 commit，版本升级更省事）
2. 把 README 的安装章节顺序调成「npm → 市场 → github:」

## 为什么先自建索引，而不是等着被收录

第三方市场的收录是不确定的：PR 可能被拒、采集器可能不扫、规则可能变。
自建索引是唯一**完全由我们控制**的发布渠道，而且它同时也是未来收录到任何
format-1 市场的现成素材——格式是同一套。
