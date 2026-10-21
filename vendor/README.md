# vendor/

这个目录里的代码不是本项目的，是为「本地路径安装」特意内联进来的第三方实现。

## xbogus

- 来源：源包 `xbogus@1.0.2`（npm），仓库 <https://github.com/iamatef/xbogus>
- 作者：Mohamed Atef
- 许可：ISC
- 内联的文件：`index.js`（140 字节的包装）、`xbogus.js`（50 KB 的本体），一行未改

### 为什么要内联

DSH 插件以本地路径安装时，profile 里记录的依赖是 `link:`，也就是软链，
**不会执行 `pnpm install` 装它自己的 dependencies**。签名库如果声明成普通依赖，
运行时 `require` 会失败。而它本身就是两个零依赖的纯 JS 文件，直接放在仓库里最省事。

### 许可

```
ISC License

Copyright (c) Mohamed Atef

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

## 想换成正常依赖？

删掉 `vendor/`，在 `package.json` 加 `"dependencies": { "xbogus": "1.0.2" }`，
再 `pnpm install` 即可。宿主侧的 `require('../vendor/index.js')` 换成 `require('xbogus')`。
本项目没这么做，只为让「克隆下来直接装」这一步不需要联网装依赖。
