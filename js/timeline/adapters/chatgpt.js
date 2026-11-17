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
        this._usesKeyTurnSelector = false;
        this._usesHeadingTurnSelector = false;
        this._usesMessageRoleSelector = false;
        this._usesSearchTurnSelector = false;
        this._capturedTimeline = null;
        this._capturedTimelineConvId = null;
        this._capturedTimelineIds = new Set();
        this._historyLoading = null;
        this._liveTimelineEntries = new Map();
        this._supplementalTimelineOrder = { before: [], after: [] };
        this._liveTimelineRevision = null;
        this._liveTimelineScopes = new WeakSet();
        this._timelineEntryRevisions = new Map();
        this._timelineTranscript = null;
        this._previousTimelineTranscript = null;
        this._timelineTranscriptsByScope = new WeakMap();
        this._timelineRowOwners = new WeakMap();
    }

    static TEXT_CACHE_MAX_TEXT_LENGTH = 200;
    static TEXT_CACHE_MAX_ENTRIES = 3000;

    _isTimelineElementActive(element, visibility = new Map()) {
        if (!element) return false;
        if (visibility.has(element)) return visibility.get(element);
        let active = !element.hasAttribute?.('hidden');
        if (active) {
            try {
                const style = window.getComputedStyle(element);
                active = style.display !== 'none' && style.visibility !== 'hidden';
            } catch {}
        }
        if (active && element.parentElement) {
            active = this._isTimelineElementActive(element.parentElement, visibility);
        }
        visibility.set(element, active);
        return active;
    }

    getTimelineQueryRoot(visibility = new Map()) {
        return Array.from(document.querySelectorAll('main'))
            .find(main => this._isTimelineElementActive(main, visibility)) || document;
    }

    _queryTimelineElements(selector, scope = document) {
        const visibility = new Map();
        const root = scope === document ? this.getTimelineQueryRoot(visibility) : scope;
        // 不用尺寸或视口相交状态筛选：虚拟列表的空壳和 display:contents 消息仍然有效。
        return Array.from(root.querySelectorAll(selector))
            .filter(element => this._isTimelineElementActive(element, visibility));
    }

    getUserMessageElements(scope = document) {
        return this.filterTimelineUserElements(
            this._queryTimelineElements(this.getUserMessageSelector(), scope)
        );
    }

    isConversationContainerCurrent(container) {
        if (!container?.isConnected || !this._isTimelineElementActive(container)) return false;
        const root = this.getTimelineQueryRoot();
        return root === document || root.contains(container);
    }

    _pullConvTexts(conversationId, { restartHistory = false } = {}) {
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
                detail: restartHistory ? JSON.stringify({ conversationId, restartHistory: true }) : conversationId
            }));
        } catch {
            return 0;
        } finally {
            document.removeEventListener('ait-gpt-user-texts-result', handler);
        }

        const previousTimeline = JSON.stringify(this._capturedTimeline);
        const timeline = received?.timeline;
        this._capturedTimeline = Array.isArray(timeline?.entries) ? timeline : null;
        this._capturedTimelineConvId = conversationId;
        this._capturedTimelineIds = new Set(this._capturedTimeline?.entries.map(entry => entry.id));
        if (this._timelineTranscript?.conversationId === conversationId && this._capturedTimeline) {
            for (const id of this._capturedTimelineIds) this._timelineTranscript.snapshotIds.add(id);
        }
        this._historyLoading = { conversationId, loading: received?.historyLoading === true };
        const timelineChanged = JSON.stringify(this._capturedTimeline) !== previousTimeline;

        const texts = received?.texts;
        if (!texts || typeof texts !== 'object' || Array.isArray(texts)) return timelineChanged ? 1 : 0;

        this._capturedMatchTexts = new Map(
            Object.entries(texts).filter(([, text]) => typeof text === 'string')
        );
        const nextCapturedTextIds = new Set(this._capturedMatchTexts.keys());
        let changedCount = timelineChanged ? 1 : 0;
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

    syncCapturedChatsData({ force = false, restartHistory = false } = {}) {
        const conversationId = this.extractConversationId(location.pathname);
        if (conversationId !== this._textCacheConvId) {
            this._textCacheConvId = conversationId;
            this._turnTextCache.clear();
            this._capturedTextIds.clear();
            this._capturedMatchTexts.clear();
            this._capturedTimeline = null;
            this._capturedTimelineConvId = conversationId;
            this._capturedTimelineIds.clear();
        } else if (!force && this._capturedTextIds.size > 0) {
            return;
        }
        // 接口可能在实例销毁与重建之间返回；空缓存允许在下一次渲染时重试。
        this._pullConvTexts(conversationId, { restartHistory });
    }

    handleCapturedChatsDataUpdated(conversationId) {
        const currentConversationId = this.extractConversationId(location.pathname);
        if (!conversationId || conversationId !== currentConversationId) return 0;

        if (this._textCacheConvId !== conversationId) {
            this._textCacheConvId = conversationId;
            this._turnTextCache.clear();
            this._capturedTextIds.clear();
            this._capturedMatchTexts.clear();
            this._capturedTimeline = null;
            this._capturedTimelineConvId = conversationId;
            this._capturedTimelineIds.clear();
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
                rebuildMarkers: true
            });
        };
        const loadingHandler = (event) => {
            let state;
            try { state = JSON.parse(event.detail); } catch {
                return;
            }
            if (state?.conversationId !== this.extractConversationId(location.pathname)
                || typeof state.loading !== 'boolean') {
                return;
            }
            const wasLoading = this.isTimelineHistoryLoading();
            this._historyLoading = state;
            if (wasLoading !== this.isTimelineHistoryLoading()) {
                callback({ conversationId: state.conversationId, historyLoadingChanged: true });
            }
        };
        document.addEventListener('ait-gpt-user-texts-updated', handler);
        document.addEventListener('ait-gpt-history-loading', loadingHandler);
        return () => {
            document.removeEventListener('ait-gpt-user-texts-updated', handler);
            document.removeEventListener('ait-gpt-history-loading', loadingHandler);
        };
    }

    // 只在已有顺序的边界或相邻锚点间插入新节点；没有重叠的历史窗口先等待 API。
    _mergeSupplementalTimelineOrder(current, observed) {
        const incoming = [...new Set(observed)];
        const ranks = new Map(current.map((id, index) => [id, index]));
        const anchors = incoming.filter(id => ranks.has(id));
        if (!anchors.length) return current.length ? current : incoming;
        if (anchors.some((id, index) => index > 0 && ranks.get(id) <= ranks.get(anchors[index - 1]))) return current;
        const result = [...current];
        let previousRank = -1, pending = [];
        for (const id of incoming) {
            if (!ranks.has(id)) { pending.push(id); continue; }
            const rank = ranks.get(id);
            if (rank === previousRank + 1) result.splice(result.indexOf(id), 0, ...pending);
            pending = [];
            previousRank = rank;
        }
        if (previousRank === current.length - 1) result.push(...pending);
        return result;
    }

    supportsDeferredNodeNavigation() {
        return true;
    }

    areTimelineIndexesStable() {
        return this._capturedTimelineConvId !== this.extractConversationId(location.pathname)
            || !this._capturedTimeline || this._capturedTimeline.complete === true;
    }

    getConversationBranch() {
        if (this._capturedTimelineConvId !== this.extractConversationId(location.pathname)
            || this._capturedTimeline?.complete !== true) return null;
        return { turnIds: this._capturedTimeline.entries.map(entry => entry.id) };
    }

    getCapturedTimelineEntries(userElements) {
        const conversationId = this.extractConversationId(location.pathname);
        if (this._capturedTimelineConvId !== conversationId
            || !this._capturedTimeline?.entries?.length) {
            this._liveTimelineEntries.clear();
            this._supplementalTimelineOrder = { before: [], after: [] };
            this._liveTimelineRevision = null;
            this._liveTimelineScopes = new WeakSet();
            return null;
        }
        const revision = `${this._capturedTimelineConvId}:${this._capturedTimeline.revision || ''}`;
        if (this._liveTimelineRevision !== revision) {
            this._liveTimelineRevision = revision;
            this._liveTimelineEntries.clear();
            this._supplementalTimelineOrder = { before: [], after: [] };
            this._liveTimelineScopes = new WeakSet();
        }
        const scopeFor = element => this._getTimelineScope(element) || element.parentElement;
        userElements = userElements.filter(element => {
            const owner = this._getTimelineScopeOwner(scopeFor(element));
            return !owner || owner === conversationId;
        });
        const confirmScope = element => {
            const scope = scopeFor(element);
            if (scope) this._liveTimelineScopes.add(scope);
        };
        const elementsById = new Map();
        for (const element of userElements) {
            this._getTimelineElementIds(element).forEach(id => elementsById.set(id, element));
        }
        const capturedIdsByElement = new Map();
        const entries = this._capturedTimeline.entries.map(entry => {
            this._timelineEntryRevisions.set(`chatgpt-${entry.id}`, revision);
            this._liveTimelineEntries.delete(`chatgpt-${entry.id}`);
            const element = elementsById.get(entry.id) || null;
            if (element) {
                capturedIdsByElement.set(element, `chatgpt-${entry.id}`);
                confirmScope(element);
            }
            const domText = element ? this.extractText(element) : '';
            return {
                id: `chatgpt-${entry.id}`,
                element,
                summary: this.isPlaceholderSummary(domText) ? entry.text : domText
            };
        });
        const capturedIds = new Set(entries.map(entry => entry.id));
        const complete = this._capturedTimeline.complete === true;
        for (const [id, cached] of this._liveTimelineEntries) {
            if (complete && cached.side === 'before') continue;
            const element = elementsById.get(id.slice('chatgpt-'.length));
            if (element) confirmScope(element);
        }
        // SPA 切换时新 URL/快照可能先于旧 DOM 更新。只有当前快照确认过的
        // 对话容器才能补入新提问，且不能重新收录其他会话或旧分支的消息。
        const groups = new Map();
        for (const [index, element] of userElements.entries()) {
            const id = capturedIdsByElement.get(element) || this.generateTurnId(element, index);
            const knownRevision = this._timelineEntryRevisions.get(id);
            const scope = scopeFor(element);
            if (!scope || !this._liveTimelineScopes.has(scope) || (knownRevision && knownRevision !== revision)) continue;
            if (!groups.has(scope)) groups.set(scope, new Map());
            const group = groups.get(scope);
            if (!group.has(id)) group.set(id, { id, element });
        }
        const observed = { before: [], after: [] }, candidates = new Map();
        for (const records of groups.values()) {
            const group = [...records.values()];
            const apiPositions = [], beforePositions = [], afterPositions = [];
            group.forEach(({ id }, index) => {
                if (capturedIds.has(id)) apiPositions.push(index);
                else if (this._liveTimelineEntries.get(id)?.side === 'before') beforePositions.push(index);
                else if (this._liveTimelineEntries.get(id)?.side === 'after') afterPositions.push(index);
            });
            group.forEach(({ id, element }, index) => {
                if (capturedIds.has(id)) return;
                let side = this._liveTimelineEntries.get(id)?.side;
                if (!side && apiPositions.length) {
                    if (index < apiPositions[0]) side = 'before';
                    else if (index > apiPositions[apiPositions.length - 1]) side = 'after';
                } else if (!side && (beforePositions.length || afterPositions.length)) {
                    if (beforePositions.length && index <= beforePositions[beforePositions.length - 1]) side = 'before';
                    else if (afterPositions.length && index >= afterPositions[0]) side = 'after';
                    else if (complete) side = 'after';
                } else if (!side && complete && this._getTimelineScopeOwner(scopeFor(element)) === conversationId) {
                    side = 'after';
                }
                if (!side) return;
                this._timelineEntryRevisions.set(id, revision);
                observed[side].push(id);
                candidates.set(id, { summary: this.extractText(element), side });
            });
        }
        for (const side of ['before', 'after']) {
            const current = this._supplementalTimelineOrder[side].filter(id => this._liveTimelineEntries.has(id));
            const ordered = this._mergeSupplementalTimelineOrder(current, observed[side]);
            this._supplementalTimelineOrder[side] = ordered;
            for (const id of ordered) {
                if (candidates.has(id)) this._liveTimelineEntries.set(id, candidates.get(id));
            }
        }
        const supplement = side => this._supplementalTimelineOrder[side].map(id => ({
            id,
            summary: this._liveTimelineEntries.get(id).summary,
            element: elementsById.get(id.slice('chatgpt-'.length)) || null
        }));
        return [...(complete ? [] : supplement('before')), ...entries, ...supplement('after')];
    }

    isTimelineTargetReady(element) {
        if (!element?.isConnected || element.childElementCount === 0) return false;
        const hasUserContent = element.matches('[data-turn="user"], [data-chatgpt-search-unit-key$=":user"], [data-message-role="user"], [data-ait-heading-turn="user"]')
            || element.querySelector('[data-turn="user"], [data-chatgpt-search-unit-key$=":user"], [data-message-role="user"], h4.sr-only[data-conversation-role="user"]');
        if (element.matches('[data-turn-id-container], [data-turn-key]') && !hasUserContent) return false;
        const rect = this.getTimelineMessageRect(element) || element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.height > 0 && rect.width > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }

    isTimelineTargetInScope(element, scope) {
        if (!scope?.contains(element)) return false;
        const owner = this._getTimelineScopeOwner(this._getTimelineScope(element));
        return !owner || owner === this.extractConversationId(location.pathname);
    }

    _findTimelineTarget(targetId, scope) {
        // 同一提问可能同时有外层空壳和已渲染的内层元素，优先采用可定位的内容。
        let shell = null;
        const userSelector = this.getUserMessageSelector();
        const query = [userSelector, '[data-turn-id-container]', '[data-turn-key]'].filter(Boolean).join(', ');
        for (const element of scope.querySelectorAll(query)) {
            if (!this.isTimelineTargetInScope(element, scope)) continue;
            const ids = this._getTimelineElementIds(element);
            const matches = ids.includes(targetId)
                || element.getAttribute('data-turn-key') === targetId
                || element.getAttribute('data-turn-id') === targetId;
            if (!matches) continue;
            if (this.isTimelineTargetReady(element)) return element;
            shell ||= element;
        }
        return shell;
    }

    _waitForTimelineRender(signal, scope) {
        if (signal.aborted) return Promise.resolve();
        return new Promise(resolve => {
            const startedAt = Date.now();
            let quietTimer, maxTimer, done = false;
            const finish = () => {
                if (done) return;
                done = true;
                observer.disconnect();
                clearTimeout(quietTimer);
                clearTimeout(maxTimer);
                signal.removeEventListener('abort', finish);
                resolve();
            };
            const schedule = () => {
                clearTimeout(quietTimer);
                quietTimer = setTimeout(finish, Math.max(180, 580 - (Date.now() - startedAt)));
            };
            const observer = new MutationObserver(schedule);
            observer.observe(scope, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: this.getTimelineStructureAttributeFilter()
            });
            signal.addEventListener('abort', finish, { once: true });
            maxTimer = setTimeout(finish, 2000);
            schedule();
            if (signal.aborted) finish();
        });
    }

    async resolveTimelineTarget(marker, scrollContainer, signal, onProgress, navigation = {}) {
        const conversationId = this.extractConversationId(location.pathname);
        const scope = navigation.conversationContainer || this._timelineTranscript?.scope || scrollContainer;
        const isCurrentScope = () => {
            const owner = this._getTimelineScopeOwner(scope);
            return scope.isConnected !== false && (!owner || owner === conversationId)
                && navigation.isScopeCurrent?.() !== false
                && this.extractConversationId(location.pathname) === conversationId;
        };
        const targetId = marker.id.slice('chatgpt-'.length);
        const initialScrollTop = scrollContainer.scrollTop;
        const deadline = Math.min(Date.now() + 120000, navigation.deadline ?? Infinity);
        const checkedIds = new Set();
        let maxKnownEntries = 0, seenTargetShell = false, maxTargetChildren = 0;
        let foundTarget = null, lastSignature = '', lastProgressAt = Date.now();
        let lowerPosition = null, upperPosition = null, searchSnapshot = '';
        try {
            while (!signal.aborted && Date.now() < deadline && isCurrentScope()) {
                this.prepareTimelineNodes({ force: true, reason: 'resolve-target' });
                const target = this._findTimelineTarget(targetId, scope);
                if (this.isTimelineTargetReady(target)) {
                    foundTarget = target;
                    return target;
                }
                const selector = this.getUserMessageSelector();
                const rawElements = selector ? Array.from(scope.querySelectorAll(selector)) : [];
                const userElements = this.filterTimelineUserElements(rawElements);
                const entries = this.getCapturedTimelineEntries(userElements) || userElements.map((element, index) => ({
                    id: this.generateTurnId(element, index),
                    element
                }));
                const targetIndex = entries.findIndex(entry => entry.id === marker.id);
                const entryTarget = entries[targetIndex]?.element;
                if (this.isTimelineTargetReady(entryTarget)) {
                    foundTarget = entryTarget;
                    return entryTarget;
                }
                const loadedIndexes = [];
                entries.forEach((entry, index) => {
                    if (!this.isTimelineTargetReady(entry.element)) return;
                    checkedIds.add(entry.id);
                    loadedIndexes.push(index);
                });
                onProgress?.({ checked: checkedIds.size, targetIndex, total: entries.length });
                maxKnownEntries = Math.max(maxKnownEntries, entries.length);
                seenTargetShell ||= !!target;
                maxTargetChildren = Math.max(maxTargetChildren, target?.childElementCount || 0);
                const signature = `${checkedIds.size}:${maxKnownEntries}:${seenTargetShell}:${maxTargetChildren}`;
                if (signature !== lastSignature) {
                    lastProgressAt = Date.now();
                    lastSignature = signature;
                } else if (!navigation.waitForTarget && Date.now() - lastProgressAt > 20000) {
                    return null;
                }
                if (!target && (targetIndex < 0 || !loadedIndexes.length)) {
                    await this._waitForTimelineRender(signal, scope);
                    continue;
                }
                const from = scrollContainer.scrollTop;
                if (target) {
                    const targetRect = this.getTimelineMessageRect(target) || target.getBoundingClientRect();
                    scrollContainer.scrollTop += targetRect.top
                        - scrollContainer.getBoundingClientRect().top - 80;
                } else {
                    const containerTop = scrollContainer.getBoundingClientRect().top;
                    const preceding = loadedIndexes.filter(index => {
                        const rect = this.getTimelineMessageRect(entries[index].element)
                            || entries[index].element.getBoundingClientRect();
                        return rect.top <= containerTop;
                    });
                    const currentIndex = preceding.length ? preceding[preceding.length - 1] : loadedIndexes[0];
                    const direction = targetIndex < currentIndex ? 'top' : 'bottom';
                    const maxScrollTop = Math.max(0, scrollContainer.scrollHeight
                        - (scrollContainer.clientHeight || window.innerHeight));
                    const scrollStart = window.getComputedStyle(scrollContainer).flexDirection === 'column-reverse' ? -maxScrollTop : 0;
                    const snapshot = `${entries.length}:${targetIndex}`;
                    if (snapshot !== searchSnapshot) {
                        lowerPosition = upperPosition = null;
                        searchSnapshot = snapshot;
                    }
                    const position = maxScrollTop > 0 ? Math.max(0, Math.min(1, (from - scrollStart) / maxScrollTop)) : 0;
                    if (direction === 'top') {
                        if (lowerPosition !== null && position <= lowerPosition) lowerPosition = null;
                        upperPosition = position;
                    } else {
                        if (upperPosition !== null && position >= upperPosition) upperPosition = null;
                        lowerPosition = position;
                    }
                    if (lowerPosition !== null && upperPosition !== null) {
                        scrollContainer.scrollTop = scrollStart + (lowerPosition + upperPosition) / 2 * maxScrollTop;
                    } else {
                        scrollContainer.scrollTop = scrollStart + (direction === 'top' ? 0 : maxScrollTop);
                    }
                }
                await this._waitForTimelineRender(signal, scope);
            }
            return null;
        } finally {
            if (!foundTarget && isCurrentScope()
                && (!signal.aborted || signal.reason === 'cancel-navigation')) {
                scrollContainer.scrollTop = initialScrollTop;
            }
        }
    }

    isTimelineHistoryLoading() {
        return this._historyLoading?.conversationId === this.extractConversationId(location.pathname)
            && this._historyLoading.loading === true && this._capturedTimeline?.complete !== true;
    }

    isTimelineHistoryRenderPending(markers = []) {
        if (this._capturedTimelineConvId !== this.extractConversationId(location.pathname)
            || this._capturedTimeline?.complete !== true) return false;
        const renderedIds = new Set(markers.map(marker => marker.id));
        return this._capturedTimeline.entries?.some(entry => !renderedIds.has(`chatgpt-${entry.id}`)) === true;
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
        const all = this._queryTimelineElements('[data-turn-id-container], [data-turn-key]');
        if (!all.length) return false;

        const seen = new Set();
        const selected = new Set();
        const containers = [];
        all.forEach(element => {
            const id = this._extractNodeIdFromDom(element);
            if (!id || seen.has(id)) return;
            for (let parent = element.parentElement; parent; parent = parent.parentElement) {
                if (selected.has(parent)) return;
            }
            seen.add(id);
            selected.add(element);
            containers.push(element);
        });

        const roles = new Array(containers.length).fill(null);
        let nextRole = null;
        for (let index = containers.length - 1; index >= 0; index--) {
            const element = containers[index];
            const roleElement = element.querySelector('[data-turn], [data-message-role], [data-conversation-role], [data-chatgpt-search-unit-key]');
            const readRole = node => node?.getAttribute('data-turn')
                || node?.getAttribute('data-message-role')
                || node?.getAttribute('data-conversation-role')
                || node?.getAttribute('data-chatgpt-search-unit-key')?.split(':').pop();
            const turnId = this._extractNodeIdFromDom(element);
            const realRole = readRole(element) || readRole(roleElement)
                || ((this._capturedTextIds.has(turnId) || this._capturedTimelineIds.has(turnId)) ? 'user' : null);
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
                const id = this._extractNodeIdFromDom(element);
                if (id && !this._turnTextCache.has(id)) {
                    const rawText = (element.querySelector('[data-user-message-bubble]')
                        || element.querySelector('.whitespace-pre-wrap'))?.textContent;
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
        this._usesKeyTurnSelector = hasVirtualizedTurns
            && this._queryTimelineElements('[data-turn-key][data-ait-turn="user"]').length > 0;
        this._usesVirtualizedTurnSelector = hasVirtualizedTurns
            && (this._usesKeyTurnSelector
                || this._queryTimelineElements('[data-turn-id-container][data-ait-turn="user"]').length > 0);
        const hasLegacyTurns = this._queryTimelineElements('[data-turn="user"][data-turn-id]').length > 0;
        this._usesSearchTurnSelector = !this._usesVirtualizedTurnSelector && !hasLegacyTurns
            && this._queryTimelineElements('[data-thread-find-target="conversation"] [data-chatgpt-search-unit-key$=":user"][data-chatgpt-search-message-ids]').length > 0;
        this._usesMessageRoleSelector = !this._usesVirtualizedTurnSelector && !hasLegacyTurns && !this._usesSearchTurnSelector
            && this.getTimelineQueryRoot() !== document
            && this._queryTimelineElements('[data-message-role="user"][id]').length > 0;
        this._usesHeadingTurnSelector = !this._usesVirtualizedTurnSelector && !hasLegacyTurns
            && !this._usesSearchTurnSelector && !this._usesMessageRoleSelector
            && this._markHeadingTurns();
        this._turnRolesDirty = false;
        return true;
    }

    /** 2026-09 新 UI 以无障碍角色标题分隔消息，旧结构仍优先。 */
    _markHeadingTurns() {
        const main = this.getTimelineQueryRoot();
        if (main === document) return false;
        const candidates = new Map();
        const roles = new Map();
        for (const heading of this._queryTimelineElements('h4.sr-only', main)) {
            if (heading.closest('form, nav, aside, pre, code, .markdown, [role="dialog"]')) continue;
            // 打印版标题含额外隐藏文案（如 You said:You）；角色属性不依赖语言和排版。
            let role = heading.getAttribute('data-conversation-role');
            if (role !== 'user' && role !== 'assistant') {
                const copy = heading.cloneNode(true);
                copy.querySelectorAll('[hidden], [aria-hidden="true"]').forEach(node => node.remove());
                const label = (copy.textContent || '').replace(/\s+/g, ' ').trim()
                    .replace(/[:：]$/, '').trim().toLowerCase();
                role = ['you said', 'you', '你说', '你說'].includes(label) ? 'user'
                    : ['chatgpt said', 'chatgpt', 'assistant', 'chatgpt 说', 'chatgpt 說'].includes(label)
                        ? 'assistant' : null;
            }
            if (!role) continue;
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
        copy.querySelectorAll('h4.sr-only, h4[data-message-attribution], .sr-only, button, nav, script, style, [hidden], [aria-hidden="true"], [data-ait-time], .ait-time-label')
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
        const peers = this._queryTimelineElements('[data-ait-heading-turn="user"]');
        // API 与 DOM 的全文均唯一时才关联 ID，避免重复提问跳到错误位置。
        if (peers.filter(peer => this._extractHeadingText(peer) === text).length !== 1) return null;
        return matches[0][0];
    }

    getTimelineMessageRect(element) {
        if (!element?.hasAttribute('data-ait-heading-turn') && !element?.hasAttribute('data-message-role')) return null;
        try {
            const own = element.getBoundingClientRect();
            if (own.width > 0 && own.height > 0) return own;
            const boxes = [];
            const visit = node => {
                if (node.matches('h4.sr-only, h4[data-message-attribution], .sr-only, button, nav, script, style, [hidden], [aria-hidden="true"], [data-ait-time], .ait-time-label')) return;
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
        return [
            '[data-turn-id-container]',
            '[data-turn-key]',
            '[data-chatgpt-search-unit-key]',
            '[data-chatgpt-conversation-selection-target]',
            '[data-turn]',
            '[data-message-role]',
            'h4.sr-only'
        ];
    }

    getTimelineStructureObserverOptions() {
        return { characterData: true };
    }

    getTimelineStructureObserverRoot(container) {
        const root = this.getTimelineQueryRoot();
        return root !== document && root.contains(container) ? root : container;
    }

    getTimelineStructureAttributeFilter() {
        return [
            'data-turn-id-container',
            'data-turn-key',
            'data-chatgpt-search-unit-key',
            'data-chatgpt-search-message-ids',
            'data-turn-id',
            'data-message-id',
            'data-is-intersecting',
            'data-turn',
            'data-message-role',
            'data-conversation-role',
            'data-chatgpt-conversation-selection-target',
            'id',
            'class'
        ];
    }

    async matches(url) {
        return matchesPlatform(url, 'chatgpt');
    }

    getUserMessageSelector() {
        if (this._usesMessageRoleSelector) return '[data-message-role="user"][id]';
        if (this._usesHeadingTurnSelector) return '[data-ait-heading-turn="user"]';
        if (this._usesSearchTurnSelector) return '[data-thread-find-target="conversation"] [data-chatgpt-search-unit-key$=":user"][data-chatgpt-search-message-ids]';
        if (this._usesVirtualizedTurnSelector) {
            if (this._usesKeyTurnSelector) return '[data-turn-key][data-ait-turn="user"], [data-turn-id-container][data-ait-turn="user"]';
            return '[data-turn-id-container][data-ait-turn="user"]';
        }
        return '[data-turn="user"][data-turn-id]';
    }

    filterTimelineUserElements(elements) {
        const previous = this._timelineTranscript;
        const conversationId = this.extractConversationId(location.pathname);
        if (!conversationId || !elements.length) return elements;

        const groups = new Map();
        for (const element of elements) {
            const scope = this._getTimelineScope(element);
            if (scope?.getClientRects?.().length === 0) continue;
            if (!groups.has(scope)) groups.set(scope, []);
            groups.get(scope).push(element);
        }

        const sameConversation = previous?.conversationId === conversationId;
        const outgoing = sameConversation ? this._previousTimelineTranscript : previous;
        const previousScopeVisible = previous?.scope?.isConnected && previous.scope.getClientRects?.().length !== 0;

        this.syncCapturedChatsData();
        const capturedIds = this._capturedTimelineConvId === conversationId ? this._capturedTimelineIds : null;
        const matchesSnapshot = ids => ids.some(id => capturedIds?.has(id));
        const declaredScopes = [...groups].filter(([scope]) => this._getTimelineScopeOwner(scope) === conversationId);
        let bestSnapshot = null;
        let replacement = null;
        let reusedScope = null;

        for (const [scope, rows] of declaredScopes.length ? declaredScopes : groups) {
            const owner = this._getTimelineScopeOwner(scope);
            if (owner && owner !== conversationId) continue;
            const known = scope === previous?.scope ? previous : this._timelineTranscriptsByScope.get(scope);
            const rowIds = rows.map(element => this._getTimelineElementIds(element));
            const hasKnownRows = transcript => rowIds.some((ids, index) =>
                transcript && this._matchesTimelineTranscript(transcript, rows[index], ids));
            const snapshotRows = rows.filter((_, index) => matchesSnapshot(rowIds[index]));
            const hasSnapshotMatch = snapshotRows.length > 0;
            const available = rows.filter((element, index) => {
                const ids = rowIds[index];
                if (matchesSnapshot(ids)) return true;
                if (known?.conversationId === conversationId) {
                    if (known.excludedRows.has(element) || ids.some(id => known.excludedIds.has(id))) return false;
                    if (this._matchesTimelineTranscript(known, element, ids)) return true;
                }
                const rowOwner = this._timelineRowOwners.get(element);
                if (rowOwner && rowOwner !== conversationId) return false;
                // ChatGPT 明确标记的新面板可以显示共享历史和快照之外的提问。
                if (owner === conversationId && scope !== outgoing?.scope) return true;
                return !outgoing || !this._matchesTimelineTranscript(outgoing, element, ids);
            });

            if (owner === conversationId || known?.conversationId === conversationId) {
                if (available.length) return available;
                continue;
            }

            if (sameConversation && previousScopeVisible && !hasSnapshotMatch && !hasKnownRows(previous)) {
                continue;
            }

            const old = known || outgoing;
            // 在旧 URL 上观察到的 DOM 尾部节点可能已属于新会话，只有初次绑定和快照可以给旧会话作证。
            const exclusiveMatches = rowIds.filter(ids => ids.some(id => capturedIds?.has(id)
                && !old?.initialTurnIds.has(id) && !old?.snapshotIds.has(id))).length;
            if (known && hasKnownRows(known)) {
                if (!exclusiveMatches && (!rowIds.every(matchesSnapshot) || rows.some(element => known.elements.has(element)))) {
                    continue;
                }
            }

            if (hasSnapshotMatch) {
                if (!exclusiveMatches && outgoing && snapshotRows.length < rows.length && available.length < rows.length) continue;
                if (!bestSnapshot || exclusiveMatches > bestSnapshot.exclusiveMatches
                    || (exclusiveMatches === bestSnapshot.exclusiveMatches && snapshotRows.length > bestSnapshot.matchCount)) {
                    bestSnapshot = {
                        exclusiveMatches,
                        matchCount: snapshotRows.length,
                        rows: !previous && groups.size === 1 ? available : snapshotRows
                    };
                } else if (outgoing && !exclusiveMatches && !bestSnapshot.exclusiveMatches
                    && snapshotRows.length === bestSnapshot.matchCount) {
                    bestSnapshot.ambiguous = true;
                }
                continue;
            }
            if (!known) {
                if (!sameConversation && hasKnownRows(previous)) continue;
                if (available.length) replacement ||= available;
            } else if (rows.some(element => element.childElementCount > 0)) {
                if (available.length) reusedScope ||= available;
            }
        }

        return bestSnapshot?.ambiguous ? [] : (bestSnapshot?.rows || replacement || reusedScope || []);
    }

    rememberTimelineTranscript(elements) {
        const conversationId = this.extractConversationId(location.pathname);
        if (!conversationId || !elements.length) return;
        const scope = this._getTimelineScope(elements[0]);
        const known = scope ? this._timelineTranscriptsByScope.get(scope) : this._timelineTranscript;
        if (this._timelineTranscript && this._timelineTranscript.conversationId !== conversationId) {
            this._previousTimelineTranscript = this._timelineTranscript;
        }
        if (known?.conversationId === conversationId && known.scope === scope) {
            if (this._capturedTimelineConvId === conversationId) {
                for (const id of this._capturedTimelineIds) known.snapshotIds.add(id);
            }
            this._timelineTranscript = known;
            return;
        }

        const initialTurnIds = new Set(elements.flatMap(element => this._getTimelineElementIds(element)));
        const accepted = new Set(elements);
        for (const element of accepted) this._timelineRowOwners.set(element, conversationId);
        const userSelector = this.getUserMessageSelector();
        const excluded = Array.from((userSelector && scope?.querySelectorAll?.(userSelector)) || [])
            .filter(element => !accepted.has(element));
        const transcript = {
            conversationId,
            scope,
            initialTurnIds,
            turnIds: new Set(initialTurnIds),
            elements: new WeakSet(elements),
            snapshotIds: new Set(this._capturedTimelineConvId === conversationId ? this._capturedTimelineIds : []),
            excludedRows: new WeakSet(excluded),
            excludedIds: new Set(excluded.flatMap(element => this._getTimelineElementIds(element)).filter(id => !initialTurnIds.has(id)))
        };
        this._timelineTranscript = transcript;
        if (scope) this._timelineTranscriptsByScope.set(scope, transcript);
    }

    updateTimelineTranscript(elements) {
        const transcript = this._timelineTranscript;
        if (!transcript || !elements.length || transcript.conversationId !== this.extractConversationId(location.pathname)) return;

        const scope = this._getTimelineScope(elements[0]);
        const rows = elements.filter(element => this._getTimelineScope(element) === scope);
        const knownRow = element => this._matchesTimelineTranscript(transcript, element, this._getTimelineElementIds(element));
        if (scope !== transcript.scope) {
            if (rows.every(knownRow)) {
                const rebound = { ...transcript, scope, elements: new WeakSet(rows) };
                this._timelineTranscript = rebound;
                if (scope) this._timelineTranscriptsByScope.set(scope, rebound);
            }
            return;
        }
        if (!rows.some(element => transcript.elements.has(element) && knownRow(element))) return;

        for (const element of rows) {
            transcript.elements.add(element);
            for (const id of this._getTimelineElementIds(element)) transcript.turnIds.add(id);
        }
    }

    _matchesTimelineTranscript(transcript, element, ids) {
        return ids.length
            ? ids.some(id => transcript.turnIds.has(id) || transcript.snapshotIds.has(id))
            : transcript.elements.has(element);
    }

    _getTimelineScope(element) {
        return element.closest('[data-thread-find-target="conversation"], [data-chatgpt-conversation-selection-target]')
            || element.closest('main');
    }

    _getTimelineScopeOwner(scope) {
        if (location.pathname.includes('/share/')) return null;
        return scope?.closest?.('[data-chatgpt-conversation-selection-target]')
            ?.getAttribute('data-chatgpt-conversation-selection-target') || null;
    }

    _getTimelineElementIds(element) {
        const ids = [
            this._extractNodeIdFromDom(element),
            ...(element.getAttribute('data-chatgpt-search-message-ids') || '').split(/\s+/),
            element.getAttribute('data-message-id')
        ];
        element.querySelectorAll('[data-message-id], [data-turn-id], [data-chatgpt-search-message-ids]').forEach(child => {
            ids.push(child.getAttribute('data-message-id'));
            ids.push(child.getAttribute('data-turn-id'));
            const searchIds = child.getAttribute('data-chatgpt-search-message-ids');
            if (searchIds) ids.push(...searchIds.split(/\s+/));
        });
        return ids.filter(Boolean);
    }

    getAssistantMessageSelector() {
        if (this._usesMessageRoleSelector) return '[data-message-role="assistant"][id]';
        if (this._usesHeadingTurnSelector) return '[data-ait-heading-turn="assistant"]';
        if (this._usesSearchTurnSelector) return '[data-thread-find-target="conversation"] [data-chatgpt-search-unit-key$=":assistant"][data-chatgpt-search-message-ids]';
        if (this._usesKeyTurnSelector) return '[data-turn-key][data-ait-turn="assistant"], [data-turn-id-container][data-ait-turn="assistant"]';
        if (this._queryTimelineElements('[data-turn-id-container][data-ait-turn="assistant"]').length > 0) {
            return '[data-turn-id-container][data-ait-turn="assistant"]';
        }
        return '[data-turn="assistant"][data-turn-id]';
    }

    getTimelineTurns() {
        if (this._usesMessageRoleSelector) {
            return this._queryTimelineElements('[data-message-role][id]');
        }
        if (this._usesVirtualizedTurnSelector) {
            if (this._usesKeyTurnSelector) return this._queryTimelineElements('[data-turn-key][data-ait-turn], [data-turn-id-container][data-ait-turn]');
            return this._queryTimelineElements('[data-turn-id-container][data-ait-turn]');
        }
        if (this._usesHeadingTurnSelector) {
            return this._queryTimelineElements('[data-ait-heading-turn]');
        }
        return this._queryTimelineElements('[data-turn][data-turn-id]');
    }

    getTimelineTurnKey(element) {
        const nodeId = this._extractNodeIdFromDom(element);
        if (nodeId) return { nodeId };
        const turns = this.getTimelineTurns();
        const index = turns.indexOf(element);
        if (index < 0) return null;
        const users = turns.filter(turn => turn.getAttribute('data-ait-heading-turn') === 'user');
        const user = turns.slice(0, index + 1).reverse()
            .find(turn => turn.getAttribute('data-ait-heading-turn') === 'user');
        return user ? {
            userId: this.generateTurnId(user, users.indexOf(user)),
            role: element.getAttribute('data-ait-heading-turn')
        } : null;
    }

    findTimelineTurn(key) {
        if (!key) return null;
        // Re-prepare only on a lookup: a virtualizer may have replaced a whole turn.
        this.prepareTimelineNodes({ force: true, reason: 'scroll-target' });
        const turns = this.getTimelineTurns();
        if (key.nodeId) return turns.find(turn =>
            this._extractNodeIdFromDom(turn) === key.nodeId
        ) || null;
        let userIndex = -1;
        let matchingUser = false;
        for (const turn of turns) {
            const role = turn.getAttribute('data-ait-heading-turn');
            if (role === 'user') {
                matchingUser = this.generateTurnId(turn, ++userIndex) === key.userId;
            }
            if (matchingUser && role === key.role) return turn;
        }
        return null;
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
            || element.getAttribute('data-turn-key')
            || element.getAttribute('data-turn-id')
            || (element.hasAttribute('data-message-role') ? element.getAttribute('id') : null)
            || element.getAttribute('data-chatgpt-search-message-ids')?.trim().split(/\s+/)[0]
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
        const textElement = element.querySelector('[data-user-message-bubble]')
            || element.querySelector('.whitespace-pre-wrap');
        const text = element.hasAttribute('data-ait-heading-turn') || element.hasAttribute('data-message-role')
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
        const cIndex = segs.findIndex(segment => segment === 'c' || segment === 'uc');
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
            const cIndex = segs.findIndex(segment => segment === 'c' || segment === 'uc');
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
        if (!firstMessage) return null;
        const transcript = firstMessage?.closest?.('[data-thread-find-target="conversation"], [data-chatgpt-conversation-selection-target]');
        if (transcript) return transcript;
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
        const container = ContainerFinder.findConversationContainer(firstMessage, {
            messageSelector: context.messageSelector || this.getUserMessageSelector(),
            messages: context.userTurnElements || this.getUserMessageElements()
        });
        const root = this.getTimelineQueryRoot();
        return root !== document && !root.contains(container) ? root : container;
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
