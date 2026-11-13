// ChatGPT 对话接口拦截 —— MAIN world / document_start
//
// 新版 ChatGPT 会卸载视口外轮次的 DOM 与 React 子树。页面本身仍会请求完整
// conversation mapping 或分页 messages；捕获页面请求，再按游标补齐历史提问。
(() => {
  'use strict';
  if (window.__aitGptApiCapture) return;
  window.__aitGptApiCapture = true;

  const userTextsByConversation = new Map();
  const latestAppliedRequestByConversation = new Map();
  const latestSnapshotRequestByConversation = new Map();
  const historySources = new Map();
  const historyLoads = new Map();
  const requestedHistories = new Set();
  let nextRequestSequence = 0;

  const replaceTexts = (conversationId, texts) => {
    if (!conversationId) return;
    userTextsByConversation.set(conversationId, new Map(Object.entries(texts)));
  };

  const isVisibleType = message => {
    const contentType = message?.content?.content_type;
    return contentType === 'text' || contentType === 'multimodal_text';
  };
  const isForUser = message => !message?.recipient || message.recipient === 'all';
  const isModelAuthored = message => !message?.author?.name;

  const textFromMessage = message => {
    try {
      const content = message?.content;
      if (!content || /thought|reason/i.test(content.content_type || '')) return '';
      if (!Array.isArray(content.parts)) return '';
      return content.parts.map(part => typeof part === 'string' ? part
        : (typeof part?.text === 'string' ? part.text : '')).filter(Boolean).join('\n').trim();
    } catch {
      return '';
    }
  };

  const linearize = json => {
    // 新 UI 的复数 conversations 接口直接返回 messages，不推断不存在的父链。
    if (!json?.mapping && Array.isArray(json?.messages)) {
      return json.messages.map(message => ({ id: message?.id, message }));
    }
    const mapping = json?.mapping || {};
    let current = json?.current_node;
    if (!current || !mapping[current]) {
      current = Object.keys(mapping).find(id => !(mapping[id]?.children?.length));
    }

    const chain = [];
    let guard = 0;
    while (current && mapping[current] && guard++ < 10000) {
      chain.push(mapping[current]);
      current = mapping[current].parent;
    }
    return chain.reverse();
  };

  const parseUserTexts = json => {
    const turns = [];
    let currentAssistant = null;
    linearize(json).forEach(node => {
      const message = node?.message;
      if (!message || !node.id) return;
      if (message.author?.role === 'user') {
        currentAssistant = null;
        turns.push({ role: 'user', ids: [node.id], messages: [message] });
        return;
      }
      if (!currentAssistant) {
        currentAssistant = { role: 'assistant', ids: [], messages: [] };
        turns.push(currentAssistant);
      }
      currentAssistant.ids.push(node.id);
      currentAssistant.messages.push(message);
    });

    const texts = Object.create(null);
    turns.forEach(turn => {
      if (turn.role !== 'user') return;
      const text = turn.messages
        .filter(message => message.author?.role === 'user'
          && isModelAuthored(message)
          && isForUser(message)
          && isVisibleType(message))
        .map(textFromMessage)
        .filter(Boolean)
        .join('\n\n');
      if (!text) return;

      const compact = text.replace(/\s+/g, ' ').trim();
      turn.ids.forEach(id => { texts[id] = compact; });
    });
    return texts;
  };

  const notify = conversationId => document.dispatchEvent(new CustomEvent('ait-gpt-user-texts-updated', {
    detail: conversationId
  }));

  const mergeTexts = (conversationId, texts) => {
    const bucket = userTextsByConversation.get(conversationId) || new Map();
    // 较旧分页不能覆盖已经捕获的较新消息文本。
    Object.entries(texts).forEach(([id, text]) => { if (!bucket.has(id)) bucket.set(id, text); });
    userTextsByConversation.set(conversationId, bucket);
  };

  const isCurrentConversation = id => (location.pathname || '').split('/').includes(id);

  // 页面接口只返回最近几轮；按服务端游标补齐历史，不能把 DOM 挂载窗口当作历史边界。
  const ensureHistory = async conversationId => {
    const source = historySources.get(conversationId);
    if (!source || source.failed || !source.pageInfo?.has_previous_page
      || historyLoads.has(conversationId) || !isCurrentConversation(conversationId)) return;
    const controller = new AbortController();
    historyLoads.set(conversationId, controller);
    const isCurrent = () => !controller.signal.aborted && isCurrentConversation(conversationId)
      && historySources.get(conversationId) === source
      && latestSnapshotRequestByConversation.get(conversationId) === source.sequence;
    const cursors = new Set();
    try {
      for (let page = 0; source.pageInfo?.has_previous_page && isCurrent(); page++) {
        const cursor = source.pageInfo.start_cursor;
        if (!cursor || cursors.has(cursor) || page >= 200) throw new Error('History cursor made no progress');
        cursors.add(cursor);
        const url = new URL(source.url);
        url.searchParams.set('before', cursor);
        url.searchParams.set('num_turns', '100');
        const response = await originalFetch.call(window, url.href, {
          headers: source.headers, credentials: source.credentials, signal: controller.signal
        });
        if (!isCurrent()) return;
        if (!response?.ok) throw new Error('History request failed');
        const json = await response.json();
        if (!isCurrent()) return;
        if (!Array.isArray(json?.messages)) throw new Error('History messages missing');
        const unseenIds = json.messages.map(message => message?.id)
          .filter(id => id && !source.messageIds.has(id));
        if (!unseenIds.length) throw new Error('History messages made no progress');
        unseenIds.forEach(id => source.messageIds.add(id));
        const bucket = userTextsByConversation.get(conversationId);
        const previousSize = bucket?.size || 0;
        mergeTexts(conversationId, parseUserTexts(json));
        source.pageInfo = json.page_info;
        if ((userTextsByConversation.get(conversationId)?.size || 0) !== previousSize) notify(conversationId);
      }
    } catch {
      // 保留已读数据；失败不在每次几何刷新时重试，下一份页面快照可重新启动。
      source.failed = true;
    } finally {
      if (historyLoads.get(conversationId) === controller) historyLoads.delete(conversationId);
    }
  };

  const capture = (conversationId, json, { pagination = false } = {}) => {
    try {
      if (!json?.mapping && !Array.isArray(json?.messages)) return false;
      const texts = parseUserTexts(json);
      if (pagination) mergeTexts(conversationId, texts);
      else replaceTexts(conversationId, texts);
      notify(conversationId);
      return true;
    } catch {
      return false;
    }
  };

  // POST /backend-api/conversation 是发消息流，只捕获带 id 的 GET 请求。
  const CONVERSATION_URL_RE = /^\/backend-api\/conversations?\/([0-9a-f][0-9a-f-]{18,})$/i;
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const promise = originalFetch.apply(this, args);
    try {
      const input = args[0];
      const rawUrl = typeof input === 'string' ? input : (input?.url || input?.href || '');
      const method = String(
        args[1]?.method || (typeof args[0] === 'object' ? args[0]?.method : '') || 'GET'
      ).toUpperCase();
      const requestUrl = new URL(rawUrl, location.href);
      const match = requestUrl.origin === location.origin
        && requestUrl.pathname.match(CONVERSATION_URL_RE);
      if (match && method === 'GET') {
        const conversationId = match[1];
        const requestSequence = ++nextRequestSequence;
        const pagination = requestUrl.searchParams.has('before') || requestUrl.searchParams.has('cursor');
        const branchSequence = latestSnapshotRequestByConversation.get(conversationId);
        if (!pagination) {
          latestSnapshotRequestByConversation.set(conversationId, requestSequence);
          historyLoads.get(conversationId)?.abort();
          historyLoads.delete(conversationId);
          historySources.delete(conversationId);
        }
        promise.then(response => {
          if (!response?.ok) return;
          response.clone().json().then(json => {
            const latestApplied = latestAppliedRequestByConversation.get(conversationId) || 0;
            if (pagination) {
              // 旧页只补当前快照；编辑问题或切换分支后，过期旧页不得重新合入。
              if (branchSequence !== latestSnapshotRequestByConversation.get(conversationId)) return;
              capture(conversationId, json, { pagination: true });
              return;
            }
            if (requestSequence < latestApplied
              || requestSequence !== latestSnapshotRequestByConversation.get(conversationId)) return;
            if (json?.mapping || Array.isArray(json?.messages)) {
              if (Array.isArray(json.messages) && json.page_info?.has_previous_page) {
                historySources.set(conversationId, {
                  url: requestUrl.href, sequence: requestSequence, pageInfo: json.page_info,
                  messageIds: new Set(json.messages.map(message => message?.id).filter(Boolean)),
                  headers: new Headers(args[1]?.headers ?? input?.headers),
                  credentials: args[1]?.credentials ?? input?.credentials ?? 'same-origin'
                });
              }
              if (capture(conversationId, json)) {
                latestAppliedRequestByConversation.set(conversationId, requestSequence);
                if (requestedHistories.has(conversationId)) void ensureHistory(conversationId);
              }
            }
          }).catch(() => {});
        }).catch(() => {});
      }
    } catch {
      // 捕获失败不能影响 ChatGPT 自身请求。
    }
    return promise;
  };

  document.addEventListener('ait-gpt-user-texts-pull', event => {
    try {
      const conversationId = typeof event.detail === 'string' ? event.detail : '';
      for (const [id, controller] of historyLoads) {
        if (id !== conversationId) { controller.abort(); historyLoads.delete(id); }
      }
      requestedHistories.add(conversationId);
      const bucket = userTextsByConversation.get(conversationId);
      document.dispatchEvent(new CustomEvent('ait-gpt-user-texts-result', {
        // Firefox 跨 world 传对象存在兼容问题，统一使用 JSON 字符串。
        detail: JSON.stringify({
          conversationId,
          texts: bucket ? Object.fromEntries(bucket) : {}
        })
      }));
      void ensureHistory(conversationId);
    } catch {
      document.dispatchEvent(new CustomEvent('ait-gpt-user-texts-result', {
        detail: JSON.stringify({ conversationId: '', texts: null })
      }));
    }
  });
})();
