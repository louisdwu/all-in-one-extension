# 更新记录

## 2.8 — 2026-11-12

### 第三轮复查：修掉两轮修改留下的问题

- **`speeder:getSettings` 字段名与 schema 不一致**（真问题，虽暂无调用方）：旧实现把
  `speederMinRate / speederMaxRate / speederStep / speederSpeedMemory` 改名成
  `minRate / maxRate / step / speedMemory`，与内容脚本、schema、其他 handler 全部不一致。
  改为直接返回 `schema.load()`，并新增单测锁定该契约（禁止再出现别名）。
- **HUD「立即抓取」在未配置时误报失败**：只配 WAQI 或只配 HA 时，另一侧返回空结果会让
  `ok` 保持 `false`，设置了「抓取失败：请检查 Token / 地址 / 网络」。现在区分
  `unconfigured`（提示"尚未配置监控数据源"）与真实失败。
- **`aio_pnd` cookie 变成纯写入**：页面早已改为直接读 `playNextDisabled` 设置，cookie
  不再有任何读取方却仍在每次导航/状态变更时写入并常驻用户的 bilibili cookie jar。
  删除写入路径，改为启动时一次性清理旧版本遗留的副本。
- `content/bilibili/ui.js` 的 SPA 轮询只在顶层帧启动（子帧不做字幕自动化）。
- `ui/options.html` 去掉 `hud-icon-round` 上无效的 HTML `checked` 预置属性。
- 文档标注 `diag:ping` / `hud:getState` / `speeder:getShortcuts` 等为「当前 UI 未使用、
  保留给排查/外部调用」的已文档化接口，避免再次被当成死代码。

## 2.7 — 2026-11-12

### 审查第二轮：把第一轮放过的一致性问题全部收口

- **删掉整套「按需授权」死 UI/代码**：实测 `permissions.request` 在扩展页手势下虽返回 `true`，
  但 `<all_urls>` 已在声明期授予，按钮不产生任何效果 → 删除 HUD 的授权栏/按钮/`haOriginPattern`
  相关逻辑、截图的授权按钮/状态栏/`requestOriginPermission`，后台 `fetchHa` 改为纯 URL 校验
  （`reason: 'invalid_url'`），文档同步（README / PERMISSIONS / IMPROVEMENT_PLAN）。
- **删除无调用方的消息接口**：`bili:getSettings` / `bili:saveSettings`（后者返回完整设置含
  cookies，是带敏感数据的死接口；cookie 同步本就由 `storage.onChanged` 承担）、
  `getBilibiliSettings` / `saveBilibiliSettings` / `getBilibili1080PSettings` /
  `saveBilibili1080PSettings`、`aio:notifyAll` 及其别名。
- **去掉重复监听**：`content/ezincognito.js` 的 `aio:toast` 监听与 `content/speeder.js` 重复
  （后者在所有页面无条件注册，兜底已覆盖），删除前者。
- **清理只写不读的运行态**：`hudLastWaqiPubV` / `hudLastWaqiLag` 从未被读取却每次刷新增加写入，删除。
- **`libs/core.js` 收敛到真正在用的 API**：移除零使用的 `throttle` / `idle` / `sleep` /
  `dom.el` / `dom.css` / `env`（`isTopFrame` 语义已统一到 `content/lib/content.js`）。
- **`shouldLockPlayNext` 的恒真条件**：`document.cookie.includes('aio_pnd=1') || !!config.playNextDisabled`
  的后半段恒真，简化为直接读开关。

### 验证工具与文档

- `bump-version.mjs`：ICU h24 在午夜可能给出 `hour: "24"`，归一化为 `00`，避免生成非法 HHMM。
- `manifest.test.js`：版本号除格式外校验月/日/时/分范围；补 `popup.html` 重复 id 检查、
  import 解析覆盖 `content/tools/tests` 与 `.mjs`；移除已不存在的 `MAIN_WORLD_SAFE`。
- `check.mjs`：`@import` 同时识别 `url() ` 与裸字符串形式；`MAIN` 世界不再有 core.js 豁免；
  新增「未被引用的 icons 资源」提示（`icon.svg` 这类源文件会以 note 形式出现）。
- `regression.mjs`：world 上下文消失时只在**同一世界**重试，不再静默降级到 MAIN 导致假通过；
  修正 `/frame` 注释；`perf.mjs` 的 socket 关闭静默 catch 补注释。
- 文档：架构地图补 `screenshot_scheduler`、`core.js` 职责清单与 `features/` 列表对齐、
  开发流程补 `npm run perf`、`cookie_guide` 的画质提示描述改到徽标。
- 测试：`screenshotWaitSec` 增加 0/600 钳制断言（85 项）。

## 2.6 — 2026-11-12

### 全项目审查修复（P0 功能损坏）

- **设置页快捷键录制整体失效**：`ui/options.js` 补 `import libs/keys.js`；录制异常路径用 try/finally 清理 document 级监听。
- **B站字幕 SPA 切换检测是死代码**：`rafThrottle(...)` 从未被调用改为 `popstate` + 1s `location.href` 轮询。
- **凭据失效徽标 API 用错**：`chrome.action.getBadgeText()` 返回 `Promise<string>`，两处按 `{text}` 解构恒假；实测修正并同步测试桩。
- **画质降级路径抛 ReferenceError**：删掉已注释掉的 `sendCapHint()` 残留调用与整条 hint 通道死代码（guard/inject/文档/回归）。

### 一致性 / 安全 / 性能

- 诊断「复制」导出明文 SESSDATA / HA / WAQI Token → 复用脱敏快照；签到记录模板补齐 `image`/`id` 的 HTML 转义。
- `screenshot.css` 6 个未定义 CSS 变量统一到 tokens 命名；弹窗运行时中文改为 `AIO.i18n.t()` 并补齐 zh/en 键（38 键对齐），`popupTabsHint` 保留 `<strong>` 结构、补 aria 翻译。
- 删除孤儿 `libs/config_bridge.js`、`.gitattributes` stale 引用、死导出/死参数/死选择器；MAIN 的 B站 bundle 去掉 `libs/core.js`；顶层 bundle 去掉零消费者的 `keys`/`rules`（每页省 ~6.6 KB 解析）。
- 后台删掉 4 类无监听者的广播；`content/bilibili/ui.js` 删掉无发送者的监听；速器手势/快捷键监听改为出现 `<video>` 才注册；B站注入器关闭时不再起轮询；HUD 阈值函数去重；`rules.js` 缓存满改为淘汰最旧而非全清；`isTopFrame` 两处 catch 语义统一。
- 文档与清单对齐：`<all_urls>` 声明期权限（定时签到所必需）与 HA 授权 UI 的关系、权限数 7、回归 24 项、单测 83 项、10 个分区、5 个 MAIN bundle 描述、历史 `scripting` 权限复用的说明。

### 验证工具

- `smoke.mjs` 的 `options.dom`/`popup.dom`/`content.page` 从「只记录」改为真断言（含 SW 未加载失败路径），暗色偏好固定为 light 避免误报，`Log.enable` 失败不再静默。
- `regression.mjs` 修重复 check 名、假通过的降级断言、补错误采集、文件头覆盖 A~H 八组。
- `perf.mjs` CDP 失败不再静默记 0，缺调试端口/指标直接报错；`manifest.test.js` 补 `action.default_icon`、依赖识别、注释剥离误判修复、权限双向校验；`screenshot.test.js` 权限测试去同义反复；`schema.test.js` 修 `aioTabsEnabled` typo；`check.mjs` 补 i18n JS 键/全部 locale 校验。

## 2.5 — 2026-11-05

### 修复

- **定时签到错过时间后自动补签**：电脑睡眠/休眠错过了设定时间时，唤醒后 Chrome 会把
  错过的每日闹钟按原 `scheduledTime` 补触发一次；后台发现触发时刻已超出「随机偏移」
  窗口就**立即签到**（新增纯函数 `planBaseAlarmRun` 判定，4 项单测）。当天闹钟准时触发
  时仍按 0~offsetMin 分钟随机偏移，行为不变；JITTER 闹钟被睡过本就会在唤醒后直接补跑。
  （注：上一版实现的「已过时间」判断比较对象写错，条件恒为假，属死代码，本版修正。）
- 回归修正：画质提示（`sendCapHint`）已在代码中停用（用户提示改由 Cookie 失效徽标承担），
  但回归仍断言 `data-aio-bili-hint` 出现导致红；断言改为「提示保持不出现」，23 项全绿。

## 2.4 — 2026-10-28

### 修复

- **全屏下看不到倍速 toast**：页面全屏的是 `<video>` 元素本身时（浏览器播放器自带的
  全屏按钮、多数原生播放器），视频的子节点是 fallback content，永不被渲染；旧逻辑把
  速器 UI 宿主塞进全屏元素，于是悬浮球和 toast 在全屏里一起「消失」（实测 toast 的
  rect 为 0×0）。现在浮层改用 **top layer**：宿主加 `popover="manual"` 并
  `showPopover()`，每次 `fullscreenchange` 重新 show 一次，DOM 不再搬动。
  全屏是播放器 `<div>` 的站点（B 站 / YouTube）行为不变，原生 `<video>` 全屏也有 toast 了。
- 页面级 toast（`AIO.content.toast`，浮球隐藏或后台 `aio:toast` 时使用）同样走 top layer，
  全屏里也能看见。

### 测试

- 回归增至 16 项：新增「原生 `<video>` 全屏时倍速 toast 仍然可见且尺寸非零」。

## 2.3 — 2026-10-28

### 变更

- **所有有视频的页面、所有帧统一按一套逻辑控制速度**（保留 `all_frames`），但把每帧成本
  压到接近零：只有帧内真的出现 `<video>` 时才 `boot()`（读配置 + 订阅设置变更 +
  建 UI）。没有视频的页面/iframe 只剩一个 MutationObserver，不读存储、不建悬浮球。
- **移除 GitHub Actions CI**（个人自用，不在 GitHub 跑流水线）。校验统一用本地
  `npm run verify:all`：静态检查 + 单测 + 冒烟 + 行为回归。

### 性能

- 每个 iframe 的开销被压到 ~2.3 ms 主线程（JS ~0.85 ms）。实测 20 个同源 iframe
  （都无视频）主线程任务时间：不装扩展 43 ms / 现在 89 ms / 优化前 199 ms。
- 具体做法：
  - `libs/core.js` 不再在加载时读 `storage`（原来每个 iframe 读一次）；
  - `content/lib/content.js` 的 `storage.onChanged` 订阅改为首次使用时才注册；
  - MAIN 世界的两个脚本（快捷键拦截 + 锁速）合并成一个 bundle，并去掉其中未使用的共享层；
  - 速器仍然注入所有帧，但只有真的出现 `<video>` 才 `boot()`。

### 行为变化

- 页面上没有 `<video>` 时不再显示悬浮球（以前每个页面都显示）。视频一出现（含懒加载、
  点击后才创建的播放器）悬浮球立即出现。弹窗里此时显示"此页暂无视频"。

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
