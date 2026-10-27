# 权限说明

本扩展**不采集、不上传**任何个人数据。所有配置保存在本机 `chrome.storage`；
网络请求只发往你自己配置的服务（WAQI、Home Assistant）以及你正在访问的 bilibili 页面内。

## `permissions`

| 权限 | 用在哪 | 为什么必须 |
|------|--------|-----------|
| `tabs` | `background/features/tabs.js`、`hotkeys.js`、`speeder.js` | 读取标签页标题/地址以渲染切换器；向匹配的标签页广播设置；打开/聚焦目标标签页 |
| `storage` | `libs/schema.js`、HUD | 保存配置（sync）与运行态数据（local） |
| `alarms` | `background/features/hud/index.js` | Service Worker 被挂起后重新拉起 HUD 调度（MV3 无长驻后台） |
| `idle` | `background/features/hud/index.js` | 系统唤醒/解锁后立即刷新数据，避免展示过期数值 |
| `cookies` | `background/features/bilibili.js` | ① 读取你自己登录的 SESSDATA 供无痕窗口使用（需你手动点击按钮）② 维护 `aio_pnd` 开关 cookie（仅功能开启时存在） |
| `webNavigation` | `background/features/bilibili.js` | 在进入 bilibili 页面时把开关 cookie 同步到该标签所在的 cookie store（含无痕） |

> 已删除的历史权限：`scripting`、`notifications`、`activeTab`（代码中从未使用）。
> `tests/manifest.test.js` 会持续校验"声明的权限必须被代码使用"。

## `host_permissions`

```json
"host_permissions": ["*://*/*"]
```

原因：内容脚本需要在「任意网站」上提供标签切换、无痕点击与倍速接管；
HUD 需要访问用户**自行填写**的 Home Assistant 地址（局域网地址无法预先枚举）。

如需进一步收敛，可改成"基础权限 + 可选 host 权限"（见
`docs/IMPROVEMENT_PLAN.md` §6.2）：仅在用户填入 HA 地址时申请对应 origin。

## 敏感数据处理

| 数据 | 存放位置 | 备注 |
|------|---------|------|
| B站 SESSDATA / DedeUserID | `chrome.storage.sync`（本机，随账号同步） | 仅在用户点击"从浏览器读取"或手动填写时保存；设置页以密码框显示；诊断信息中打码 |
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
