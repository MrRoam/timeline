# ChatGPT 新 UI 兼容修复

## 调查结论

调查日期：2026-10-03。本地 Fork 原版本为 `4.6.16`，修复后为 `4.6.17`。

原项目是 [houyanchao/chatgpt-gemini-timeline](https://github.com/houyanchao/chatgpt-gemini-timeline)。调查时上游主分支为 `cfaa5c6eb1849cb85778fc98df3ce9690cda80e6`，其 `manifest.json` 为 `4.7.7`，未提供 GitHub Releases。

上游 [Issue #179](https://github.com/houyanchao/chatgpt-gemini-timeline/issues/179) 和 [Issue #176](https://github.com/houyanchao/chatgpt-gemini-timeline/issues/176) 有同类失效反馈。[PR #180](https://github.com/houyanchao/chatgpt-gemini-timeline/pull/180) 包含新 UI 兼容方案，但调查时仍未合并。PR 描述中的“main 已有修复”指贡献者自己的分支；上游主分支代码仍依赖旧消息属性。仅升级到上游当前主分支，不能解决这次识别问题。

本次参考该 PR 的角色标题、接口和几何处理，按本 Fork 的功能范围重新实现；保留已有样式、临时位置 Pin 和收藏逻辑。

## 根因与修改

- 新 UI 的部分页面没有 `data-turn`、`data-turn-id` 或虚拟化轮次属性，改用 `main` 内的 `h4.sr-only` 角色标题。旧选择器找不到用户消息，初始化无法开始。现在旧结构优先，新结构以中英文角色标题识别消息，排除输入表单和回答正文中的同名标题。
- 新接口可能使用 `/backend-api/conversations/{id}` 和 `messages` 列表。现在保留旧 `conversation` / `mapping` 分支回溯，同时兼容新接口、URL / Request 输入及语音转写文本；忽略其他来源、POST 流和子资源。
- 接口响应可能在时间轴销毁与重建之间到达，导致更新事件被错过。空缓存现在允许在后续渲染时重新读取。新 DOM 只在 API 与 DOM 提问全文双向唯一匹配时关联消息 ID，接口晚到后重新生成节点；重复提问不按数组顺序猜 ID。
- 新消息容器可能使用 `display: contents`，自身矩形为零。现在用正文子树的实际矩形计算节点位置、跳转和高亮，排除标题、按钮与浮层。
- 首页尚无消息时原代码未监听路由；初始化重试结束后也可能放弃慢加载页面。现在提前绑定路由监听，保留页面级就绪订阅，并在同 URL 的对话容器替换后重新绑定。
- 原 `dist/chrome-unpacked` 仍包含旧 Fiber 注入版本。Chrome 打包脚本现在更新其中的运行文件，并按当前 manifest 选择 ZIP 内容，避免把旧 dist、测试和规划文件打包进去。

## 验证与边界

执行 `node --test tests/*.test.js`，共 53 项通过，覆盖新旧 DOM、旧虚拟化空壳、接口解析与响应乱序、重复提问、晚到数据、慢加载及切换对话、零尺寸容器跳转和现有 Pin 交互。

这些是合成 DOM 与状态测试。当前 Browser 工具缺少运行组件，未完成已登录 ChatGPT 实页验收，不能把测试通过等同于真实账号全部验证。

新 UI 只为页面中能定位的提问创建节点；若宿主完全卸载历史节点且没有稳定空壳，不凭接口数据伪造跳转坐标。未能唯一关联 ID 的提问会回退到索引，旧 UUID 收藏不能保证自动匹配。角色标题目前覆盖英文与简体、繁体中文。

## 本地更新

执行 `node scripts/build-chrome.js`，生成根目录的 `AIChatTimeline-v4.6.17-chrome.zip`，同时更新 `dist/chrome-unpacked`。

若已加载本项目根目录或 `dist/chrome-unpacked`，在 `chrome://extensions` 点击该扩展的“重新加载”，确认版本为 `4.6.17`，再刷新 ChatGPT 标签页。保留原加载路径可以保留扩展 ID 和原有收藏、设置；不用卸载扩展。只重新加载扩展不会替换已打开网页中的旧内容脚本。

也可以解压新 ZIP 后加载其中的目录。加载新路径可能产生新的扩展 ID，因此不会自动共享旧扩展数据。

实页检查：已有长对话中时间线出现；悬停只显示提问文本；点击节点跳到对应提问；新发消息后节点增加；切换另一条对话与刷新后仍可使用；临时 Pin 与收藏入口可操作。
