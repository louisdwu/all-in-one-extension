# All in One Extension (AIO)

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Chrome](https://img.shields.io/badge/browser-Chrome-orange.svg)
![Manifest](https://img.shields.io/badge/manifest-v3-green.svg)

**All in One Extension (AIO)** 是一款功能强大的多合一 Chrome 浏览器增强插件，集成了视频调速、标签快速切换、无痕开启链接以及 Home Assistant 状态监控等多项实用工具，旨在提升您的浏览效率。

---

## 🚀 核心功能特性

### 1. 🎬 Smart Speeder (视频调速器)
为网页中的所有 `<video>` 元素提供精准的速度控制。
- **快捷键控制**：
  - `Ctrl + Shift + →`：提高播放速度
  - `Ctrl + Shift + ←`：降低播放速度
  - `Ctrl + Shift + Space`：在预设倍数（默认 2.0x）与正常速度之间快速切换
- **悬浮菜单**：页面右下角设有半透明浮标，点击可展开完整的控制面板。
- **智能规则**：支持通过正则表达式设置排除或仅包含的域名。

### 2. 📑 Tab Switcher (标签切换器)
模仿系统级的窗口切换体验，无需在顶栏费力寻找标签。
- **操作方式**：**按住鼠标右键**并**滚动滚轮**。
- **核心体验**：在页面中心弹出一个模糊背景的标签列表，当前选中的标签会高亮显示，松开右键即刻跳转。

### 3. 🕶️ EZ Incognito (极速无痕)
一键在无痕窗口（Incognito Mode）中打开特定链接。
- **操作方式**：按住修饰键（默认为 `Ctrl`）并**点击链接**。
- **自定义**：可在设置中根据习惯更换修饰键。

### 4. 🏠 Home Assistant Monitor (HA 监控)
在浏览器工具栏（Action Button）直接查看智能家居状态。
- **实时显示**：将 HA 中指定的实体数值（如电量、温度、功率）渲染到插件图标上。
- **多实体轮控**：支持添加多个实体，插件会自动轮播显示各传感器状态。
- **配置同步**：仅需配置一次 API Token 和 URL。

### 5. 📺 Bilibili Subtitles (B站字幕增强)
针对 Bilibili 视频播放器的深度定制。
- **自动开启**：进入视频播放页自动打开中文字幕（优先官方，次选 AI 生成）。
- **单按键切换**：支持通过快捷键（默认 `s`）一键切换字幕显隐。
- **登录状态支持**：智能处理未登录时的字幕列表挂载。

---

## 🛠️ 安装说明

由于本项目目前处于开发/私有部署阶段，请按照以下步骤手动安装：

1. 下载或克隆本仓库到本地。
2. 打开 Chrome 浏览器，进入 `chrome://extensions/` 页面。
3. 开启页面右上角的 **“开发者模式” (Developer mode)**。
4. 点击左上角的 **“加载已解压的扩展程序” (Load unpacked)**。
5. 选择本项目所在的根目录。

---

## ⚙️ 设置与配置

本项目拥有一个统一的**高级设置页面**，您可以通过以下方式进入：
- 右键点击插件图标 -> “选项”。
- 在插件 Popup 窗口中点击齿轮图标。

**高级功能：**
- **独立配置页**：各模块在设置中心拥有独立的操作面板。
- **统一导出/导入**：支持将所有功能的配置（包括 B站字幕快捷键、HA 实体配置、视频名单等）导出为 JSON 文件，实现全量备份恢复。

---

## 📝 开发与限制

- **Manifest V3**：本项目基于 Chrome Extension Manifest V3 标准开发。
- **隔离性**：UI 元素使用 Shadow DOM 技术，确保不会干扰原网页的样式。
- **权限说明**：
  - `tabs`: 获取标签信息用于切换。
  - `storage`: 跨设备同步设置。
  - `scripting`: 在视频页面注入调速逻辑。
  - `alarms`: 定时更新 Home Assistant 数据。

---

## 🤝 贡献与反馈

如果您在使用过程中遇到任何问题或有新的功能建议，欢迎提交 Issue。

*Designed with ❤️ for Productivity.*
