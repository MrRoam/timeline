# ChatGPT 打印版角色标题兼容

修复版本：`4.6.21`。实页调查日期：2026-10-30。

## 故障与根因

已登录的 ChatGPT 项目对话存在 4 次用户提问，但页面没有时间线容器。该页面没有旧版轮次属性，也没有 `data-message-role`，只能从 `main h4.sr-only` 识别消息。

新版角色标题把屏幕标签和打印标签放在同一个标题内：

```html
<h4 class="sr-only" data-conversation-role="user">
  <span>You said:</span>
  <span class="hidden" aria-hidden="true">You</span>
</h4>
```

`textContent` 包含隐藏子节点，结果为 `You said:You`。旧代码只接受完整的 `You said:` 等标签，因此识别到 0 个提问，初始化无法开始。另一条仍使用单段标题的真实对话可以正常显示时间线，且故障页没有命中隐藏时间线的条件。

## 修复

优先读取角色标题的 `data-conversation-role="user|assistant"`，避免依赖界面语言和打印排版。属性缺失或无有效角色时，复制标题并移除 `hidden`、`aria-hidden="true"` 子节点，再沿用已有中英文标签识别。保留宿主标题及其全部子节点。

结构观察器增加 `data-conversation-role` 属性监听，处理标题先挂载、角色稍后到达或发生变化的情况。仍排除输入表单、导航、回答 Markdown、代码和对话框内的标题。

## 验证与更新

- 在同一故障页直接运行实际适配器，修复前识别为 0 个提问，修复后识别为 4 个提问、4 个回答。
- 在 Chrome 扩展管理页将原有扩展从 `4.6.19` 重新加载为 `4.6.21`，随后刷新故障页。刷新后的对话包含 5 次提问，右侧实际显示 5 个节点，节点标签与提问正文一致，没有混入角色标题。
- 单元回归覆盖打印标签、语义角色、其他语言、无角色属性的回退，以及角色属性晚到和变化。
- 浏览器回归增加 `print` 模式，使用真实双标签结构，验证初始化、导航、新问题更新和切换对话。
- `node --test tests/*.test.js`：76 项通过；`node scripts/test-browser.js`：6 种页面结构、84 项检查全部通过；26 个注入及后台 JavaScript 文件语法检查通过。

运行 `node scripts/build-chrome.js` 生成 `AIChatTimeline-v4.6.21-chrome.zip` 并更新 `dist/chrome-unpacked`。在扩展管理页重新加载原扩展，再刷新 ChatGPT 标签页，即可加载新内容脚本并保留原有收藏和设置。

## 源仓库检查

调查时，[源仓库主分支](https://github.com/houyanchao/chatgpt-gemini-timeline)仍为 `cfaa5c6`（版本 `4.7.7`），适配器仍依赖旧轮次属性。[PR #180](https://github.com/houyanchao/chatgpt-gemini-timeline/pull/180) 尚未合并。因此直接更新源仓库主分支不能解决本次故障。
