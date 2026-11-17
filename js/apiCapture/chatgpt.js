// ChatGPT 对话接口拦截 —— MAIN world / document_start
//
// 新版 ChatGPT 会卸载视口外轮次的 DOM 与 React 子树。页面本身仍会请求完整
// conversation mapping 或分页 messages；捕获页面请求，优先尝试单次完整快照，
// 否则按游标补齐历史，输出当前分支的完整提问列表与 id → 文本映射。
(() => {
  'use strict';
  if (window.__aitGptApiCapture) return;
  window.__aitGptApiCapture = true;

  const userTextsByConversation = new Map();
  const latestAppliedRequestByConversation = new Map();
  const latestSnapshotRequestByConversation = new Map();
  const timelineEntriesByConversation = new Map();
  const sectionedSources = new Map();
  const historyLoads = new Map();
  const requestedHistories = new Set();
  let nextRequestSequence = 0;

  const emitHistoryLoading = conversationId => {
    document.dispatchEvent(new CustomEvent('ait-gpt-history-loading', {
      detail: JSON.stringify({ conversationId, loading: historyLoads.has(conversationId) })
    }));
  };

  const beginSnapshotRequest = conversationId => {
    const sequence = ++nextRequestSequence;
    latestSnapshotRequestByConversation.set(conversationId, sequence);
    const previousLoad = historyLoads.get(conversationId);
    previousLoad?.abort();
    historyLoads.delete(conversationId);
    if (previousLoad) emitHistoryLoading(conversationId);
    // 新快照可能切换了分支，旧 source 的游标不能再用于补齐历史。
    sectionedSources.delete(conversationId);
    return sequence;
  };

  const replaceTexts = (conversationId, texts) => {
    if (!conversationId) return;
    userTextsByConversation.set(conversationId, new Map(Object.entries(texts)));
  };

  const mergeTexts = (conversationId, texts) => {
    const bucket = userTextsByConversation.get(conversationId) || new Map();
    // 较旧分页不能覆盖已经捕获的较新消息文本。
    Object.entries(texts).forEach(([id, text]) => { if (!bucket.has(id)) bucket.set(id, text); });
    userTextsByConversation.set(conversationId, bucket);
  };

  const isVisibleType = message => {
    const contentType = message?.content?.content_type;
    return contentType === 'text' || contentType === 'multimodal_text';
  };
  const isForUser = message => !message?.recipient || message.recipient === 'all';
  const isModelAuthored = message => !message?.author?.name;

  const textFromPart = part => {
    if (typeof part === 'string') return part;
    if (part && typeof part === 'object' && typeof part.text === 'string') return part.text;
    return '';
  };

  const textFromMessage = message => {
    try {
      const content = message?.content;
      if (!content || /thought|reason/i.test(content.content_type || '')) return '';
      if (!Array.isArray(content.parts)) return '';
      return content.parts.map(textFromPart).filter(Boolean).join('\n').trim();
    } catch {
      return '';
    }
  };

  const userEntries = messages => messages
    .filter(message => message?.id && message.author?.role === 'user'
      && !message.metadata?.is_visually_hidden_from_conversation && isForUser(message))
    .map(message => ({
      id: message.id,
      text: textFromMessage(message).replace(/\s+/g, ' ').trim().slice(0, 200) || '[图片或文件]'
    }));

  const linearize = json => {
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

  const publishEntries = (conversationId, entries, complete, requestSequence) => {
    if (latestSnapshotRequestByConversation.get(conversationId) !== requestSequence
      || latestAppliedRequestByConversation.get(conversationId) !== requestSequence) return;
    timelineEntriesByConversation.set(conversationId, {
      entries,
      complete,
      revision: requestSequence
    });
    replaceTexts(conversationId, Object.fromEntries(entries.map(entry => [entry.id, entry.text])));
    notify(conversationId);
  };

  const isCurrentConversation = id => (location.pathname || '').split('/').includes(id);

  // 历史请求沿用页面请求的认证头，仅在时间轴请求数据后启动；不修改页面响应。
  const ensureFullHistory = async conversationId => {
    const source = sectionedSources.get(conversationId);
    if (!isCurrentConversation(conversationId) || !source || source.failed || historyLoads.has(conversationId)
      || latestSnapshotRequestByConversation.get(conversationId) !== source.requestSequence
      || timelineEntriesByConversation.get(conversationId)?.complete) return;
    const controller = new AbortController();
    historyLoads.set(conversationId, controller);
    // 等同步拉取返回后再通知，避免状态被外层尚未处理的桥接结果覆盖。
    Promise.resolve().then(() => emitHistoryLoading(conversationId));
    const isCurrent = () => !controller.signal.aborted
      && sectionedSources.get(conversationId) === source
      && latestSnapshotRequestByConversation.get(conversationId) === source.requestSequence
      && isCurrentConversation(conversationId);
    const read = async url => {
      const response = await originalFetch.call(window, url.href, {
        headers: source.headers, credentials: source.credentials, signal: controller.signal
      });
      if (!response?.ok) throw new Error(`History HTTP ${response?.status}`);
      return response.json();
    };
    try {
      // 兼容仍提供完整 mapping 的服务端，优先一份快照，避免逐页请求。
      try {
        const fullUrl = new URL(`/backend-api/conversation/${encodeURIComponent(conversationId)}`, location.origin);
        const full = await read(fullUrl);
        if (!isCurrent()) return;
        if (full?.mapping && full.mapping[full.current_node]) {
          const chain = linearize(full);
          if (chain.length < 10000 && !(chain[0]?.parent && !full.mapping[chain[0].parent])) {
            publishEntries(
              conversationId,
              userEntries(chain.filter(node => node.message).map(node => ({ ...node.message, id: node.id }))),
              true,
              source.requestSequence
            );
            return;
          }
        }
      } catch {
        if (!isCurrent()) return;
      }
      let page = source.json;
      let messages = [...page.messages];
      const seenCursors = new Set();
      for (let pageIndex = 0; page.page_info?.has_previous_page; pageIndex++) {
        if (!isCurrent()) return;
        const cursor = page.page_info.start_cursor;
        if (!cursor || seenCursors.has(cursor) || pageIndex >= 200) throw new Error('History pagination made no progress');
        seenCursors.add(cursor);
        const url = new URL(source.url);
        url.searchParams.set('num_turns', '100');
        url.searchParams.set('before', cursor);
        const previous = await read(url);
        if (!isCurrent()) return;
        if (!Array.isArray(previous?.messages)) throw new Error('History response has no messages');
        const known = new Set(messages.map(message => message.id));
        const older = previous.messages.filter(message => message.id && !known.has(message.id));
        if (!older.length) throw new Error('History pagination returned no older messages');
        messages = [...older, ...messages];
        page = previous;
        publishEntries(conversationId, userEntries(messages), page.page_info?.has_previous_page === false, source.requestSequence);
      }
    } catch {
      // 保留已读数据；失败不在每次几何刷新时重试，下一份页面快照可重新启动。
      source.failed = true;
    } finally {
      if (historyLoads.get(conversationId) === controller) {
        historyLoads.delete(conversationId);
        emitHistoryLoading(conversationId);
      }
    }
  };

  const captureMapping = (conversationId, json, requestSequence) => {
    try {
      if (!json?.mapping) return false;
      if (latestSnapshotRequestByConversation.get(conversationId) !== requestSequence) return false;
      const texts = parseUserTexts(json);
      latestAppliedRequestByConversation.set(conversationId, requestSequence);
      replaceTexts(conversationId, texts);
      const chain = linearize(json);
      timelineEntriesByConversation.set(conversationId, {
        entries: userEntries(chain.filter(node => node.message).map(node => ({ ...node.message, id: node.id }))),
        revision: json.current_node || '',
        complete: chain.length < 10000 && !(chain[0]?.parent && !json.mapping[chain[0].parent])
      });
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
        args[1]?.method || (typeof input === 'object' ? input?.method : '') || 'GET'
      ).toUpperCase();
      const requestUrl = new URL(rawUrl, location.href);
      const match = requestUrl.origin === location.origin
        && requestUrl.pathname.match(CONVERSATION_URL_RE);
      if (match && method === 'GET') {
        const conversationId = match[1];
        const isPagination = requestUrl.searchParams.has('before') || requestUrl.searchParams.has('cursor');
        const branchSequence = latestSnapshotRequestByConversation.get(conversationId);
        if (isPagination && branchSequence !== undefined) {
          // 页面自身分页只补未缓存的历史文本，不能替换分支快照或打断扩展的历史补齐。
          promise.then(response => {
            if (!response?.ok) return;
            response.clone().json().then(json => {
              if (branchSequence !== latestSnapshotRequestByConversation.get(conversationId)) return;
              if (!json?.mapping && !Array.isArray(json?.messages)) return;
              mergeTexts(conversationId, parseUserTexts(json));
              notify(conversationId);
            }).catch(() => {});
          }).catch(() => {});
          return promise;
        }
        const headers = typeof Headers !== 'undefined'
          ? new Headers(args[1]?.headers ?? input?.headers)
          : (args[1]?.headers ?? input?.headers);
        const credentials = args[1]?.credentials ?? input?.credentials ?? 'same-origin';
        const requestSequence = beginSnapshotRequest(conversationId);
        promise.then(response => {
          if (!response?.ok) return;
          response.clone().json().then(json => {
            if (latestSnapshotRequestByConversation.get(conversationId) !== requestSequence) return;
            if (json?.mapping) {
              captureMapping(conversationId, json, requestSequence);
              return;
            }
            if (Array.isArray(json?.messages)) {
              latestAppliedRequestByConversation.set(conversationId, requestSequence);
              sectionedSources.set(conversationId, {
                url: requestUrl.href, headers, credentials, json, requestSequence
              });
              const entries = userEntries(json.messages);
              publishEntries(conversationId, entries, json.page_info?.has_previous_page === false, requestSequence);
              if (requestedHistories.has(conversationId)) void ensureFullHistory(conversationId);
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
      const request = typeof event.detail === 'string' && event.detail.startsWith('{')
        ? JSON.parse(event.detail) : { conversationId: event.detail };
      const conversationId = typeof request.conversationId === 'string' ? request.conversationId : '';
      if (request.restartHistory === true) {
        // 显式重试必须结束旧请求，否则网络悬挂时会一直被 already-loading 拦住。
        historyLoads.get(conversationId)?.abort();
        historyLoads.delete(conversationId);
        const source = sectionedSources.get(conversationId);
        if (source) source.failed = false;
      }
      for (const [id, controller] of historyLoads) {
        if (id !== conversationId) {
          controller.abort();
          historyLoads.delete(id);
          emitHistoryLoading(id);
        }
      }
      requestedHistories.clear();
      requestedHistories.add(conversationId);
      const bucket = userTextsByConversation.get(conversationId);
      document.dispatchEvent(new CustomEvent('ait-gpt-user-texts-result', {
        // Firefox 跨 world 传对象存在兼容问题，统一使用 JSON 字符串。
        detail: JSON.stringify({
          conversationId,
          texts: bucket ? Object.fromEntries(bucket) : {},
          timeline: timelineEntriesByConversation.get(conversationId) || null,
          historyLoading: historyLoads.has(conversationId)
        })
      }));
      void ensureFullHistory(conversationId);
    } catch {
      document.dispatchEvent(new CustomEvent('ait-gpt-user-texts-result', {
        detail: JSON.stringify({ conversationId: '', texts: null })
      }));
    }
  });
})();
