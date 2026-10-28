# AGENTS — All in One Extension (AIO)

> 本文件是本仓库的**唯一开发规则真相源**。任何 AI 助手在此项目工作前**必须先读全文**。

---

## 1. 版本号管理（强制）

每次修改项目中的任何源代码（`.js` / `.css` / `.html` / `.json` / `.md`）后，**必须**更新
`manifest.json` 的 `version` 字段，否则视为未完成。

**用工具改，不要手改：**

```bash
npm run bump          # 同时更新 manifest.json 与 package.json
```

### 格式

`1.YYYY.MMDD.HHMM`（Asia/Shanghai 时区）

- `major`：当前为 `1`
- Chrome 显示时会剥掉前导零（`1.2026.612.2031`），属正常，写入仍按四位补零。

---

## 2. 开发流程（强制）

```bash
npm run verify      # 静态检查 + 单测，提交前必须全绿
npm run smoke       # 采集 SW/页面运行时异常（本机 Chromium）
npm run regression  # 15 项行为断言（标签切换/倍速开关/快捷键映射/倍速记忆/子帧）
npm run bump        # 版本号
```

- **无需构建**：原生 MV3，改完在 `chrome://extensions` 点刷新。
- **不要引入打包器**：共享代码通过 `globalThis.AIO` 复用（原因见 `docs/ARCHITECTURE.md` §2）。
- 内容脚本改动后，需要刷新目标网页才生效。
- 新增/修改源码文件后，确认 `npm run check` 仍然通过（校验 manifest 引用、import 解析、DOM id、权限使用、密钥）。

---

## 3. 架构地图

```
manifest.json               MV3 清单（background: module worker）
package.json                零依赖脚本：verify / test / check / smoke / bump
libs/                       ★ 共享层（无 import/export，挂 globalThis.AIO，Node 可 import）
├─ core.js                  日志/存储/消息/定时/DOM/Shadow DOM/环境
├─ schema.js                默认值 + 归一化 + 迁移 + load/save/subscribe
├─ keys.js                  快捷键序列化/解析/匹配
├─ rules.js                 include/exclude 正则匹配（缓存 + 兜底）
├─ aqi.js                   IAQI → 浓度（HJ 633-2012）
├─ speed_memory.js          倍速记忆三态（off/global/site）
├─ i18n.js                  data-i18n 注解式翻译（t / apply）
├─ md5.js / wbi.js          B站 WBI 签名
└─ bili.js                  URL 净化 / 视频页判定
background/
├─ index.js                 组装入口（显式顺序）
├─ router.js                唯一 onMessage 路由 + handle() + broadcast()
└─ features/                tabs / incognito / hotkeys / speeder / bilibili /
                            commands / lifecycle / diagnostics / hud/*
content/
├─ lib/content.js           内容脚本运行时（缓存配置 + toast + 顶层帧判定）
├─ aio_tabs.js              右键+滚轮标签切换（Shadow DOM UI）
├─ ezincognito.js           修饰键+点击 → 无痕打开
├─ hotkey_gate.js           ISOLATED：把映射写入 data-aio-hotkeys 属性
├─ hotkey_inject.js         MAIN：按需 patch addEventListener
├─ speeder.js               ISOLATED：倍速控制 + Shadow DOM 悬浮球/面板
├─ speeder_inject.js        MAIN：锁速（prototype + 播放器内核）
└─ bilibili/
   ├─ guard.js              ISOLATED：弹窗屏蔽 + 配置发布 + 无痕标记
   ├─ ui.js                 ISOLATED：字幕自动开启 + 字幕热键
   └─ inject.js             MAIN：未登录 1080P / 评论区 / WBI 重签
ui/                         options（hash 路由/深色/诊断）+ popup（ES module）
ui/styles/                  样式模块：tokens / base / components / panels（options.css 只做 @import）
_locales/                   zh_CN + en（manifest 用 __MSG_*）
tests/                      node:test
tools/                      check.mjs / smoke.mjs / regression.mjs / bump-version.mjs
.github/workflows/          verify.yml（静态检查 + 单测 + 真机冒烟/回归）
docs/                       ARCHITECTURE / PERMISSIONS / IMPROVEMENT_PLAN
```

---

## 4. 共享层约束（★ 容易踩）

`libs/*.js` 同时被 content script（经典脚本）、module service worker、扩展页、Node 单测加载，因此：

1. **禁止 `import` / `export`** —— content script 只能是经典脚本。
2. **禁止顶层访问 `chrome`** —— 否则 Node 单测无法 import；需要时用 `hasChrome()` 包一层。
3. **必须幂等**：`if (AIO.xxx) return;`（同一文件可能进多个 content bundle）。
4. **不要新增全局名**：只挂 `globalThis.AIO.<领域>`。
5. 纯逻辑（可单测的）放 `libs/`，带 DOM/chrome 副作用的放 `content/` 或 `background/`。

---

## 5. 消息与存储约定

### 5.1 消息

- 后台**只有一个** `chrome.runtime.onMessage` 监听（`background/router.js`），
  新功能在 `features/*` 里 `handle('domain:action', handler)`。
- 消息类型用 `域:动作`（`speeder:getSettings`、`bili:captureCookies`）。
- handler 可为 async；成功返回 `{ ok: true, ... }`，失败抛错即可（路由统一转 `{ ok:false, error }`）。
- 页面侧收发一律走 `AIO.core.sendMessage / post / onMessage`（已处理 `lastError` 与超时）。
- 未注册的类型必须 `return false`，不要吞掉消息让端口悬挂。

### 5.2 存储

- **读写只走 `AIO.schema`**：`load()` / `save(patch)` / `subscribe(cb)`。
  不要直接 `chrome.storage.sync.get({someDefault: ...})`——默认值散落正是历史 bug 来源。
- 新增配置项：先加到 `libs/schema.js` 的 `DEFAULTS` + `normalize()`，再改 UI。
- 保留扁平旧键名（用户已有数据 + sync 配额）；需要改名时在 `migrate()` 里做一次性迁移。
- 高频写入用 `AIO.core.storage.createWriter(area, ms)` 合并，避免 sync 写入配额（120 次/分钟）。
- `sync` 放配置，`local` 放运行态（HUD 状态、缓存）。

### 5.3 跨世界通信

用 **DOM 属性**（`data-aio-*`），不要用 `CustomEvent.detail`（跨世界拿不到），
不要注入内联 `<script>`（受页面 CSP 限制）。约定见 `docs/ARCHITECTURE.md` §1。

---

## 6. 世界隔离

- `world: "MAIN"` 的脚本**没有** `chrome.*`（`tools/check.mjs` 会拦截，`libs/core.js` 例外：
  它每处 `chrome` 访问都在 `hasChrome()` 之后）。
- MAIN 世界可以改页面原型，但**禁止**全局劫持平台级 API（`Object.defineProperty`、
  `window.setTimeout`）；`window.fetch` / `XMLHttpRequest` 的补丁必须保持原语义
  （保留 `Response.url/type`、不修改调用方参数）。历史教训见 `docs/IMPROVEMENT_PLAN.md` §2.5。
- ISOLATED 世界可以读 `chrome.storage`，但看不到页面 JS 变量。

---

## 7. 性能红线

- **禁止**在 `MutationObserver` 回调里写会再次触发该观察器的 DOM（`textContent` 也算）——
  这正是"页面卡死"历史 bug 的成因。UI 一律放 Shadow DOM，观察器只做扫描。
- 全站注入的脚本默认**零开销**：功能关闭时不注册监听；定时器按需启动、空闲自停。
- 避免高频全量查询（`querySelectorAll('video')`），用 rAF/防抖合并。

---

## 8. 编码规范

- JS：ES2020+，4 空格缩进；扩展页与后台用 ES module，content script 用 IIFE + `globalThis.AIO`。
- **禁止 `console.log`**：用 `AIO.core.log('tag').debug/info/warn/error`（默认只输出 warn 以上，
  设置页「关于与诊断」可开调试日志）。
- 中文注释与 UI 文案；标识符英文。
- 渲染用户数据到 HTML 前用 `AIO.dom.escapeHtml()` 或 `textContent`。
- 不要静默 `catch {}`：要么记 `debug` 日志，要么在注释说明为何可忽略。
- 行尾 LF（`.gitattributes` 已强制）。

---

## 8.1 新增约定的速查

- **样式**：改 `ui/styles/*.css`，不要改 `ui/options.css`（它只是 `@import` 顺序表）。
  冒烟测试会断言 7 个计算样式 + 规则总数，拆分/调序导致回退会立刻失败。
- **文案**：默认写死中文；需要翻译的元素加 `data-i18n="key"`（或 `-placeholder` / `-title` /
  `-aria-label`），并在 `_locales/zh_CN` 与 `_locales/en` **同时**加 key（`check.mjs` 强制）。
- **倍速记忆**：写入由后台 `speeder:remember` 负责（页面定时器在后台标签会被节流），
  内容脚本只发消息，不要自己写 `speederSpeeds`。
- **诊断**：新功能出问题时用 `AIO.core.log('tag')` 记录，`warn/error` 会自动进日志环，
  设置页「关于与诊断」可直接看到。
- **多帧**：内容脚本 `all_frames` 时会出现在每个 frame。只有顶层帧 `isTopFrame` 才建 UI；
  需要跨帧一致的状态走后台广播（参考 `speeder:applySpeed` / `speeder:tabSpeed`）。

## 9. 测试要求

- 纯逻辑改动：在 `tests/` 加或改用例（`node:test` + `node:assert/strict`）。
- 后台/内容脚本/UI 改动：跑 `npm run smoke`（0 异常）与 `npm run regression`（全绿）。
  新增交互功能时，优先往 `tools/regression.mjs` 加一条行为断言，而不是只靠手工验证。
- 新增 `manifest` 资源/权限：`tests/manifest.test.js` 会自动校验文件存在与权限被使用；
  `tools/check.mjs` 校验 `@import`/样式表/脚本引用、`_locales` 与 `data-i18n` 键完整性。
- CI（`.github/workflows/verify.yml`）会跑同样的命令；本地绿 = CI 绿。
