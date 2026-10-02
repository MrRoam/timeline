const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { Element, Document } = require('./helpers/dom');

function loadChatGPTAdapter(document) {
    const baseSource = fs.readFileSync(
        path.join(__dirname, '..', 'js', 'timeline', 'adapters', 'base.js'),
        'utf8'
    );
    const adapterSource = fs.readFileSync(
        path.join(__dirname, '..', 'js', 'timeline', 'adapters', 'chatgpt.js'),
        'utf8'
    );
    const context = {
        document,
        location: { pathname: '/c/12345678-1234-1234-1234-123456789abc' },
        CustomEvent: class {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail;
            }
        },
        matchesPlatform: () => true,
        ContainerFinder: { findConversationContainer: () => null },
        window: { getComputedStyle: element => ({ display: 'contents', visibility: 'visible', position: 'static', ...element.style }) },
        console,
    };
    vm.createContext(context);
    vm.runInContext(
        `${baseSource}\n${adapterSource}\nthis.ChatGPTAdapter = ChatGPTAdapter;`,
        context
    );
    return new context.ChatGPTAdapter();
}

function makeTurn(id, { role = null, text = '' } = {}) {
    const attributes = new Map([
        ['data-turn-id-container', id],
        ['data-is-intersecting', 'false'],
    ]);
    return {
        childElementCount: role || text ? 1 : 0,
        getAttribute(name) {
            return attributes.get(name) ?? null;
        },
        setAttribute(name, value) {
            attributes.set(name, String(value));
        },
        hasAttribute(name) {
            return attributes.has(name);
        },
        removeAttribute(name) {
            attributes.delete(name);
        },
        querySelector(selector) {
            if (selector === '[data-turn]' && role) {
                return { getAttribute: name => name === 'data-turn' ? role : null };
            }
            if (selector === '.whitespace-pre-wrap' && text) {
                return { textContent: text };
            }
            return null;
        },
    };
}

test('ChatGPT virtualized shells produce every user turn before scrolling', () => {
    const turns = [
        makeTurn('u1'),
        makeTurn('a1'),
        makeTurn('u2'),
        makeTurn('a2'),
        makeTurn('u3', { role: 'user', text: '第三个问题' }),
        makeTurn('a3', { role: 'assistant' }),
    ];
    const document = {
        querySelectorAll(selector) {
            if (selector === '[data-turn-id-container][data-is-intersecting]') return turns;
            if (selector === '[data-turn-id-container][data-ait-turn="user"]') {
                return turns.filter(turn => turn.getAttribute('data-ait-turn') === 'user');
            }
            return [];
        },
        querySelector(selector) {
            return this.querySelectorAll(selector)[0] || null;
        },
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {},
    };
    const adapter = loadChatGPTAdapter(document);

    assert.equal(adapter.prepareTimelineNodes({ force: true }), true);
    assert.equal(
        adapter.getUserMessageSelector(),
        '[data-turn-id-container][data-ait-turn="user"]'
    );
    const userTurns = document.querySelectorAll(adapter.getUserMessageSelector());
    assert.deepEqual(
        userTurns.map(turn => turn.getAttribute('data-turn-id-container')),
        ['u1', 'u2', 'u3']
    );
    assert.equal(adapter.extractText(turns[0]), '[未加载的提问]');
    assert.equal(adapter.extractText(turns[4]), '第三个问题');
});

class EventDocument {
    constructor() {
        this.listeners = new Map();
    }

    addEventListener(type, handler, options = {}) {
        const listeners = this.listeners.get(type) || [];
        listeners.push({ handler, once: options.once === true });
        this.listeners.set(type, listeners);
    }

    removeEventListener(type, handler) {
        const listeners = this.listeners.get(type) || [];
        this.listeners.set(type, listeners.filter(item => item.handler !== handler));
    }

    dispatchEvent(event) {
        const listeners = [...(this.listeners.get(event.type) || [])];
        listeners.forEach(item => {
            item.handler(event);
            if (item.once) this.removeEventListener(event.type, item.handler);
        });
        return true;
    }
}

test('ChatGPT API capture exposes all user texts from the active conversation branch', async () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'js', 'apiCapture', 'chatgpt.js'),
        'utf8'
    );
    const conversationId = '12345678-1234-1234-1234-123456789abc';
    const mapping = {
        u1: {
            id: 'u1',
            parent: null,
            children: ['a1'],
            message: {
                author: { role: 'user' },
                recipient: 'all',
                content: { content_type: 'text', parts: ['第一个问题'] },
            },
        },
        a1: {
            id: 'a1',
            parent: 'u1',
            children: ['u2'],
            message: {
                author: { role: 'assistant' },
                recipient: 'all',
                content: { content_type: 'text', parts: ['回答'] },
            },
        },
        u2: {
            id: 'u2',
            parent: 'a1',
            children: [],
            message: {
                author: { role: 'user' },
                recipient: 'all',
                content: { content_type: 'multimodal_text', parts: ['第二个', '问题'] },
            },
        },
    };
    const document = new EventDocument();
    const response = {
        ok: true,
        clone: () => ({ json: async () => ({ mapping, current_node: 'u2' }) }),
    };
    const window = { fetch: async () => response };
    const context = {
        window,
        document,
        CustomEvent: class {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail;
            }
        },
        Map,
        Object,
        String,
        URL,
        location: { href: 'https://chatgpt.com/', origin: 'https://chatgpt.com' },
    };
    vm.createContext(context);
    vm.runInContext(source, context);

    await window.fetch(`https://chatgpt.com/backend-api/conversation/${conversationId}`);
    await new Promise(resolve => setImmediate(resolve));

    let payload = null;
    document.addEventListener('ait-gpt-user-texts-result', event => {
        payload = JSON.parse(event.detail);
    });
    document.dispatchEvent(new context.CustomEvent('ait-gpt-user-texts-pull', {
        detail: conversationId,
    }));

    assert.equal(payload.conversationId, conversationId);
    assert.deepEqual(payload.texts, {
        u1: '第一个问题',
        u2: '第二个 问题',
    });
});

function headingFixture() {
    const document = new Document();
    const main = new Element('main');
    const turns = new Element('div');
    document.body.append(main.append(turns));
    const add = (role, text, wrapped = false) => {
        const element = new Element('section');
        const heading = new Element('h4', { text: role, attrs: { class: 'sr-only' } });
        const body = new Element('div', { text });
        element.append(wrapped ? new Element('div').append(heading) : heading, body,
            new Element('button', { text: 'Copy' }));
        turns.append(element);
        return { element, heading, body };
    };
    return { document, main, turns, add };
}

test('ChatGPT new UI initializes from role headings and excludes composer and answer content', () => {
    const { document, main, add } = headingFixture();
    const first = add('You said:', '第一个问题');
    const answer = add('ChatGPT said:', '回答', true);
    const second = add('你说：', '第二个问题', true);
    main.append(new Element('form').append(new Element('h4', { text: 'You said:', attrs: { class: 'sr-only' } }), new Element('textarea')));
    answer.body.append(new Element('div', { attrs: { class: 'markdown' } })
        .append(new Element('h4', { text: 'You said:', attrs: { class: 'sr-only' } }), new Element('div', { text: '引用内容' })));
    const adapter = loadChatGPTAdapter(document);
    adapter.prepareTimelineNodes({ force: true });
    assert.equal(adapter.getUserMessageSelector(), '[data-ait-heading-turn="user"]');
    assert.deepEqual(document.querySelectorAll(adapter.getUserMessageSelector()), [first.element, second.element]);
    assert.deepEqual(document.querySelectorAll(adapter.getAssistantMessageSelector()), [answer.element]);
    assert.equal(adapter.extractText(first.element), '第一个问题');
    assert.equal(adapter.extractText(second.element), '第二个问题');
    assert.equal(adapter.generateTurnId(first.element, 0), 'chatgpt-0');
    second.heading.textContent = 'ChatGPT said:';
    adapter.invalidateTimelineNodes();
    adapter.prepareTimelineNodes();
    assert.equal(document.querySelectorAll(adapter.getUserMessageSelector()).length, 1);
    first.heading.textContent = 'Unknown:';
    adapter.prepareTimelineNodes({ force: true });
    assert.equal(first.element.hasAttribute('data-ait-heading-turn'), false);
});

test('ChatGPT keeps legacy message IDs when both legacy and new UI structures exist', () => {
    const { document, turns, add } = headingFixture();
    add('You said:', '新结构');
    const legacy = new Element('article', { attrs: { 'data-turn': 'user', 'data-turn-id': 'old-id' } });
    legacy.append(new Element('div', { text: '旧结构', attrs: { class: 'whitespace-pre-wrap' } }));
    turns.append(legacy);
    const adapter = loadChatGPTAdapter(document);
    adapter.prepareTimelineNodes({ force: true });
    assert.equal(adapter.getUserMessageSelector(), '[data-turn="user"][data-turn-id]');
    assert.equal(adapter.generateTurnId(legacy, 0), 'chatgpt-old-id');
    assert.equal(adapter.extractText(legacy), '旧结构');
});

test('ChatGPT retries a missed API snapshot and matches full unique questions without guessing duplicate IDs', () => {
    const { document, add } = headingFixture();
    const text = '很长的提问'.repeat(60);
    const first = add('You said:', `${text}甲`);
    const second = add('You said:', `${text}乙`);
    const adapter = loadChatGPTAdapter(document);
    adapter.prepareTimelineNodes({ force: true });
    adapter.syncCapturedChatsData(); // 首次读取时接口尚未到达。
    let texts = { u1: `${text}甲`, u2: `${text}乙` };
    document.addEventListener('ait-gpt-user-texts-pull', event => {
        document.dispatchEvent({ type: 'ait-gpt-user-texts-result', detail: JSON.stringify({ conversationId: event.detail, texts }) });
    });
    adapter.syncCapturedChatsData(); // 更新事件落在旧实例与新实例之间。
    assert.equal(adapter.generateTurnId(first.element, 0), 'chatgpt-u1');
    assert.equal(adapter.generateTurnId(second.element, 1), 'chatgpt-u2');
    const updates = [];
    const unsubscribe = adapter.subscribeCapturedChatsDataUpdated(detail => updates.push(detail));
    texts = { ...texts, other: `${text}甲` };
    document.dispatchEvent({ type: 'ait-gpt-user-texts-updated', detail: '12345678-1234-1234-1234-123456789abc' });
    assert.equal(updates[0].rebuildMarkers, true);
    assert.equal(adapter.generateTurnId(first.element, 0), 'chatgpt-0');
    texts = { u1: `${text}甲`, u2: `${text}乙` };
    adapter.handleCapturedChatsDataUpdated('12345678-1234-1234-1234-123456789abc');
    const duplicate = add('You said:', `${text}甲`);
    adapter.prepareTimelineNodes({ force: true });
    assert.equal(adapter.generateTurnId(first.element, 0), 'chatgpt-0');
    duplicate.element.remove();
    unsubscribe();
    const count = updates.length;
    document.dispatchEvent({ type: 'ait-gpt-user-texts-updated', detail: 'different-conversation' });
    assert.equal(updates.length, count);
    adapter._textCacheConvId = 'previous-conversation';
    texts = {};
    adapter.syncCapturedChatsData();
    assert.equal(adapter._capturedMatchTexts.size, 0);
    assert.equal(adapter._turnTextCache.size, 0);
});

function loadCapture(document, fetch) {
    const window = { fetch };
    const context = { window, document, URL,
        location: { href: 'https://chatgpt.com/c/test', origin: 'https://chatgpt.com' },
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } } };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/apiCapture/chatgpt.js'), 'utf8'), context);
    return window;
}

test('ChatGPT captures new conversations messages from URL and Request inputs, including voice text', async () => {
    const document = new Document();
    const id = '12345678-1234-1234-1234-123456789abc';
    const messages = [{ id: 'u1', author: { role: 'user' }, content: { content_type: 'multimodal_text', parts: [
        { content_type: 'audio_transcription', text: '语音提问' }, { asset_pointer: 'image' }, '补充文字'
    ] } }, { id: 'a1', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['回答'] } }];
    const response = { ok: true, clone: () => ({ json: async () => ({ messages }) }) };
    const window = loadCapture(document, async () => response);
    let payload;
    document.addEventListener('ait-gpt-user-texts-result', event => { payload = JSON.parse(event.detail); });
    for (const input of [new URL(`https://chatgpt.com/backend-api/conversations/${id}?x=1`),
        { url: `/backend-api/conversations/${id}`, method: 'GET' }]) {
        assert.equal(await window.fetch(input), response);
        await new Promise(resolve => setImmediate(resolve));
        document.dispatchEvent({ type: 'ait-gpt-user-texts-pull', detail: id });
        assert.deepEqual(payload.texts, { u1: '语音提问 补充文字' });
    }
});

test('ChatGPT capture ignores foreign origins, POST streams, subresources and failed responses', async () => {
    const document = new Document();
    const id = '12345678-1234-1234-1234-123456789abc';
    let clones = 0;
    const response = { ok: true, clone: () => { clones++; return { json: async () => ({ messages: [] }) }; } };
    const promise = Promise.resolve(response);
    const window = loadCapture(document, () => promise);
    for (const [input, init] of [
        [`https://example.com/backend-api/conversation/${id}`],
        [`/backend-api/conversations/${id}`, { method: 'POST' }],
        [{ url: `/backend-api/conversations/${id}`, method: 'POST' }],
        [`/backend-api/conversations/${id}/messages`],
        ['/backend-api/conversation']
    ]) assert.equal(window.fetch(input, init), promise);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(clones, 0);
    const failed = loadCapture(new Document(), async () => ({ ...response, ok: false }));
    await failed.fetch(`/backend-api/conversations/${id}`);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(clones, 0);
});

test('ChatGPT capture preserves the latest successful snapshot when responses arrive out of order', async () => {
    const document = new Document();
    const id = '12345678-1234-1234-1234-123456789abc';
    const resolvers = [];
    const window = loadCapture(document, () => new Promise(resolve => resolvers.push(resolve)));
    const makeResponse = text => ({ ok: true, clone: () => ({ json: async () => ({ messages: [
        { id: 'u1', author: { role: 'user' }, content: { content_type: 'text', parts: [text] } }
    ] }) }) });
    window.fetch(`/backend-api/conversations/${id}`);
    window.fetch(`/backend-api/conversations/${id}`);
    resolvers[1](makeResponse('新分支'));
    await new Promise(resolve => setImmediate(resolve));
    resolvers[0](makeResponse('旧分支'));
    await new Promise(resolve => setImmediate(resolve));
    let texts;
    document.addEventListener('ait-gpt-user-texts-result', event => { texts = JSON.parse(event.detail).texts; });
    document.dispatchEvent({ type: 'ait-gpt-user-texts-pull', detail: id });
    assert.deepEqual(texts, { u1: '新分支' });
});

test('ChatGPT zero-box new UI messages use body geometry for positions, highlight and navigation', () => {
    const { document, add } = headingFixture();
    const adapter = loadChatGPTAdapter(document);
    const frames = [];
    const context = { window: {}, document, console,
        TIMELINE_CONFIG: { MIN_ACTIVE_CHANGE_INTERVAL: 0 },
        requestAnimationFrame: callback => { frames.push(callback); return frames.length; } };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/timeline/timeline-manager.js'), 'utf8')
        + '\nthis.Manager = TimelineManager;', context);
    const manager = Object.create(context.Manager.prototype);
    const positions = [100, 600, 1300, 2500, 4200, 7000];
    const rect = (top, height, width = 500) => ({ top, bottom: top + height, left: 10, right: 10 + width, width, height });
    const scroll = { scrollTop: 0, getBoundingClientRect: () => rect(50, 665) };
    const elements = positions.map((_, index) => {
        const { element, body, heading } = add('You said:', `问题 ${index}`);
        const nested = new Element('div');
        body.remove();
        element.append(nested.append(body));
        body.getBoundingClientRect = () => rect(50 + positions[index] - scroll.scrollTop, 80);
        heading._rect = rect(-9999, 1);
        element.querySelector('button')._rect = rect(99999, 30);
        return element;
    });
    adapter.prepareTimelineNodes({ force: true });
    Object.assign(manager, { adapter, scrollContainer: scroll,
        markers: elements.map((element, index) => ({ element, id: String(index) })),
        _getCleanScrollMetrics: () => ({ maxScrollTop: 10000 }),
        debouncedUpdateScrollPadding() {}, updateTimelineGeometry() {}, updateActiveDotUI() {}, _emitActiveChange() {},
        ACTIVATE_AHEAD: 120, lastActiveChangeTime: -Infinity });
    manager._recalcMarkerPositions();
    assert.deepEqual(Array.from(manager.markers, marker => marker.offsetTop), positions);
    assert.equal(manager.contentSpanPx, 6900);
    assert.equal(manager.markers[5].visualN, 1);
    assert(manager.markers.every(marker => marker.offsetBottom - marker.offsetTop === 80));
    scroll.scrollTop = 2400;
    manager._recalcMarkerPositions();
    assert.deepEqual(Array.from(manager.markers, marker => marker.offsetTop), positions);
    manager.computeActiveByScroll();
    assert.equal(manager.activeTurnId, '3');
    positions[5] = 9000;
    manager._recalcMarkerPositions();
    assert.equal(manager.contentSpanPx, 8900);
    manager.smoothScrollTo(elements[5], 600);
    frames.shift()(0);
    frames.shift()(600);
    assert.equal(scroll.scrollTop, 8980);
    const legacy = new Element('article', { rect: rect(321, 77) });
    legacy.offsetHeight = 78;
    assert.equal(manager._getMessageRect(legacy).top, 321);
    assert.equal(manager._getMessageHeight(legacy), 78);
    assert.equal(manager.mutationTouchesUserTurns([{ type: 'characterData', target: { parentElement: elements[0].querySelector('h4') } }]), true);
    assert.equal(manager.mutationTouchesUserTurns([{ type: 'characterData', target: { parentElement: elements[0].querySelector('div') } }]), false);
});
