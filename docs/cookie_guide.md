# Chrome 插件获取 Cookies 开发指南

在 Chrome 扩展开发中，获取和管理 Cookies 主要有三种方式：使用 `chrome.cookies` API（推荐）、在 Content Script 中访问 `document.cookie`、以及指导用户手动获取。

---

## 1. 使用 `chrome.cookies` API (推荐)

这是最强大且专业的方式，可以访问包括 `HttpOnly` 在内的所有 Cookie。

### 1.1 配置权限

在 `manifest.json` 中，你需要声明 `cookies` 权限以及你想要访问的域名的 `host_permissions`。

```json
{
  "permissions": [
    "cookies"
  ],
  "host_permissions": [
    "*://*.bilibili.com/*",
    "https://*.google.com/"
  ]
}
```

### 1.2 常用方法

这些方法通常在 **Background Service Worker** 或 **Popup/Options 页面** 中使用。

#### 获取单个 Cookie
```javascript
chrome.cookies.get({
    url: "https://www.bilibili.com",
    name: "SESSDATA"
}, (cookie) => {
    if (cookie) {
        console.log("找到 Cookie:", cookie.value);
    } else {
        console.log("未找到指定的 Cookie");
    }
});
```

#### 获取所有 Cookies
```javascript
chrome.cookies.getAll({
    domain: "bilibili.com"
}, (cookies) => {
    console.log(`在 bilibili.com 下共找到 ${cookies.length} 个 Cookies`);
    cookies.forEach(c => console.log(c.name, c.value));
});
```

#### 监听 Cookie 变化
```javascript
chrome.cookies.onChanged.addListener((changeInfo) => {
    console.log("Cookie 发生变化:", changeInfo.cookie.name, changeInfo.removed ? "已移除" : "已更新");
});
```

---

## 2. 在 Content Script 中获取 (有限制)

在 Content Script 中，你可以像普通网页脚本一样访问 `document.cookie`。

### 局限性
*   **无法访问 `HttpOnly` 标记的 Cookie**（大多数敏感的 Session ID 或 Token 都会标记为 HttpOnly）。
*   只能访问当前页面的 Cookie。

### 示例代码
```javascript
// 获取当前页面的所有非 HttpOnly Cookies 字符串
const allCookies = document.cookie; 
console.log(allCookies);

// 简单的解析函数
function getCookieValue(name) {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? match[2] : null;
}
```

---

## 3. 指导用户手动获取 (用于配置页)

如果你的插件需要用户手动输入某些敏感 Cookie（如 B 站的 `SESSDATA`），可以向用户提供以下操作指南：

1.  打开目标网站（如 `bilibili.com`）并登录。
2.  按下 `F12` 或 `Ctrl+Shift+I` 打开开发者工具。
3.  点击顶部的 **Application (应用)** 选项卡。
4.  在左侧菜单中找到 **Storage (存储)** -> **Cookies**，点击展开并选择对应的域名。
5.  在右侧列表中搜索需要的 Cookie 名称（如 `SESSDATA`）。
6.  双击 **Value (值)** 列的内容并复制。

---

## 4. 关键注意事项

1.  **隐私权限**：使用 `cookies` 权限是一个敏感权限，如果提交到 Chrome Web Store，可能需要详细说明用途。
2.  **Domain 匹配**：`chrome.cookies` API 中的 `url` 参数必须与 `manifest.json` 中的 `host_permissions` 匹配，否则会获取失败。
3.  **异步操作**：`chrome.cookies` 的所有方法都是异步的，建议配合 `async/await` 使用（需要包装成 Promise）。

---

> [!TIP]
> 如果你在开发 B 站相关的插件，常见的关键 Cookies 包括：`SESSDATA`, `bili_jct` (CSRF Token), `DedeUserID`。

---

## 5. 本插件特有功能：自动获取

在 **"B站增强"** 设置页面，点击 **"从浏览器读取当前登录账号"** 按钮，插件会自动调用 `chrome.cookies.getAll` 获取当前浏览器中 B 站的登录信息并填充到输入框中。这避免了手动复制的繁琐操作。

### 5.1 为什么无痕窗口需要这份 Cookie

B站现在只给**已登录**客户端下发 1080P：未登录时 `playurl` 即使带 `qn=80`，返回的 `quality` 也只有 64，并且 DASH 里只有 480P/360P；而 `accept_quality` 仍会列出 1080P，所以播放器看起来「有 1080P 选项，选了却更糊」。

因此插件不再靠伪造登录硬顶 1080P，而是：

1. 你在设置页保存一份「专用账号」的 `SESSDATA`（或点按钮从当前浏览器读一份）；
2. 打开无痕窗口里的 B站页面时，后台用 `chrome.cookies.set({ storeId, httpOnly: true })` 把它写进**无痕 cookie store**（不写 `expirationDate`，即会话 cookie，窗口关闭就消失）；
3. 页面因此是「真登录」状态，播放器自己就会给到 1080P（账号有大会员时连 1080P+/4K 也能用）；
4. 如果没存过 `SESSDATA`，页面会提示「未登录最高 480P」，而不是反复请求注定失败的 1080P。

相关设置项：`biliCookies`（`sessdata` / `dedeUserId`）与 `biliIncognitoLogin`（无痕是否沿用）。
