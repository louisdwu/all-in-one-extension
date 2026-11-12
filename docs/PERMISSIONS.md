# 权限说明

本扩展**不采集、不上传**任何个人数据。所有配置保存在本机 `chrome.storage`；
网络请求只发往你自己配置的服务（WAQI、Home Assistant）以及你正在访问的 bilibili 页面内。

## `permissions`

| 权限 | 用在哪 | 为什么必须 |
|------|--------|-----------|
| `tabs` | `background/features/tabs.js`、`hotkeys.js`、`speeder.js` | 读取标签页标题/地址以渲染切换器；向匹配的标签页广播设置；打开/聚焦目标标签页 |
| `storage` | `libs/schema.js`、HUD | 保存配置（sync）与运行态数据（local） |
| `scripting` | `background/features/bilibili.js` | `bili:verifyCredential` 用 `executeScript` 在已打开的无痕 B站标签页注入 nav 探针 |
| `alarms` | `background/features/hud/index.js` | Service Worker 被挂起后重新拉起 HUD 调度（MV3 无长驻后台） |
| `idle` | `background/features/hud/index.js` | 系统唤醒/解锁后立即刷新数据，避免展示过期数值 |
| `cookies` | `background/features/bilibili.js` | ① 读取**无痕窗口**中登录的专用账号 SESSDATA（需你手动点击按钮；普通窗口的 store `'0'` 一律不读）② 把这份「专用账号」写成无痕会话的 cookie（B站只给登录用户下发 1080P；写的是会话 cookie，无痕窗口关闭即消失）③ 清理旧版本遗留的 `aio_pnd` 标记 cookie（现由设置直接控制，cookie 已无读取方） |
| `webNavigation` | `background/features/bilibili.js` | 进入 bilibili 页面时：给无痕标签写入登录态、把开关 cookie 同步到该标签所在的 cookie store |

> `notifications` / `activeTab` 仍是未使用的历史权限（已删除）。`scripting` 现由
> `bili:verifyCredential` 的无痕标签探针重新使用（`chrome.scripting.executeScript`）。
> `tests/manifest.test.js` 会持续校验"声明的权限必须被代码使用"。

## `host_permissions`

```json
"host_permissions": ["*://*.bilibili.com/*", "https://api.waqi.info/*", "<all_urls>"]
```

> `<all_urls>` 使所有 http(s) 站点访问在声明期即已授予；Home Assistant 不再走按需授权，
> 设置页的「授权此地址」/「立即授权所有网站」按钮与状态栏已删除（实测 `permissions.contains`
> 恒为真、按钮无任何实际作用）。后台仍保留 `permissions.contains` 兜底校验，用于手动收窄权限后的诊断。

| 域名 | 为什么必须在声明期就拿到 |
|------|------------------------|
| `*://*.bilibili.com/*` | `chrome.cookies` 读写 SESSDATA / 注入无痕登录态 / 清理遗留 cookie；`chrome.webNavigation` 事件需要对应 host 权限才会触发 |
| `https://api.waqi.info/*` | 后台直接抓取空气质量数据（跨域 fetch 需要 host 权限） |
| `<all_urls>` | 定时签到（`chrome.tabs.captureVisibleTab`）后台自动截屏；Chromium 截屏 API 严格要求 `<all_urls>` 匹配模式 |

**Home Assistant 无需单独授权**：`host_permissions` 里的 `<all_urls>`（定时签到截屏所必需）
已覆盖所有 http(s) 地址，包括用户自填的内网 HA 地址。设置页不再提供授权按钮；
后台 `fetchHa` 仍校验 URL 合法性，截图调度器的 `hasHostPermission` 保留用于手动收窄权限后的诊断。

内容脚本本身通过 `content_scripts.matches`（`<all_urls>`）获得注入能力，
不依赖 `host_permissions`。因此声明期的「读取和更改所有网站数据」提示仍然存在，
但**扩展主动发起网络请求的范围**已收窄到上表 + 你授权过的 HA 地址。

## 敏感数据处理

| 数据 | 存放位置 | 备注 |
|------|---------|------|
| B站 SESSDATA / DedeUserID | `chrome.storage.sync`（本机，随账号同步） | 仅在用户点击"从无痕窗口读取专用账号"（只读无痕窗口 store，普通窗口一律不读）或手动填写时保存；设置页以密码框显示；诊断信息中打码 |
| HA 长期令牌 / WAQI Token | `chrome.storage.sync` | 设置页以密码框显示；诊断信息中打码 |
| HUD 拉取到的数值 | `chrome.storage.local` | 仅数值，不含原始响应体 |
| 访问过的 URL | **不存储** | 只在内存中用于规则匹配，页面关闭即丢弃 |

## 网络请求清单

| 目标 | 触发时机 | 携带内容 |
|------|---------|---------|
| `https://api.waqi.info/feed/<city>` | HUD 开启且配置了 Token | token、城市名 |
| `<你的 HA 地址>/api/states/<entity>` | HUD 开启且配置了实体 | Bearer token |
| `bilibili.com` 页面内接口 | 你打开 bilibili 视频页时（由页面自身发起，扩展只读/改写响应） | 与页面自身一致 |
| 无 | 其他任何情况 | — |
