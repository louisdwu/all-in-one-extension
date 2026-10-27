# All in One Extension (AIO)

多合一 Chrome 增强扩展（Manifest V3，**零构建**：改完代码在 `chrome://extensions` 点刷新即可）。

> 版本号规则：`1.YYYY.MMDD.HHMM`（Asia/Shanghai），由 `npm run bump` 自动写入。

---

## 功能

| 模块 | 说明 |
|------|------|
| 🖱️ 标签页切换 | 按住鼠标右键 + 滚轮呼出标签列表，滚轮切换、松开确认、Esc 取消 |
| 🕵️ 无痕按键 | 修饰键 + 左键点击链接 → 无痕窗口打开，并自动清理 `utm_*`/`spm_id_from` 等跟踪参数 |
| 🎬 视频倍速 | 接管页面 `<video>` 倍速（含对抗站点重置），悬浮球 + 页面内快捷键 + 站点规则 |
| 🎹 快捷键映射 | 按站点把某个按键的行为迁移到另一个键（例如 F → H） |
| 📺 B站增强 | 自动中文字幕、字幕热键、未登录 1080P、评论区加载、AI 字幕解锁、播完暂停 |
| 🖥️ HUD 监控 | 在扩展图标上轮播 WAQI 空气质量与 Home Assistant 实体数值，支持阈值变色 |

## 安装

1. 打开 `chrome://extensions`，开启右上角 **开发者模式**。
2. **加载已解压的扩展程序** → 选择本仓库根目录。
3. （可选）扩展详情里开启 **在无痕模式下启用**，无痕相关功能才可用。

## 开发

```bash
npm run verify   # 静态检查 + 单元测试（零依赖，仅需 Node ≥ 20）
npm run smoke    # 用本机 Chromium 真正加载扩展，采集后台/页面运行时错误
npm run check    # 只跑静态检查
npm test         # 只跑单元测试
npm run bump     # 更新 manifest.json / package.json 版本号
```

- **无构建**：所有文件直接由浏览器加载；共享代码通过 `globalThis.AIO` 命名空间复用。
- **改完即生效**：内容脚本需要刷新目标页面；后台与设置页改动在扩展刷新后生效。
- 详细设计与决策记录见 [`docs/IMPROVEMENT_PLAN.md`](docs/IMPROVEMENT_PLAN.md)，
  目录结构与消息契约见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 权限与隐私

扩展只申请 6 项权限，全部有对应代码，逐条说明见 [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md)。

- 不采集、不上传任何数据；配置只存在本机 `chrome.storage`。
- 网络请求只发生在你自己配置的地址（WAQI、Home Assistant）与你访问的 bilibili 页面内。

## 已知限制

- 只支持 Chromium 系浏览器（Chrome / Edge / Brave）。
- `chrome://`、扩展商店、PDF 阅读器等页面无法注入内容脚本，相关功能不生效。
- HUD 轮播间隔最小 3 秒（后台定时器），数据轮询间隔最小 30 秒（Chromium 对扩展定时器的限制）。
- B站增强属于"未登录态行为修正"，页面结构变化时可能失效；检测到真实登录会自动让位。

## 目录

```
manifest.json
libs/          共享运行时（core/schema/keys/rules/aqi/md5/wbi/bili）
background/    模块化 Service Worker（router + features/*）
content/       内容脚本（含 Shadow DOM UI 与 MAIN 世界注入）
ui/            设置页与弹窗
tests/         node:test 单元测试
tools/         check / smoke / bump-version
docs/          架构、权限、改善方案
```

---

*Designed for Productivity.*
