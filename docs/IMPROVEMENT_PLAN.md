# AIO 改善方案（2026-10）

> 本文是这次重构的**方案与决策记录**：先给出现状诊断（含实测证据），再给出目标架构、
> 分期路线、验收标准，以及明确"这次做了什么 / 没做什么 / 为什么"。
> 所有结论都可以用仓库内的工具复现：`npm run verify`（静态检查 + 单测）与 `npm run smoke`（真机加载）。

---

## 1. 结论先说

这个项目**功能密度高、站点补丁经验足**（B 站、抖音的播放器对抗，WBI 重签，HUD 图标渲染），
但工程底座几乎为零：没有测试、没有 lint、没有类型、没有统一配置层、没有消息路由，
导致"能跑，但不敢改"。所以这次不推翻功能，而是**换骨架、留肌肉**：

| 维度 | 改造前 | 改造后 |
|------|--------|--------|
| 测试 | 0 用例 | 49 个 `node:test` 用例（含后台模块图启动测试） |
| 静态检查 | 无 | `tools/check.mjs`：语法 / import 解析 / DOM id / MAIN 世界越界 / 密钥扫描 |
| 真机验证 | 手工 | `tools/smoke.mjs`：Chromium + CDP 加载扩展，采集 SW 与页面异常 |
| 后台消息监听 | 7 个 `onMessage` 各自猜归属 | 1 个路由 + 显式 handler 注册表 |
| 配置真相源 | 散落 10+ 文件，默认值各不相同 | `libs/schema.js` 单点，含旧数据迁移 |
| 权限 | 9 个（3 个从未使用） | 6 个，全部有代码对应 |
| 页面开销 | 每个页面常驻 200ms 定时器 + body 级 MutationObserver | 默认零开销，锁速/观察按需启动 |
| 版本号 | 手工改 | `npm run bump`（Asia/Shanghai） |

**顺带修掉了 3 个用户可感知的严重缺陷**，其中 1 个足以让整页卡死（见 2.1）。

---

## 2. 现状诊断（有证据）

### 2.1 【致命】悬浮球让页面主线程进入死循环

`content/smart_speeder.js` 的写法是：

```js
new MutationObserver(() => applySpeedToVideos())
    .observe(document.body, { childList: true, subtree: true });
// 而 applySpeedToVideos 内部会：
updateFloatingBall();            // display.textContent = ...
```

`textContent` 赋值会替换文本节点 → 触发同一个 observer → 再次赋值 → 无限微任务循环，
渲染进程被饿死（连 DevTools 都断掉）。

**实测证据**：用 CDP 在无头 Chromium 里加载扩展后访问任意带 `<video>` 的页面，
`Runtime.evaluate('1+1')` 在页面主世界与扩展隔离世界**全部超时**；
把 `updateFloatingBall()` 这一行去掉后立即恢复正常。复现步骤：

```bash
node tools/smoke.mjs        # 改造前：web-page 断言 evaluate 超时
```

> 用户侧表现：某些网站"白屏/卡死/风扇狂转"，关掉扩展就正常。这类 bug 因为
> 只在"悬浮球已创建 + 页面有 video"时触发，很容易被误判成网站问题。

**根治**：UI 全部搬进 Shadow DOM（它的变更不进入宿主页面的 MutationObserver），
观察器只做"扫描 video"，并用 `requestAnimationFrame` 合并；文本只在值变化时写。

### 2.2 后台 Service Worker 其实没起来

`background/features/*` 的相对 import 深度写错（`../libs/core.js` 指向 `background/libs/`），
Chrome 只会打一行 "An unknown error occurred when fetching the script." 然后**整个 SW 不可用**，
所有 `chrome.runtime.sendMessage` 静默失败。

这类错误 `node --check` 查不出来。现在有两道防线：
1. `tools/check.mjs` 校验每个相对 import 能否解析到真实文件；
2. `tests/background.test.js` 用 chrome stub 真跑一遍模块图，缺文件/顶层抛错立刻失败。

### 2.3 配置层重复与漂移

同一份开关存在多个真相：`biliAutoSubtitle` 与 `bilibiliSubtitles.autoEnableSubtitle`；
默认值分散在 `chrome.storage.get({...})`、`result.x !== false`、options 页 `HTML checked` 三处；
`onInstalled` 里 `ezincognito.js` 无条件 `set({ modifierKey: 'ctrlKey' })`，
**每次扩展更新都会重置用户选的修饰键**。

### 2.4 安全与卫生

- `ui/modules/hud/index.js` 里硬编码了一个 WAQI API Token 作为表单默认值（已进 git 历史）。
  Token 本身是公网可用的免费额度，但写进仓库等于把配额交给所有人。
  已删除；**建议去 aqicn.org 重新申请一个**，旧 Token 视为泄露。
- `libs/protobuf.min.js` 是一个 7 行的**假占位文件**（注释写着 "This is an abbreviated placeholder"），
  全仓库无引用 —— 已删除。
- `manifest.json` 声明了 `scripting` / `notifications` / `activeTab`，代码里 0 次使用 —— 已删除。
- `background/smart_speeder.js` 打开 `shortcuts.html`（文件不存在），
  还把生成的 Markdown 写进 `chrome.storage.sync`（占配额、无人读）—— 已删除。

### 2.5 其他确认过的缺陷

| 位置 | 问题 | 处理 |
|------|------|------|
| `content/speeder_inject.js` | 每个页面无条件起 200ms 定时器 | 仅在锁速时启动，无视频 10 秒后自停 |
| `content/hotkey_inject.js` | 即使没有任何映射也重写 `addEventListener` | 无配置时**完全不 patch** |
| `content/hotkey_inject.js` | `once`/`AbortSignal`/`EventListener` 对象漏处理 | 已补齐 |
| `background/hud/index.js` | 轮播用 `chrome.alarms` 最小 30s，但选项提供 2s/3s/5s | 改为定时器驱动 + alarm 保活 |
| `background/hud/index.js` | 任意设置变化都重建 alarm 并立刻全量抓取 | 配置指纹比对 + 抓取串行化 |
| `ui/modules/hud/index.js` | 输入框每次改动都写 sync（配额 120 次/分） | 700ms 合并写入 |
| `ui/popup.js` | 收到 `reloadSettings` 重新 `initSmartSpeeder()` → 监听器叠加 | 单次初始化 |
| `background/bilibili_1080p.js` | 功能关闭时也往所有 cookie store 写 `aio_pnd` | 开启才写，关闭即删 |
| `content/bilibili_1080p_inject.js` | 全局覆盖 `Object.defineProperty` / `window.setTimeout` | 移除（改由 CSS + 响应 hook 实现） |
| `content/bilibili_1080p_inject.js` | fetch 补丁丢失 `Response.url/type`、污染调用方 `init` | 重写为实例 `defineProperty` 克隆 |
| `ui/options.css` | `.hk-*` 面板类完全没有样式 | 补齐组件样式 |
| `ui/options.html` | 300+ 行内样式 + 面板内嵌 `<style>` | 样式表化（仅保留少量布局微调） |
| `content/aio_tabs.js` | 关闭功能后监听器仍常驻 | 关闭即卸载监听 |
| `content/ezincognito.js` | 无痕权限未开时静默失败 | 页面 toast 提示去开启 |

---

## 3. 目标架构

```
libs/                       共享层（无 import/export，挂在 globalThis.AIO，Node 可直接 import）
  core.js     日志 / 存储（含写入合并）/ 消息 / 定时 / DOM / Shadow DOM / 环境
  schema.js   默认值 + 归一化 + 旧数据迁移 + load/save/subscribe
  keys.js     快捷键序列化/解析/匹配（唯一规范）
  rules.js    include/exclude 正则匹配（带缓存与非法正则兜底）
  aqi.js      IAQI → 浓度换算（HJ 633-2012）
  md5.js / wbi.js   B 站请求签名（可单测）
  bili.js     URL 净化 / 视频页判定
background/                  module service worker
  index.js    组装入口（显式顺序）
  router.js   唯一 onMessage 路由 + 定向广播
  features/   tabs / incognito / hotkeys / speeder / bilibili / commands / lifecycle / hud/*
content/
  lib/content.js   内容脚本运行时（缓存配置 + toast + 顶层帧判定）
  aio_tabs.js  ezincognito.js  hotkey_gate.js  hotkey_inject.js
  speeder.js   speeder_inject.js
  bilibili/guard.js  bilibili/ui.js  bilibili/inject.js
ui/            options（hash 路由 / 深色 / 无障碍 / 诊断）+ popup（ES module）
tests/         node:test
tools/         check.mjs / smoke.mjs / bump-version.mjs
```

### 3.1 为什么共享层写成"经典脚本 + globalThis"

MV3 的 content script **不能**用 ES module，而 service worker / 扩展页 / Node 测试都可以。
一份文件要同时满足四者，唯一不需要构建的写法是：**无 import/export，挂到单一命名空间**。

```js
// libs/keys.js
(function (root) {
    const AIO = (root.AIO = root.AIO || {});
    if (AIO.keys) return;            // 幂等：可能被多个 bundle 重复注入
    AIO.keys = { ... };
})(globalThis);
```

后台/扩展页/测试用 `import './libs/keys.js'` 触发副作用后读 `globalThis.AIO.keys`。
代价是隐式全局，收益是**零构建**——这正是本项目"改完刷新即可"的核心体验，不牺牲。

### 3.2 配置契约

- 仍用**扁平旧键名**存 `chrome.storage.sync`：用户已有数据、且 sync 有配额，重命名=丢数据。
- 所有读取走 `schema.load()`，所有写入走 `schema.save(patch)`，归一化在出口统一做。
- `normalize()` 负责：类型收敛、范围钳制、双写兼容键（字幕开关）、非法实体过滤。
- `migrate()` 只做一次性升级（版本号比对），避免每次 SW 唤醒都写存储。

### 3.3 消息契约

```
{ type: 'speeder:getSettings' }              → 设置对象
{ type: 'tabs:activate', tabId: 12 }         → { ok: true }
{ type: 'bili:captureCookies' }              → { ok, sessdata, dedeUserId, incognito }
```

- 单一 `onMessage` 监听，handler 注册表按 type 分发；未注册的类型直接 `return false`。
- handler 可以是 async，异常统一转换为 `{ ok: false, error }`，不再出现
  "The message port closed before a response was received"。
- 旧 `action` 名保留别名（`getTabs`、`saveSpeederSettings`…），避免缓存中的旧页面报错。

---

## 4. 分期路线与完成情况

| 阶段 | 内容 | 状态 |
|------|------|------|
| P0 | 冒烟测试基线（CDP 真机加载）、静态检查、单测框架 | ✅ |
| P1 | 共享层 core/schema/keys/rules/aqi/md5/wbi/bili（含单测） | ✅ |
| P2 | 后台模块化 + 单一路由 + HUD 重写 + 生命周期修 bug | ✅ |
| P3 | 内容脚本重写：冻结修复、按需启动、Shadow UI、hotkey 按需 patch | ✅ |
| P4 | B 站模块拆分（md5/wbi 抽出、fetch/XHR 补丁修正、去掉全局劫持） | ✅ |
| P5 | UI 重写：options 深色/深链接/无障碍/诊断；popup ES module | ✅ |
| P6 | 文档、版本流程、提交 | ✅ |
| P7 | 后续增强（见 §6） | ⏳ |

### 验收口径

```bash
npm run verify   # 静态检查 + 49 个单测
npm run smoke    # Chromium 真机：SW 0 异常、options/popup 0 异常、页面可交互
```

`smoke` 的关键断言（改造后应稳定通过）：

- 后台启动无异常；
- `options.html` 渲染出 9 个分区、3 个快捷键录制项、11 个 WAQI 指标；
- `popup.html` 渲染出 5 张卡片并读到当前倍速；
- 测试页面的 `<video>` 被锁到目标倍速，且**页面 JS 仍可执行**（不再冻结）。

---

## 5. 迁移与兼容

- **存储**：不迁移键名；`schema.migrate()` 只在 `aioSchemaVersion` 落后时执行一次。
- **旧页面**：扩展更新后旧 content script 会被替换；后台仍接受旧 `action` 名。
- **回滚**：所有改动按功能分提交，任意一次提交都可单独 revert；功能没有删减。

---

## 6. 后续可做（按性价比排序）

1. **按站点记住倍速**：目前只记"最后一次速度"（`speederLastSpeed`）；
   可以按 hostname 存一张小表，YouTube 1.75x / B站 1.5x 各记各的。
2. **可选权限**：把 `*://*/*` 拆成"基础权限 + 用户配置 HA 地址时按需申请 host 权限"，
   安装时的权限提示会小很多（需要 `optional_host_permissions` + 引导 UI）。
3. **诊断页可视化**：`tab-about` 已有数据，可加"消息类型列表 / 最近错误环形缓冲"。
4. **i18n**：UI 文案抽到 `_locales`，`manifest.default_locale`。
5. **Web Store 准备**：现在因为"未登录 1080P / 评论区解锁"这类绕过性功能，
   上架风险很高；如果要公开分发，建议拆成两个扩展（通用工具 / B站增强），后者仅自签分发。
6. **CI**：`npm run verify` 已在本地可跑；接 GitHub Actions 只需 `node-version: 22` + 两条命令。
   `smoke` 需要 Chromium，可在 CI 用 `apt-get install chromium` 或 Playwright 镜像。
7. **CSS 作用域**：options 页还可以继续拆成组件级 CSS（当前单文件 600 行仍可维护）。

---

## 7. 明确没做的事

- **没有引入构建步骤**（esbuild/webpack）。共享层用全局命名空间换取"改完即刷新"，
  这是本项目最重要的开发体验，不值得为一个 import 语法牺牲。
- **没有删除 B 站绕过逻辑**。它属于使用者个人的工具选择，但相关的
  "全局劫持 `setTimeout` / `Object.defineProperty`" 这类会波及无关网站的实现已被移除。
- **没有动 `chrome.storage.sync` 的键名**（见 §5）。
