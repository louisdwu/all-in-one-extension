# 更新记录

## 2.0 — 2026-10-28

工程底座重写 + 三个严重缺陷修复。功能集合不变，配置与存储键保持向后兼容。

### 修复

- **页面主线程死循环**：悬浮球 `textContent` 写入触发自身 MutationObserver，导致任意带
  `<video>` 的页面渲染进程被饿死（DevTools 也无法响应）。UI 迁入 Shadow DOM，观察器改为
  rAF 合并 + 只扫描 video + 文本变更才写。
- **后台 Service Worker 未能启动**：模块相对 import 深度错误，Chrome 只报
  "An unknown error occurred when fetching the script."，所有消息静默失败。
- **每次扩展更新重置用户修饰键**：`onInstalled` 无条件写入 `modifierKey`。
- `chrome.commands` 未捕获 `sendMessage` 失败，chrome:// 页面高频刷错误。
- HUD 轮播间隔设为 2/3/5 秒实际无效（`chrome.alarms` 最小 30 秒）。
- HUD 设置页每次输入都触发全量抓取 + 高频 `storage.sync` 写入（配额风险）。
- 弹窗每次收到设置变更就重复注册监听器（一次点击触发多次修改）。
- `aio_pnd` cookie 在功能关闭时仍被写入所有 cookie store，永久污染 bilibili cookie。
- B站注入脚本全局覆盖 `Object.defineProperty` / `window.setTimeout`，波及无关页面。
- B站 fetch 补丁丢失 `Response.url/type`、修改调用方的 `init` 对象。
- 快捷键录制与运行时匹配使用不同序列化格式（"Ctrl+Shift+Right" vs "Ctrl+Shift+ArrowRight"）。
- 设置页 `.hk-*`（快捷键映射列表）完全没有样式。

### 新增

- `libs/`：core / schema / keys / rules / aqi / md5 / wbi / bili 共享层（可 Node 单测）。
- 单一路由 + handler 注册表（`background/router.js`），旧 `action` 名保留别名。
- `schema.migrate()`：一次性升级旧配置（含快捷键写法、双写字幕开关、清理废弃键）。
- 设置页：深色模式、`#hash` 深链接、键盘导航、诊断面板（版本/权限/存储/配置快照）、
  可开关的调试日志。
- 弹窗改为 ES module，倍速支持步长/上下限/记忆上次速度。
- 内容脚本：UI 全部 Shadow DOM 化（悬浮球、面板、标签切换器、toast）。
- 工具链：`tools/check.mjs`、`tools/smoke.mjs`（Chromium + CDP 真机）、
  `tools/regression.mjs`（10 项行为断言）、`tools/bump-version.mjs`。
- 49 个 `node:test` 用例，含"后台模块图能否启动"的冒烟测试。

### 移除

- 未使用的伪造 `libs/protobuf.min.js`。
- 权限 `scripting` / `notifications` / `activeTab`。
- 不存在的 `shortcuts.html` 跳转与写入 sync 的 `shortcutReference` 文档。
- 硬编码 WAQI Token 与 WBI 资源地址。
