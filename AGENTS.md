# AGENTS — All in One Extension (AIO)

> 本文件是本仓库的**唯一开发规则真相源**。DSH (GLM) 与 Google Antigravity CLI 均会自动读取它。任何 AI 助手在此项目工作前**必须先读全文**。

---

## 1. 版本号管理（强制）

每次修改项目中的任何源代码（`.js` / `.css` / `.html` / `.json` / `.md`）后，**必须**同步更新 `manifest.json` 中的 `version` 字段，否则视为未完成。

### 格式

`${major}.${YYYY}.${MMDD}.${HHMM}`（Asia/Shanghai 时区）

- `major`：保持 `1`
- `YYYY`：四位年份
- `MMDD`：两位月 + 两位日（如 `1022`）
- `HHMM`：两位时 + 两位分（如 `1030`）

> 注意：Chrome 把 version 各段当整数解析，会剥离前导零（`1.2026.0612.2031` 显示为 `1.2026.612.2031`），属正常行为，写入时仍按四位零填充。

### 示例

当前时间 2026-10-22 10:30 → 新版本号 `1.2026.1022.1030`。

---

## 2. 开发流程

- **无需构建**：原生 Chrome MV3 扩展，改完代码后在 `chrome://extensions` 点「刷新」即生效。
- **即时验证**：AI 改完代码 + 版本号后，用户即可刷新加载，无需编译。
- **提交前**：`git diff` 自查 → `git add -A` → `git commit` → `git push origin main`。

---

## 3. 架构地图

```
manifest.json              MV3 清单，声明权限/脚本注入/commands
background/                Service Worker（后台逻辑，ISOLATED 世界）
├─ background.js           入口，importScripts 汇聚所有后台模块
├─ aio_tabs.js             标签切换：onMessage getTabs/switchToTab
├─ ezincognito.js          无痕打开：URL 净化 + openIncognito
├─ hotkey_changer.js       快捷键映射：存储 + 标签内通知
├─ smart_speeder.js        倍速：commands 监听 + 设置读写 + 标签广播
├─ bilibili_subtitles.js   字幕设置读写
├─ bilibili_1080p.js       无痕 1080P：cookie 同步到所有 store
└─ hud/                    HUD 监控：alarms 轮询 WAQI/HA，渲染到扩展图标
content/                   Content Scripts（注入网页）
├─ aio_tabs.js            右键+滚轮标签切换 UI（ISOLATED）
├─ ezincognito.js         修饰键+点击 → 无痕打开（ISOLATED）
├─ hotkey_changer.js      按键映射拦截（ISOLATED）
├─ hotkey_inject.js       按键注入（MAIN 世界，all_frames）
├─ smart_speeder.js       倍速主逻辑（ISOLATED，document_end）
├─ speeder_inject.js      速度控制注入（MAIN 世界）
├─ modules/speeder_*.js   浮球/菜单/样式
├─ bilibili_subtitles.js  B站字幕增强
├─ bilibili_1080p.js      免登录 1080P
└─ bilibili_1080p_inject.js  1080P 注入（MAIN 世界）
ui/                        扩展自身页面
├─ options.html / .js / .css   统一设置页（模块化 ES Modules）
├─ popup.html / .js            弹窗
└─ modules/                    各功能设置面板（dashboard/bilibili/...）
libs/                      共享库
├─ config_bridge.js       ★ 存储与消息的统一桥接 API
├─ utils.js               escapeHtml / showStatus / debounce
├── aqi_converter.js      AQI 数值转换
└─ protobuf.min.js        第三方库（-text，不 diff）
docs/                     功能文档与示例配置
```

---

## 4. 消息与存储约定（★ 重点）

### 4.1 ConfigBridge 桥接 API（`libs/config_bridge.js`）

所有 UI/content 与后台通信**必须**走 ConfigBridge，禁止散落裸 `chrome.runtime.sendMessage`（除非回调式场景已加 `lastError` 检查）。

| 方法 | 用途 | 何时用 |
|------|------|--------|
| `ConfigBridge.get(keys)` | 读 sync 存储 | 取配置 |
| `ConfigBridge.set(items)` | 写 sync 存储 | 存配置 |
| `ConfigBridge.sendMessage(msg)` | 发消息**且等响应** | 需要后台返回数据（getSpeederSettings 等）。回调内已检查 `runtime.lastError`，出错时 resolve(null) |
| `ConfigBridge.send(msg)` | 发消息**不等响应** | 纯通知（reloadSettings / UPDATE_CONFIG / UPDATE_HUD_CONFIG）。不传回调，不持有端口 |

### 4.2 runtime.lastError 防御

- **回调式** `chrome.runtime.sendMessage(msg, cb)`：cb 第一行必须 `if (chrome.runtime.lastError) return;`
- **Promise 式**（经 ConfigBridge）：已在 bridge 内处理，调用方拿 null 即可
- **裸调用**：禁止；如必须，参照上述防御

> 历史教训：曾因 `sendMessage` 回调未检查 lastError，导致 `Unchecked runtime.lastError: The message port closed before a response was received` 控制台报错。

### 4.3 后台 onMessage 监听

后台每个 `chrome.runtime.onMessage.addListener` 对收到的消息：
- 需异步响应 → `return true` 并在异步完成时调 `sendResponse`
- 同步响应 → 直接 `sendResponse` 后 `return false`
- **不认识的 action** → 必须 `return false`（或 undefined），不要静默吞掉导致端口悬挂

### 4.4 存储

| 区域 | 用途 | 示例键 |
|------|------|--------|
| `chrome.storage.sync` | 用户配置（跨设备同步） | `aioTabsEnabled`, `hudEnabled`, `hotkeyMappings`, `biliCookies` |
| `chrome.storage.local` | 运行态/缓存 | `hudState`, `hudQueueKeys`, `hudLastSuccessWaqi` |

---

## 5. 世界隔离（Content Scripts）

manifest 中部分脚本声明 `"world": "MAIN"`，直接运行在网页主世界，可操作页面原生对象（如 `HTMLVideoElement.playbackRate`）。
- MAIN 世界脚本**无法**直接调 `chrome.runtime.*`，需经 `window.postMessage` 与 ISOLATED 世界通信。
- ISOLATED 世界脚本可调 Chrome API，但访问不到页面 JS 变量。

改 content 脚本时先确认它属于哪个世界，通信方式不同。

---

## 6. 编码规范

- JS：ES2020+，ES Module（`import/export`），4 空格缩进
- 中文注释与 UI 文案为主，代码标识符用英文
- 防 XSS：渲染用户/存储数据到 HTML 前用 `libs/utils.js` 的 `escapeHtml()`
- 行尾 LF（`.gitattributes` 已强制）

---

## 7. Git 约定

- 主分支 `main`，直接提交推送
- Commit message：`type: 简述`（type ∈ fix/feat/chore/docs/refactor）
- 敏感配置不入库：`docs/ha_integration/real.yaml` 已在 `.gitignore`

---

## 8. 远端与镜像

主线在 **GitHub**（`origin` → `louisdwu/all-in-one-extension`），NAS 上的 Gitea 只做**只读镜像**，每 8 小时自动从 GitHub 拉一次。

- 只往 GitHub 推：`git push origin main`；改完照常 commit + push 就是备份
- **不要**往 Gitea 推：镜像是单向的，两边会分叉
- 本地不推 GitHub，Gitea 那份永远看不到
- 镜像地址：<http://192.168.1.3:3000/louis/all-in-one-extension>
