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

## 4. 消息契约

| type | 方向 | 载荷 / 返回 |
|------|------|-------------|
| `tabs:list` | 内容脚本 → 后台 | `{ tabs: TabSummary[] }` |
| `tabs:activate` | 内容脚本 → 后台 | `{ tabId }` → `{ ok }` |
| `incognito:open` | 内容脚本 → 后台 | `{ url }` → `{ ok, url?, error? }` |
| `hotkeys:context` | 弹窗 → 后台 | → `{ hostname, mappings, enabled }` |
| `hotkeys:setMappings` / `deleteMapping` / `clearSite` / `setSiteEnabled` | 弹窗/设置页 → 后台 | → `{ ok, mappings? }` |
| `speeder:getSettings` / `saveSettings` / `getShortcuts` / `setShortcuts` | 页面 → 后台 | 设置对象 |
| `speeder:command` | 后台 → 内容脚本 | `{ action: increase\|decrease\|preset\|reset }` |
| `speeder:getSpeed` | 弹窗 → 内容脚本 | → `{ speed, active }` |
| `bili:getSettings` / `saveSettings` / `captureCookies` | 页面 → 后台 | 设置 / Cookie |
| `hud:refresh` / `hud:updateConfig` / `hud:getState` | 页面 → 后台 | 抓取结果 / 状态 |
| `aio:settingsChanged` | 后台 → 所有标签页 | `{ keys }`（页面自行重读 schema） |
| `aio:toast` | 后台 → 指定标签页 | `{ message, level }` |

返回值约定：成功 `{ ok: true, ... }`，失败 `{ ok: false, error }`；出错由路由统一兜底。

## 5. 存储键

扁平存放于 `chrome.storage.sync`（保留历史键名，避免丢用户数据）：

- 标签页：`aioTabsEnabled`、`aioTabsDelay`、`aioTabsWrap`
- 无痕：`ezEnabled`、`modifierKey`
- 快捷键映射：`hotkeyEnabled`、`hotkeyMappings`、`enabledSites`
- 倍速：`globalEnabled`、`hideFloatingBall`、`includeRules`、`excludeRules`、`defaultSpeed`、`presetSpeed`、`shortcuts`、`speederStep`、`speederMinRate`、`speederMaxRate`、`speederRememberSpeed`
- B站：`biliEnabled`、`biliAutoSubtitle`、`bilibiliSubtitles`、`bilibili1080PEnabled`、`biliCommentsEnabled`、`biliAISubtitleEnabled`、`biliAutoPlay`、`biliPlayNextDisabled`、`biliCookies`
- HUD：`hudEnabled`、`hudIconRound`、`hudCarouselInterval`、`waqi*`、`ha*`
- 元信息：`aioDebug`、`aioSchemaVersion`

运行态在 `chrome.storage.local`：`hudState`、`hudQueueKeys`、`hudCarouselIndex`、`hudLastSuccessWaqi`、`hudLastSuccessHa`、`hudLastWaqiPubV/S`、`hudLastWaqiLag`、`speederLastSpeed`。

## 6. 生命周期

```
浏览器启动 → onStartup → schema.migrate() → HUD schedule()
扩展安装/更新 → onInstalled → migrate() → 只补缺失键 → HUD schedule()
            （绝不覆盖用户已有设置；旧版本会重置 modifierKey，已修）
设置变更 → storage.onChanged → 广播 aio:settingsChanged + HUD 指纹比对
SW 被挂起 → hud:keepalive alarm → 重新调度
```
