# ChatGPT 历史问题识别修复

日期：2026-11-13。版本：`4.6.22`。

## 根因

本地实现仍把当前已挂载的消息正文当作主要识别来源。ChatGPT 回收历史正文后，角色标题和消息属性一起消失，时间线因此只剩视口附近的几次提问。

已复现两处缺陷：

1. **遗漏新版稳定空壳。** `_markTurnRoles()` 只查找同时包含 `data-turn-id-container` 和 `data-is-intersecting` 的旧容器。新版 `data-turn-key` 空壳没有进入识别流程，代码退回 `h4.sr-only`，只能找到仍挂载正文的提问。构造 8 次提问、仅挂载最后 3 次正文的用例，修复前实际生成 3 个刻度。
2. **把分页响应当作完整快照。** `/backend-api/conversations/{id}` 可用 `page_info.has_previous_page` 和 `start_cursor` 表示尚有更早消息。本地没有读取后续历史，并在每次响应时替换整个文本缓存。初次只能读取最近一页；向上滚动触发旧页请求后，又会丢掉先前的新问题文本。

延长扫描等待时间不能让已卸载的正文重新出现。根因是历史边界和渲染边界混在一起。

## 官方参考

检查 [houyanchao/chatgpt-gemini-timeline](https://github.com/houyanchao/chatgpt-gemini-timeline)，固定参考提交为 [`7575212`](https://github.com/houyanchao/chatgpt-gemini-timeline/commit/757521249b252c1262dca9f975224f547cc175cf)。

官方 [适配器](https://github.com/houyanchao/chatgpt-gemini-timeline/blob/757521249b252c1262dca9f975224f547cc175cf/js/timeline/adapters/chatgpt.js) 已识别 `data-chatgpt-search-unit-key` 等新版属性；[接口捕获模块](https://github.com/houyanchao/chatgpt-gemini-timeline/blob/757521249b252c1262dca9f975224f547cc175cf/js/apiCapture/chatgpt.js) 已按游标补齐历史。参考这两个数据来源，在本 Fork 的现有架构内修复。

## 修改

- 识别 `data-turn-id-container` 和 `data-turn-key`，不再要求相交状态属性存在。嵌套容器和重复 ID 只保留外层，刻度继续绑定真实宿主节点。
- 从现有角色属性、新版搜索单元属性或接口中已确认的用户 ID 获取角色，再推导空壳；读取 `data-user-message-bubble` 文本，并保留已读取的历史文本。
- 时间线请求数据后，沿 `start_cursor` 读取更早分页；沿用页面请求的头和凭据，每页请求 100 轮。历史页只合并缺失文本，完整快照仍替换当前分支。
- 新快照中止旧历史读取；过期响应不再写回。重复游标、重复消息、请求失败和会话离开会停止读取，保留已有数据。
- 接口文本变化后重新准备节点，使晚到数据可以补齐空壳角色和摘要。

## 验证与边界

- `node --test tests/*.test.js`：81 项通过。
- `node scripts/test-browser.js`：7 种结构、101 项 Chromium 检查通过。新增场景在 12 次提问中仅挂载最后 3 次正文，初始化仍得到 12 个刻度；挂载后补齐文本，再卸载后仍保留刻度与文本。
- 26 个运行 JavaScript 文件语法检查、`git diff --check` 和 Chrome 打包通过。

当前账号的浏览器连接失败，未完成该账号长对话的实页验收。上面的浏览器检查使用本地夹具加载实际运行代码。

本次支持宿主保留稳定空壳的历史虚拟化。若宿主连空壳都移除，接口文本可以读取，但没有对应 DOM 的消息不会生成可跳转刻度；该情况需要另行实现按需定位，不能用估算坐标冒充实际位置。

## 更新

已生成根目录 `AIChatTimeline-v4.6.22-chrome.zip`，并更新 `dist/chrome-unpacked`。在扩展管理页重新加载原扩展，确认版本为 `4.6.22`，再刷新 ChatGPT 标签页。保持原加载路径可沿用现有收藏和设置。
