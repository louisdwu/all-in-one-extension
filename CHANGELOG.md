# 更新记录

## 2.2 — 2026-10-28

### 修复

- **嵌入播放器完全不受控**：ISOLATED 速器此前没有 `all_frames`，只有顶层帧注入；
  MAIN 注入器虽然进了每个子帧，但收不到任何锁速指令。结果是页面里嵌入的
  YouTube / B 站 iframe 播放器永远按自己的速度播放（顶层调到 2× 也无效）。
  现在速器注入所有帧，并且：顶层改速度会广播给该标签页所有帧、后加载的 iframe
  初始化时主动取当前速度、被规则排除的帧不参与。
- 倍速记忆在"改完速度立刻切换标签页"时可能丢写入（页面定时器被后台节流）——
  持久化已移到后台 `speeder:remember`。

### 测试

- 回归增至 15 项：新增"动态插入的跨站 iframe 能读到标签页速度并锁定"（含 OOPIF 支持：
  回归工具现在会自动 attach 跨进程 iframe 的 CDP 会话）。

### 文档

- 移除分发/打包相关建议（个人自用，不做商店分发），按需注入与 HUD 曲线也标注为"已决定不做"。

## 2.1 — 2026-10-28

第二轮：把方案里列出的增强项全部落地。

### 新增

- **按站点记住倍速**：新增 `libs/speed_memory.js`（三态 `off`/`global`/`site`，纯函数 + 单测）；
  每站点保存一个速度（上限 200 条，LRU 淘汰），写入防抖 800ms；设置页改为下拉选择。
  旧的布尔开关 `speederRememberSpeed` 自动迁移为 `global`/`off`。
- **诊断面板**：后台日志环形缓冲（60 条）+ 按消息类型的调用/失败/平均耗时统计；
  「关于与诊断」新增消息表格、最近告警列表、刷新/清空按钮；复制的诊断信息包含统计。
  另外捕获 service worker 的 `error` / `unhandledrejection`。
- **可选 host 权限**：声明期权限收窄为 bilibili + WAQI，Home Assistant 地址改为
  设置页按需授权（`optional_host_permissions`），未授权时明确提示而不是报"网络错误"。
  后台抓取前用 `chrome.permissions.contains` 预检。
- **i18n**：`_locales/zh_CN` + `_locales/en`，`libs/i18n.js`（`data-i18n` 注解式，
  缺 key 回退内联中文），manifest 名称/描述本地化；弹窗文案已全量双语。
- **CI**：`.github/workflows/verify.yml` 在 push/PR 上跑静态检查 + 单测，
  并用 Chrome for Testing 跑冒烟与行为回归。
- **样式表拆分**：`ui/options.css` 变为 `@import` 顺序表，规则拆到
  `ui/styles/{tokens,base,components,panels}.css`。

### 测试

- 单元测试 59 个（新增 speed_memory 8 个、schema 迁移 1 个）。
- 行为回归 13 项（新增：按站点记忆的"命令→存储→新标签页恢复"链路）。
- 冒烟测试新增 7 项计算样式断言 + 规则总数断言，样式重构导致回退会直接失败。
- `tools/check.mjs` 新增：`@import`/样式表/脚本引用存在性、`_locales` 与 `data-i18n`
  键完整性（防翻译漂移）、manifest 的 `__MSG_*` 可解析。

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
  `tools/regression.mjs`（行为断言）、`tools/bump-version.mjs`。
- 49 个 `node:test` 用例，含"后台模块图能否启动"的冒烟测试。

### 移除

- 未使用的伪造 `libs/protobuf.min.js`。
- 权限 `scripting` / `notifications` / `activeTab`。
- 不存在的 `shortcuts.html` 跳转与写入 sync 的 `shortcutReference` 文档。
- 硬编码 WAQI Token 与 WBI 资源地址。
