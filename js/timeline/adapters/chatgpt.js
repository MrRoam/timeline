/**
 * ChatGPT Adapter
 * 
 * Supports: 
 *   - chatgpt.com/c/xxx (普通对话)
 *   - chatgpt.com/g/xxx/c/xxx (GPT 对话)
 *   - chatgpt.com/share/xxx 或 chatgpt.com/share/e/xxx (分享页面)
 *   - chat.openai.com (旧域名)
 */

class ChatGPTAdapter extends SiteAdapter {
    constructor() {
        super();
        // ChatGPT 会把视口外轮次虚拟化为空壳；文本只保留在当前对话的内存缓存中。
        this._turnTextCache = new Map();
        this._capturedMatchTexts = new Map();
        this._capturedTextIds = new Set();
        this._textCacheConvId = null;
        this._turnRolesDirty = true;
        this._usesVirtualizedTurnSelector = false;
        this._usesHeadingTurnSelector = false;
    }

    static TEXT_CACHE_MAX_TEXT_LENGTH = 200;
    static TEXT_CACHE_MAX_ENTRIES = 3000;

    _pullConvTexts(conversationId) {
        if (!conversationId) return 0;

        let received = null;
        const handler = (event) => {
            if (typeof event.detail !== 'string') return;
            try {
                const payload = JSON.parse(event.detail);
                if (payload?.conversationId === conversationId) received = payload;
            } catch {
                received = null;
            }
        };
        try {
            document.addEventListener('ait-gpt-user-texts-result', handler);
            document.dispatchEvent(new CustomEvent('ait-gpt-user-texts-pull', {
                detail: conversationId
            }));
        } catch {
            return 0;
        } finally {
            document.removeEventListener('ait-gpt-user-texts-result', handler);
        }

        const texts = received?.texts;
        if (!texts || typeof texts !== 'object' || Array.isArray(texts)) return 0;

        this._capturedMatchTexts = new Map(
            Object.entries(texts).filter(([, text]) => typeof text === 'string')
        );
        const nextCapturedTextIds = new Set(this._capturedMatchTexts.keys());
        let changedCount = 0;
        this._capturedTextIds.forEach(id => {
            if (!nextCapturedTextIds.has(id) && this._turnTextCache.delete(id)) {
                changedCount++;
            }
        });
        this._capturedMatchTexts.forEach((text, id) => {
            const previous = this._turnTextCache.get(id);
            this._cacheTurnText(id, text);
            if (this._turnTextCache.get(id) !== previous) changedCount++;
        });
        this._capturedTextIds = nextCapturedTextIds;
        return changedCount;
    }

    syncCapturedChatsData() {
        const conversationId = this.extractConversationId(location.pathname);
        if (conversationId !== this._textCacheConvId) {
            this._textCacheConvId = conversationId;
            this._turnTextCache.clear();
            this._capturedTextIds.clear();
            this._capturedMatchTexts.clear();
        } else if (this._capturedTextIds.size > 0) {
            return;
        }
        // 接口可能在实例销毁与重建之间返回；空缓存允许在下一次渲染时重试。
        this._pullConvTexts(conversationId);
    }

    handleCapturedChatsDataUpdated(conversationId) {
        const currentConversationId = this.extractConversationId(location.pathname);
        if (!conversationId || conversationId !== currentConversationId) return 0;

        if (this._textCacheConvId !== conversationId) {
            this._textCacheConvId = conversationId;
            this._turnTextCache.clear();
            this._capturedTextIds.clear();
            this._capturedMatchTexts.clear();
        }
        return this._pullConvTexts(conversationId);
    }

    subscribeCapturedChatsDataUpdated(callback) {
        if (typeof callback !== 'function') return () => {};

        const handler = (event) => {
            const conversationId = typeof event.detail === 'string' ? event.detail : '';
            const changedCount = this.handleCapturedChatsDataUpdated(conversationId);
            if (changedCount > 0) callback({
                conversationId,
                changedCount,
                rebuildMarkers: this._usesHeadingTurnSelector
            });
        };
        document.addEventListener('ait-gpt-user-texts-updated', handler);
        return () => document.removeEventListener('ait-gpt-user-texts-updated', handler);
    }

    isPlaceholderSummary(text) {
        const normalized = String(text || '').trim();
        return super.isPlaceholderSummary(normalized) || normalized === '[未加载的提问]';
    }

    /**
     * 新版 ChatGPT 为每轮保留空壳容器，但只渲染视口附近的内容。
     * 从最后一个真实轮次向前按 user/assistant 交替关系推导空壳角色。
     */
    _markTurnRoles() {
        const all = document.querySelectorAll('[data-turn-id-container][data-is-intersecting]');
        if (!all.length) return false;

        const seen = new Set();
        const containers = [];
        all.forEach(element => {
            const id = element.getAttribute('data-turn-id-container');
            if (!id || seen.has(id)) return;
            seen.add(id);
            containers.push(element);
        });

        const roles = new Array(containers.length).fill(null);
        let nextRole = null;
        for (let index = containers.length - 1; index >= 0; index--) {
            const realRole = containers[index].querySelector('[data-turn]')?.getAttribute('data-turn');
            const knownRole = containers[index].getAttribute('data-ait-turn');
            let role = realRole === 'user' || realRole === 'assistant' ? realRole
                : knownRole === 'user' || knownRole === 'assistant' ? knownRole : null;
            if (!role && nextRole) {
                role = nextRole === 'user' ? 'assistant' : 'user';
            }
            roles[index] = role;
            if (role) nextRole = role;
        }

        // 发送时末尾空壳可能先于正文出现；从已知轮次向后补齐，不能只倒序推导。
        for (let index = 1; index < roles.length; index++) {
            if (!roles[index] && roles[index - 1]) {
                roles[index] = roles[index - 1] === 'user' ? 'assistant' : 'user';
            }
        }

        // ChatGPT 可能在开头保留隐藏占位轮；不能把推断出的 assistant 当作首个提问。
        if (roles[0] === 'assistant') roles[0] = null;

        containers.forEach((element, index) => {
            const role = roles[index];
            if (role === 'user') {
                const id = element.getAttribute('data-turn-id-container');
                if (id && !this._turnTextCache.has(id)) {
                    const rawText = element.querySelector('.whitespace-pre-wrap')?.textContent;
                    const text = (rawText || '').replace(/\s+/g, ' ').trim();
                    if (text) this._cacheTurnText(id, text);
                }
            }

            if (role) {
                if (element.getAttribute('data-ait-turn') !== role) {
                    element.setAttribute('data-ait-turn', role);
                }
            } else if (element.hasAttribute('data-ait-turn')) {
                element.removeAttribute('data-ait-turn');
            }
        });
        return true;
    }

    prepareTimelineNodes(context = {}) {
        if (!context.force && !this._turnRolesDirty) return false;

        const hasVirtualizedTurns = this._markTurnRoles();
        this._usesVirtualizedTurnSelector = hasVirtualizedTurns
            && document.querySelector('[data-turn-id-container][data-ait-turn="user"]') !== null;
        this._usesHeadingTurnSelector = !this._usesVirtualizedTurnSelector
            && !document.querySelector('[data-turn="user"][data-turn-id]')
            && this._markHeadingTurns();
        this._turnRolesDirty = false;
        return true;
    }

    /** 2026-09 新 UI 以无障碍角色标题分隔消息，旧结构仍优先。 */
    _markHeadingTurns() {
        const main = document.querySelector('main');
        if (!main) return false;
        const candidates = new Map();
        const roles = new Map();
        for (const heading of main.querySelectorAll('h4.sr-only')) {
            const label = (heading.textContent || '').replace(/\s+/g, ' ').trim()
                .replace(/[:：]$/, '').trim().toLowerCase();
            const role = ['you said', 'you', '你说', '你說'].includes(label) ? 'user'
                : ['chatgpt said', 'chatgpt', 'assistant', 'chatgpt 说', 'chatgpt 說'].includes(label)
                    ? 'assistant' : null;
            if (!role || heading.closest('form, nav, aside, pre, code, .markdown, [role="dialog"]')) continue;
            roles.set(heading, role);
        }
        for (const [heading, role] of roles) {
            let container = heading.parentElement;
            while (container && container !== main && !container.matches('form, nav, aside')) {
                if (Array.from(container.querySelectorAll('h4.sr-only')).filter(node => roles.has(node)).length !== 1) break;
                if (Array.from(container.children).some(child => child !== heading && !child.contains(heading))) {
                    candidates.set(container, role);
                    break;
                }
                container = container.parentElement;
            }
        }
        document.querySelectorAll('[data-ait-heading-turn]').forEach(element => {
            if (!candidates.has(element)) element.removeAttribute('data-ait-heading-turn');
        });
        candidates.forEach((role, element) => {
            if (element.getAttribute('data-ait-heading-turn') !== role) {
                element.setAttribute('data-ait-heading-turn', role);
            }
        });
        return Array.from(candidates.values()).includes('user');
    }

    _extractHeadingText(element) {
        const content = element.querySelector('.whitespace-pre-wrap');
        if (content) return (content.textContent || '').replace(/\s+/g, ' ').trim();
        const copy = element.cloneNode(true);
        copy.querySelectorAll('h4.sr-only, .sr-only, button, nav, script, style, [hidden], [aria-hidden="true"], [data-ait-time], .ait-time-label')
            .forEach(node => node.remove());
        return (copy.textContent || '').replace(/\s+/g, ' ').trim();
    }

    _matchHeadingNodeId(element) {
        const text = this._extractHeadingText(element);
        if (!text) return null;
        const matches = Array.from(this._capturedMatchTexts).filter(([, value]) =>
            value.replace(/\s+/g, ' ').trim() === text
        );
        if (matches.length !== 1) return null;
        const peers = Array.from(document.querySelectorAll('[data-ait-heading-turn="user"]'));
        // API 与 DOM 的全文均唯一时才关联 ID，避免重复提问跳到错误位置。
        if (peers.filter(peer => this._extractHeadingText(peer) === text).length !== 1) return null;
        return matches[0][0];
    }

    getTimelineMessageRect(element) {
        if (!element?.hasAttribute('data-ait-heading-turn')) return null;
        try {
            const own = element.getBoundingClientRect();
            if (own.width > 0 && own.height > 0) return own;
            const boxes = [];
            const visit = node => {
                if (node.matches('h4.sr-only, .sr-only, button, nav, script, style, [hidden], [aria-hidden="true"], [data-ait-time], .ait-time-label')) return;
                const style = window.getComputedStyle(node);
                if (style.display === 'none' || style.visibility === 'hidden'
                    || style.position === 'fixed' || style.position === 'absolute') return;
                const rect = node.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    boxes.push(rect);
                    return;
                }
                Array.from(node.children).forEach(visit);
                Array.from(node.childNodes).forEach(child => {
                    if (child.nodeType !== 3 || !child.textContent.trim()) return;
                    const range = document.createRange();
                    range.selectNodeContents(child);
                    Array.from(range.getClientRects()).forEach(box => {
                        if (box.width > 0 && box.height > 0) boxes.push(box);
                    });
                });
            };
            visit(element);
            if (!boxes.length) return own;
            const top = Math.min(...boxes.map(rect => rect.top));
            const bottom = Math.max(...boxes.map(rect => rect.bottom));
            const left = Math.min(...boxes.map(rect => rect.left));
            const right = Math.max(...boxes.map(rect => rect.right));
            return { x: left, y: top, top, bottom, left, right, width: right - left, height: bottom - top };
        } catch {
            return null;
        }
    }

    invalidateTimelineNodes() {
        this._turnRolesDirty = true;
    }

    getTimelineStructureSelectors() {
        return ['[data-turn-id-container]', '[data-turn]', 'h4.sr-only'];
    }

    getTimelineStructureObserverOptions() {
        return { characterData: true };
    }

    getTimelineStructureObserverRoot(container) {
        const main = document.querySelector('main');
        return main?.contains(container) ? main : container;
    }

    getTimelineStructureAttributeFilter() {
        return ['data-turn-id-container', 'data-turn-id', 'data-is-intersecting', 'data-turn', 'class'];
    }

    async matches(url) {
        return matchesPlatform(url, 'chatgpt');
    }

    getUserMessageSelector() {
        if (this._usesHeadingTurnSelector) return '[data-ait-heading-turn="user"]';
        if (this._usesVirtualizedTurnSelector) {
            return '[data-turn-id-container][data-ait-turn="user"]';
        }
        return '[data-turn="user"][data-turn-id]';
    }

    getAssistantMessageSelector() {
        if (this._usesHeadingTurnSelector) return '[data-ait-heading-turn="assistant"]';
        if (document.querySelector('[data-turn-id-container][data-ait-turn="assistant"]')) {
            return '[data-turn-id-container][data-ait-turn="assistant"]';
        }
        return '[data-turn="assistant"][data-turn-id]';
    }

    /**
     * 从 DOM 元素中提取 nodeId
     * 直接从元素的 data-turn-id 属性读取 ID
     * 
     * ✅ 降级方案：返回 null 时，generateTurnId 会降级使用 index（数字类型）
     * @param {Element} element - 用户消息元素
     * @returns {string|null} - nodeId（字符串），失败返回 null
     */
    _extractNodeIdFromDom(element) {
        if (!element) return null;
        
        const nodeId = element.getAttribute('data-turn-id-container')
            || element.getAttribute('data-turn-id')
            || null;
        if (nodeId) return String(nodeId);
        if (element.getAttribute('data-ait-heading-turn') === 'user') {
            return this._matchHeadingNodeId(element);
        }
        return null;
    }

    /**
     * 生成节点的唯一标识 turnId
     * 优先使用 data-turn-id（稳定），回退到数组索引（兼容）
     */
    generateTurnId(element, index) {
        // 优先使用 data-turn-id（稳定标识），回退到数组索引
        const nodeId = this._extractNodeIdFromDom(element);
        return nodeId ? `chatgpt-${nodeId}` : `chatgpt-${index}`;
    }
    
    /**
     * 从存储的 nodeId 生成 turnId（用于收藏跳转）
     * @param {string|number} identifier - nodeId（字符串）或 index（数字）
     * @returns {string}
     */
    generateTurnIdFromIndex(identifier) {
        return `chatgpt-${identifier}`;
    }
    
    /**
     * 从 turnId 中提取 nodeId/index
     * @param {string} turnId - 格式为 chatgpt-{nodeId} 或 chatgpt-{index}
     * @returns {string|number|null} - nodeId（字符串）或 index（数字）
     */
    extractIndexFromTurnId(turnId) {
        if (!turnId) return null;
        if (turnId.startsWith('chatgpt-')) {
            const part = turnId.substring(8); // 'chatgpt-'.length = 8
            // ✅ 尝试解析为数字（降级到 index 时的数据）
            const parsed = parseInt(part, 10);
            // 如果是纯数字字符串，返回数字；否则返回字符串
            return (String(parsed) === part) ? parsed : part;
        }
        return null;
    }
    
    /**
     * 根据存储的 nodeId/index 查找 marker
     * 支持新数据（nodeId 字符串）和旧数据（index 数字）
     * @param {string|number} storedKey - 存储的 nodeId 或 index
     * @param {Array} markers - marker 数组
     * @param {Map} markerMap - markerMap
     * @returns {Object|null} - 匹配的 marker
     */
    findMarkerByStoredIndex(storedKey, markers, markerMap) {
        if (storedKey === null || storedKey === undefined) return null;
        
        // 1. 先尝试用 nodeId/index 构建 turnId 查找
        const turnId = `chatgpt-${storedKey}`;
        const marker = markerMap.get(turnId);
        if (marker) return marker;
        
        // 2. Fallback：如果是数字，尝试用数组索引（兼容旧数据）
        if (typeof storedKey === 'number' && storedKey >= 0 && storedKey < markers.length) {
            return markers[storedKey];
        }
        
        return null;
    }

    _cacheTurnText(nodeId, text) {
        const normalized = String(text || '').trim();
        if (!nodeId || !normalized) return;

        const maxLength = ChatGPTAdapter.TEXT_CACHE_MAX_TEXT_LENGTH;
        const trimmed = normalized.length > maxLength
            ? normalized.slice(0, maxLength)
            : normalized;
        if (this._turnTextCache.get(nodeId) === trimmed) return;
        if (!this._turnTextCache.has(nodeId)
            && this._turnTextCache.size >= ChatGPTAdapter.TEXT_CACHE_MAX_ENTRIES) {
            const oldest = this._turnTextCache.keys().next().value;
            this._turnTextCache.delete(oldest);
        }
        this._turnTextCache.set(nodeId, trimmed);
    }

    extractText(element) {
        const nodeId = this._extractNodeIdFromDom(element);
        const textElement = element.querySelector('.whitespace-pre-wrap');
        const text = element.hasAttribute('data-ait-heading-turn')
            ? this._extractHeadingText(element)
            : (textElement?.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) {
            if (nodeId) this._cacheTurnText(nodeId, text);
            return text;
        }
        if (nodeId && this._turnTextCache.has(nodeId)) {
            return this._turnTextCache.get(nodeId);
        }
        return element.childElementCount === 0 ? '[未加载的提问]' : '[图片或文件]';
    }
    
    /**
     * 获取时间标签的渲染目标元素
     * ChatGPT: 使用 [data-message-id] 子元素
     */
    getTimeLabelTarget(element) {
        return element.querySelector('[data-message-id]') || null;
    }

    isConversationRoute(pathname) {
        const segs = pathname.split('/').filter(Boolean);
        
        // 检查普通对话路径: /c/{id}
        const cIndex = segs.indexOf('c');
        if (cIndex !== -1) {
            const slug = segs[cIndex + 1];
            if (typeof slug === 'string' && slug.length > 0 && /^[A-Za-z0-9_-]+$/.test(slug)) {
                return true;
            }
        }
        
        // 检查 GPT 对话路径: /g/{gpt_id}/c/{conversation_id}
        const gIndex = segs.indexOf('g');
        if (gIndex !== -1 && segs[gIndex + 2] === 'c') {
            const gptId = segs[gIndex + 1];
            const conversationId = segs[gIndex + 3];
            if (gptId && conversationId && 
                /^[A-Za-z0-9_-]+$/.test(gptId) && 
                /^[A-Za-z0-9_-]+$/.test(conversationId)) {
                return true;
            }
        }
        
        // 检查分享页面路径: /share/{id} 或 /share/e/{id}
        const shareIndex = segs.indexOf('share');
        if (shareIndex !== -1) {
            const shareId = segs[shareIndex + 1] === 'e'
                ? segs[shareIndex + 2]
                : segs[shareIndex + 1];
            if (typeof shareId === 'string' && shareId.length > 0 && /^[A-Za-z0-9_-]+$/.test(shareId)) {
                return true;
            }
        }
        
        return false;
    }

    extractConversationId(pathname) {
        try {
            const segs = pathname.split('/').filter(Boolean);
            
            // 尝试提取 GPT 对话 ID: /g/{gpt_id}/c/{conversation_id}
            const gIndex = segs.indexOf('g');
            if (gIndex !== -1 && segs[gIndex + 2] === 'c') {
                const conversationId = segs[gIndex + 3];
                if (conversationId && /^[A-Za-z0-9_-]+$/.test(conversationId)) return conversationId;
            }
            
            // 尝试提取普通对话 ID: /c/{id}
            const cIndex = segs.indexOf('c');
            if (cIndex !== -1) {
                const slug = segs[cIndex + 1];
                if (slug && /^[A-Za-z0-9_-]+$/.test(slug)) return slug;
            }
            
            // 尝试提取分享页面 ID: /share/{id} 或 /share/e/{id}
            const shareIndex = segs.indexOf('share');
            if (shareIndex !== -1) {
                const shareId = segs[shareIndex + 1] === 'e'
                    ? segs[shareIndex + 2]
                    : segs[shareIndex + 1];
                if (shareId && /^[A-Za-z0-9_-]+$/.test(shareId)) return shareId;
            }
            
            return null;
        } catch {
            return null;
        }
    }

    findConversationContainer(firstMessage, context = {}) {
        /**
         * 查找对话容器
         * 
         * 使用 LCA（最近共同祖先）算法查找所有对话记录的最近父容器。
         * 传递 messageSelector 参数，让 ContainerFinder 能够：
         * 1. 查询所有用户消息元素
         * 2. 找到它们的最近共同祖先
         * 3. 确保容器是直接包裹所有对话的最小容器
         * 
         * 优势：比传统的向上遍历更精确，避免找到过于外层的容器
         */
        return ContainerFinder.findConversationContainer(firstMessage, {
            messageSelector: context.messageSelector || this.getUserMessageSelector(),
            messages: context.userTurnElements
        });
    }

    getTimelinePosition() {
        const defaultRightInset = 16;
        const nativeTimeline = this.findNativeTimelineContainer();
        let rightInset = defaultRightInset;

        if (nativeTimeline && typeof window !== 'undefined') {
            try {
                const style = window.getComputedStyle(nativeTimeline);
                const rect = nativeTimeline.getBoundingClientRect();
                const occupiedFromRight = window.innerWidth - rect.left;
                const isVisible = style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    rect.width > 0 &&
                    rect.height > 0;

                if (
                    isVisible &&
                    Number.isFinite(occupiedFromRight) &&
                    occupiedFromRight > 0 &&
                    occupiedFromRight < window.innerWidth
                ) {
                    // ChatGPT 原生目录固定在右侧；保留 8px 间隔，把扩展时间轴放到它左边。
                    rightInset = Math.ceil(occupiedFromRight + 8);
                }
            } catch {}
        }

        return {
            top: '120px',      // 避开顶部导航栏
            right: `${rightInset}px`,
            bottom: '120px',   // 避开底部输入框
        };
    }

    /**
     * ChatGPT 的原生 Prompt 目录没有稳定容器 ID，但目录按钮有稳定的
     * data-toc-item-index。由按钮向上查找 fixed 容器，避免依赖构建生成的类名。
     * @returns {Element|null}
     */
    findNativeTimelineContainer() {
        if (typeof document === 'undefined') return null;

        const tocItem = document.querySelector('button[data-toc-item-index]');
        let current = tocItem?.parentElement || null;
        while (current && current !== document.body) {
            try {
                if (window.getComputedStyle(current).position === 'fixed') {
                    return current;
                }
            } catch {}
            current = current.parentElement;
        }
        return null;
    }
    
    /**
     * 获取时间标签位置配置
     * ChatGPT: 底部显示
     */
    getTimeLabelPosition() {
        // 相对于消息元素定位
        return {
            top: '-16px',
            right: '10px'
        };
    }
    
    getStarChatButtonTarget() {
        // 返回分享按钮，收藏按钮将插入到它前面
        return document.querySelector('[data-testid="share-chat-button"]');
    }
    
    getDefaultChatTheme() {
        // ChatGPT 使用页面标题作为默认主题
        return document.title || '';
    }
    
    /**
     * 检测是否应该隐藏时间轴
     * ChatGPT: 当页面存在 .text-token-primary 元素时隐藏
     * @returns {boolean}
     */
    shouldHideTimeline() {
        return document.querySelector('.text-token-primary') !== null ||
               document.querySelector('[data-stage-thread-flyout="true"][data-testid="stage-thread-flyout"]') !== null;
    }

    getTimelineVisibilitySelectors() {
        return [
            '.text-token-primary',
            '[data-stage-thread-flyout="true"][data-testid="stage-thread-flyout"]',
            'button[data-toc-item-index]'
        ];
    }
    
    /**
     * 获取滚动偏移量
     * 用户消息节点本身上方留白较多，仅需小幅补偿即可避免被顶部 UI 遮挡
     * @returns {number} - 滚动偏移量（像素）
     */
    getScrollOffset() {
        return 20;
    }
    
    /**
     * 检测 AI 是否正在生成回答
     * ChatGPT: 当 #composer-submit-button 元素的 data-testid="stop-button" 时，表示正在生成
     * @returns {boolean}
     */
    isAIGenerating() {
        const submitButton = this.getComposerSubmitButton();
        // ✅ 必须返回 boolean，找不到按钮视为 false（未生成），而不是 null（未实现）
        return !!(submitButton && submitButton.getAttribute('data-testid') === 'stop-button');
    }

    getImageUploadInputSelector() {
        return 'input[type="file"]';
    }

    getComposerSubmitButton() {
        return document.getElementById('composer-submit-button') ||
            document.querySelector('button[data-testid="send-button"], button[data-testid="stop-button"]');
    }

    getComposerRoot() {
        const prompt = document.getElementById('prompt-textarea');
        const submitButton = this.getComposerSubmitButton();
        return prompt?.closest('form') ||
            submitButton?.closest('form') ||
            prompt?.closest('[data-testid*="composer"]') ||
            submitButton?.parentElement ||
            prompt || null;
    }

    isImageUploadInProgress() {
        const root = this.getComposerRoot();
        if (!root?.querySelector) return false;

        return !!root.querySelector([
            '[role="progressbar"]',
            '[aria-busy="true"]',
            '[aria-label*="Uploading"]',
            '[aria-label*="uploading"]',
            '[aria-label*="上传中"]',
            '[data-testid*="upload-progress"]',
            '[data-testid*="uploading"]'
        ].join(','));
    }

    hasImageUploadAttachment() {
        const root = this.getComposerRoot();
        if (!root?.querySelector) return false;

        return !!root.querySelector([
            '[data-testid*="file-preview"]',
            '[data-testid*="file-thumbnail"]',
            '[data-testid*="attachment"]',
            '[data-testid*="uploaded-file"]',
            '[data-testid*="image"]',
            'img[src^="blob:"]',
            'img[src^="data:image"]',
            'img[alt*="Uploaded"]',
            'img[alt*="uploaded"]',
            'img[alt*="upload"]',
            'img[alt*="上传"]'
        ].join(','));
    }

    isImageUploadReadyToSend() {
        const submitButton = this.getComposerSubmitButton();
        if (!submitButton) return false;

        const isStopButton = submitButton.getAttribute('data-testid') === 'stop-button';
        const isDisabled = submitButton.disabled === true ||
            submitButton.getAttribute('disabled') !== null ||
            submitButton.getAttribute('aria-disabled') === 'true';

        return !isStopButton && !isDisabled && !this.isImageUploadInProgress();
    }

    sendImageUploadMessage() {
        const submitButton = this.getComposerSubmitButton();
        if (!submitButton || !this.isImageUploadReadyToSend()) return false;
        submitButton.click();
        return true;
    }
}
