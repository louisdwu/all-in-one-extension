# 架构说明

## 1. 执行世界（Execution Worlds）

Chrome 把扩展代码隔离在多个世界里，**跨世界不能直接共享变量**。本项目用到的三种：

| 世界 | 能力 | 本项目文件 |
|------|------|-----------|
| Service Worker（module） | 全部 `chrome.*`，无 DOM，随时会被挂起 | `background/**` |
| ISOLATED（内容脚本） | 有 DOM 与 `chrome.*`，看不到页面 JS 变量 | `content/*.js`、`content/bilibili/{guard,ui}.js`、`content/lib/content.js` |
| MAIN（内容脚本，`world: MAIN`） | 可改页面原型/实例，**没有** `chrome.*` | `content/hotkey_inject.js`、`content/speeder_inject.js`、`content/bilibili/inject.js` |
| 扩展页 | 完整 `chrome.*` 与 DOM，可用 ES module | `ui/**` |

### 跨世界通信

统一走 **DOM 属性**（两个世界共享同一棵 DOM，不依赖事件时序，也不像 `CustomEvent.detail` 那样受隔离限制）：

| 属性 | 写入方 | 读取方 | 含义 |
|------|--------|--------|------|
| `data-aio-speed-action` / `data-aio-speed-value` | content/speeder.js | speeder_inject.js | lock / unlock 与目标倍速 |
| `data-aio-hotkeys` | content/hotkey_gate.js | hotkey_inject.js | `{ enabled, mappings }` |
| `data-aio-bili-config` | content/bilibili/guard.js | bilibili/inject.js | B站功能开关快照 |
| `data-aio-incognito` | guard.js（同步） | inject.js（同步） | 是否无痕上下文 |

> 为什么不注入 `<script>`：内联脚本受页面 CSP 约束，bilibili 这类站点可能直接拦截。
> 为什么不广播事件：MAIN 与 ISOLATED 同时监听时存在注册时序竞争，属性没有这个问题。

## 2. 共享层 `libs/`

**约束（必须遵守）**：

1. **不写 `import`/`export`** —— content script 只能是经典脚本。
2. **不在顶层访问 `chrome`** —— 这些文件会被 Node 直接 `import` 做单测。
3. 幂等：`if (AIO.xxx) return;`，因为同一个文件可能被多个 content bundle 注入。

| 文件 | 职责 |
|------|------|
| `core.js` | `log` / `storage`（含 `createWriter` 合并写入）/ `sendMessage` / `onMessage` / `debounce` / `throttle` / `rafThrottle` / `dom.shadowHost` / `dom.waitFor` / `env` |
| `schema.js` | `DEFAULTS`、`normalize()`、`migrate()`、`load()`、`save()`、`subscribe()`、`presetList()` |
| `keys.js` | `serialize()` / `parse()` / `matches()` / `matchAction()` / `isValid()` / `display()` |
| `rules.js` | `matches(url, {includeRules, excludeRules})`，正则编译缓存 + 非法正则兜底 |
| `aqi.js` | `toConcentration(iaqi, pollutant)` |
| `speed_memory.js` | 倍速记忆三态（off/global/site）：`clampSpeed` / `normalize` / `resolve` / `remember` |
| `i18n.js` | `t(key, fallback)` / `apply(scope)`（`data-i18n` 注解式增量翻译） |
| `md5.js` / `wbi.js` | B 站 WBI 签名（`encWbi` / `getMixinKey` / `useWebKey`） |
| `bili.js` | `purifyUrl` / `isVideoPage` |

## 3. 后台

```
background/index.js        组装（显式 import 顺序）
  ├─ router.js             唯一 onMessage 监听 + handle() 注册 + broadcast()
  └─ features/
       tabs.js             标签列表 / 激活（跨窗口聚焦）
       incognito.js        净化 URL + 无痕打开 + 权限检测 + 失败提示
       hotkeys.js          站点映射 CRUD（只广播给匹配域名）
       speeder.js          倍速设置（读写走 schema）
       bilibili.js         设置 + aio_pnd cookie 策略 + Cookie 抓取
       commands.js         chrome.commands → 活动标签页
       diagnostics.js      diag:snapshot（消息统计 + 日志环 + 存储占用）
       lifecycle.js        onInstalled 补全缺失键（绝不覆盖用户设置）、迁移、变更广播
       hud/
         index.js          调度器：定时器 + alarm 保活 + 抓取串行化 + 轮播
         waqi.js           WAQI 抓取与指标换算
         ha.js             Home Assistant 实体抓取与阈值
         icon.js           OffscreenCanvas 图标渲染（按 内容+颜色 缓存）
```

### HUD 数据流

```
settings(schema) → 配置指纹比较 → 重启定时器（数据轮询 / 轮播）
        ↓
fetchWaqi / fetchHa → runtime.state 合并 → rebuildQueue → setIcon
        ↓                       ↓
  chrome.storage.local   chrome.action.setIcon（4 个尺寸，命中缓存则跳过）
```

- 抓取用 `inFlight` 串行化，避免设置页保存时并发请求。
- 轮播用 `setInterval`（可到 3 秒）；`chrome.alarms` 最小 30 秒，仅用于 SW 被挂起后重新拉起定时器。
- 状态写入经 `createWriter('local', 400)` 合并，避免高频写。

### 3.0 内容脚本 bundle 与开销

`manifest.json` 现在是 5 个 bundle，按"注入范围"分层，避免把重的东西放进每个帧：

| # | 范围 | 内容 | 说明 |
|---|------|------|------|
| 1 | 顶层帧 | core/keys/rules/schema + 内容运行时 + 标签切换 + 无痕 + 快捷键桥 | 只在顶层，功能都是页面级 |
| 2 | **所有帧（MAIN）** | `hotkey_inject.js` + `speeder_inject.js`（合并，无共享层） | 轻量：只改原型/监听，不读存储 |
| 3 | **所有帧（ISOLATED）** | 共享层 + 内容运行时 + 速器 | 懒启动：出现 `<video>` 才读配置 |
| 4 | bilibili 视频页 | 共享层 + 守卫/字幕 | 页面级 |
| 5 | bilibili 视频页（MAIN） | 共享层 + md5/wbi + 注入器 | 页面级 |

两条硬约束：
- **MAIN 世界 bundle 不要引共享层**（`libs/core.js` 在 MAIN 里用不到，白付解析成本）；
- **所有帧的脚本必须懒启动**：加载时零存储访问、零监听，出现视频再 `boot()`。

### 3.1 子帧（iframe）与倍速

速器的 ISOLATED 包和 MAIN 注入器都声明了 `all_frames: true`，所以**每个帧**都会接管
自己内部的 `<video>`（嵌入的 YouTube / B 站播放器在各自 frame 里）。但 UI 只在顶层帧
（`isTopFrame` 判定，子帧不建悬浮球、不弹提示）：

- 顶层帧改速度 → `speeder:remember` → 后台广播 `speeder:applySpeed` 给该标签页所有帧；
- **后加载**的 iframe（点击展开、懒加载）主动问 `speeder:tabSpeed`，拿到当前值再锁定；
- 被 include/exclude 规则排除的帧不参与；
- 记忆按**帧自己的 hostname** 存，所以同站点嵌套与跨站点嵌套都符合直觉。

### 3.2 全屏与顶层浮层

全屏元素渲染在浏览器的 **top layer** 里：留在 `<body>` 里的东西会被它盖住；而
被全屏的 `<video>` 本身的子节点是 fallback content，**永远不渲染**。所以
「把 UI 宿主塞进全屏元素里」这个老做法在 B 站/YouTube（全屏的是播放器 `<div>`）能用，
在原生 `<video>` 全屏（浏览器播放器自带的全屏按钮）上会让悬浮球和 toast 一起消失。

现在的做法（`AIO.core.dom.topLayer(host)`）：

- 宿主加 `popover="manual"` 并 `showPopover()`，进入同一个 top layer，**不搬 DOM**；
- 每次 `fullscreenchange` 先 `hidePopover()` 再 `showPopover()`，让浮层重新成为
  top layer 里最新的一层（否则新进入全屏的元素会盖在它上面）；
- 宿主被 CSS 重置成零尺寸、`pointer-events: none` 的锚点，交互元素自己开
  `pointer-events: auto`，页面点击照常穿透；
- 没有 Popover API 的浏览器保持原行为（塞进非 `<video>` 的全屏元素）。

toast（`content/lib/content.js`）和速器 UI（`content/speeder.js`）都走这条路径。

## 4. 消息契约

| type | 方向 | 载荷 / 返回 |
|------|------|-------------|
| `tabs:list` | 内容脚本 → 后台 | `{ tabs: TabSummary[] }` |
| `tabs:activate` | 内容脚本 → 后台 | `{ tabId }` → `{ ok }` |
| `incognito:open` | 内容脚本 → 后台 | `{ url }` → `{ ok, url?, error? }` |
| `hotkeys:context` | 弹窗 → 后台 | → `{ hostname, mappings, enabled }` |
| `hotkeys:setMappings` / `deleteMapping` / `clearSite` / `setSiteEnabled` | 弹窗/设置页 → 后台 | → `{ ok, mappings? }` |
| `speeder:getSettings` / `saveSettings` / `getShortcuts` / `setShortcuts` | 页面 → 后台 | 设置对象 |
| `speeder:command` | 后台 → 内容脚本（所有帧） | `{ action: increase\|decrease\|preset\|reset }` |
| `speeder:getSpeed` | 弹窗 → 内容脚本 | → `{ speed, active }` |
| `speeder:remember` | 内容脚本 → 后台 | `{ speed, mode, hostname }` → 写记忆（mode=off 时跳过）并广播 `speeder:applySpeed` 给该标签页**所有帧** |
| `speeder:applySpeed` | 后台 → 全部帧 | `{ speed }`：子帧跟随顶层帧 |
| `speeder:tabSpeed` | 子帧 → 后台 | → `{ speed }` 或 `null`：后加载的 iframe 初始化时取当前值 |
| `bili:getSettings` / `saveSettings` / `captureCookies` | 页面 → 后台 | 设置 / Cookie |
| `hud:refresh` / `hud:updateConfig` / `hud:getState` | 页面 → 后台 | 抓取结果 / 状态（`reason: 'needs_permission'` 表示 HA 地址未授权） |
| `diag:snapshot` / `diag:clearLog` / `diag:ping` | 设置页 → 后台 | 消息统计、日志环、存储占用、健康检查 |
| `aio:settingsChanged` | 后台 → 所有标签页 | `{ keys }`（页面自行重读 schema） |
| `aio:toast` | 后台 → 指定标签页 | `{ message, level }` |

返回值约定：成功 `{ ok: true, ... }`，失败 `{ ok: false, error }`；出错由路由统一兜底。

## 5. 存储键

扁平存放于 `chrome.storage.sync`（保留历史键名，避免丢用户数据）：

- 标签页：`aioTabsEnabled`、`aioTabsDelay`、`aioTabsWrap`
- 无痕：`ezEnabled`、`modifierKey`
- 快捷键映射：`hotkeyEnabled`、`hotkeyMappings`、`enabledSites`
- 倍速：`globalEnabled`、`hideFloatingBall`、`includeRules`、`excludeRules`、`defaultSpeed`、`presetSpeed`、`shortcuts`、`speederStep`、`speederMinRate`、`speederMaxRate`、`speederSpeedMemory`（`off|global|site`，旧布尔 `speederRememberSpeed` 自动迁移）
- B站：`biliEnabled`、`biliAutoSubtitle`、`bilibiliSubtitles`、`bilibili1080PEnabled`、`biliCommentsEnabled`、`biliAISubtitleEnabled`、`biliAutoPlay`、`biliPlayNextDisabled`、`biliCookies`
- HUD：`hudEnabled`、`hudIconRound`、`hudCarouselInterval`、`waqi*`、`ha*`
- 元信息：`aioDebug`、`aioSchemaVersion`

运行态在 `chrome.storage.local`：`hudState`、`hudQueueKeys`、`hudCarouselIndex`、`hudLastSuccessWaqi`、`hudLastSuccessHa`、`hudLastWaqiPubV/S`、`hudLastWaqiLag`、`speederLastSpeed`（全局模式）、`speederSpeeds`（按站点模式，最多 200 条）。

## 5.1 样式表结构

`ui/options.css` 只是入口，用 `@import` 按**固定顺序**串联：

```
ui/options.css          @import 顺序表
  styles/tokens.css     设计令牌 + 深色模式（无布局规则）
  styles/base.css       页面骨架：重置、body、侧边栏、内容列、排版、卡片、响应式
  styles/components.css 控件：表单、按钮、开关、toast、列表、诊断表格
  styles/panels.css     面板专用：仪表盘网格、HUD、关于页
```

顺序即级联顺序。`tools/smoke.mjs` 会断言若干 **计算样式**（body 背景、侧边栏宽度、
卡片圆角、开关尺寸、按钮主色、规则总数），所以拆分文件或调整顺序导致的样式回退会直接让
冒烟测试失败 —— 不需要肉眼比对。

## 5.2 国际化（增量式）

- `manifest.default_locale = zh_CN`，`name`/`description` 使用 `__MSG_extName__` / `__MSG_extDescription__`。
- UI 文案默认写死中文，需要翻译的元素加 `data-i18n="key"`（或 `data-i18n-placeholder` /
  `data-i18n-title` / `data-i18n-aria-label`），启动时 `AIO.i18n.apply()` 只在目标语言
  定义了该 key 时替换。这样"翻译一个字符串"= 往 `_locales/<lang>/messages.json` 加一条 +
  给元素加属性，**不需要动逻辑**。
- `tools/check.mjs` 强制：每个 `data-i18n` key 必须在**所有** locale 中存在（防漂移），
  并且 manifest 里的每个 `__MSG_*` 都在默认语言里有定义。
- 当前状态：manifest 与弹窗文案已双语；设置页文案保留内联中文（结构复杂、收益低，
  需要翻译时按同样方式逐步加 key 即可）。

## 6. 生命周期

```
浏览器启动 → onStartup → schema.migrate() → HUD schedule()
扩展安装/更新 → onInstalled → migrate() → 只补缺失键 → HUD schedule()
            （绝不覆盖用户已有设置；旧版本会重置 modifierKey，已修）
设置变更 → storage.onChanged → 广播 aio:settingsChanged + HUD 指纹比对
SW 被挂起 → hud:keepalive alarm → 重新调度
```
