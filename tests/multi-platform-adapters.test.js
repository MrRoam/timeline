const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { Element, Document } = require('./helpers/dom');

const ROOT = path.join(__dirname, '..');

function loadMultiPlatformEnv({ url = 'https://gemini.google.com/app/abc123', document = new Document() } = {}) {
    const parsed = new URL(url);
    const location = {
        href: parsed.href,
        origin: parsed.origin,
        hostname: parsed.hostname,
        pathname: parsed.pathname,
        search: parsed.search,
        hash: parsed.hash,
    };
    const context = {
        console,
        document,
        location,
        URL,
        URLSearchParams,
        Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
        CustomEvent: class {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail;
            }
        },
        CSS: { escape: value => String(value) },
        window: null,
        getComputedStyle: element => ({ display: 'block', visibility: 'visible', opacity: '1', overflowY: 'visible', ...element.style }),
        innerHeight: 900,
        innerWidth: 1440,
        chrome: {
            runtime: { getURL: p => p },
            storage: {
                local: { get: async () => ({}) },
                onChanged: { addListener() {} },
            },
        },
        MutationObserver: class {
            observe() {}
            disconnect() {}
        },
        ResizeObserver: class {
            observe() {}
            disconnect() {}
        },
        IntersectionObserver: class {
            observe() {}
            disconnect() {}
        },
        TIMELINE_CONFIG: { DEBOUNCE_DELAY: 350, ZERO_TURNS_TIMER: 300 },
        TimelineUtils: { clearTimerSafe: () => null },
        setTimeout: () => 0,
        clearTimeout() {},
        requestAnimationFrame: () => 0,
    };
    context.window = context;
    context.location = location;
    vm.createContext(context);

    const files = [
        'js/global/constants.js',
        'js/timeline/adapters/custom-sites.js',
        'js/timeline/container-finder.js',
        'js/timeline/adapters/base.js',
        'js/timeline/adapters/chatgpt.js',
        'js/timeline/adapters/gemini.js',
        'js/timeline/adapters/claude.js',
        'js/timeline/adapters/deepseek.js',
        'js/timeline/adapters/doubao.js',
        'js/timeline/adapters/grok.js',
        'js/timeline/adapters/kimi.js',
        'js/timeline/adapters/perplexity.js',
        'js/timeline/adapters/qwen.js',
        'js/timeline/adapters/tongyi.js',
        'js/timeline/adapters/yiyan.js',
        'js/timeline/adapters/yuanbao.js',
        'js/timeline/adapters/notebooklm.js',
        'js/timeline/adapters/custom.js',
        'js/timeline/adapters/registry.js',
        'js/timeline/timeline-manager.js',
    ];
    for (const file of files) {
        vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
    }
    vm.runInContext('this.SiteAdapterRegistry = SiteAdapterRegistry; this.TimelineManager = TimelineManager;', context);
    return { context, location };
}

test('SiteAdapterRegistry detects ChatGPT, Gemini, Claude, DeepSeek, Doubao, Grok, Kimi, Qwen, Tongyi, Yiyan, Yuanbao, Perplexity and Poe', async () => {
    const cases = [
        ['https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc', 'chatgpt'],
        ['https://gemini.google.com/app/abc123', 'gemini'],
        ['https://claude.ai/chat/12345678-1234-1234-1234-123456789abc', 'claude'],
        ['https://chat.deepseek.com/a/chat/s/abc123', 'deepseek'],
        ['https://www.doubao.com/chat/123456', 'doubao'],
        ['https://grok.com/c/abc123', 'grok'],
        ['https://www.kimi.com/chat/abc123', 'kimi'],
        ['https://www.qianwen.com/chat/abc123', 'tongyi'],
        ['https://chat.qwen.ai/c/abc123', 'qwen'],
        ['https://yiyan.baidu.com/chat/123', 'yiyan'],
        ['https://yuanbao.tencent.com/chat/bot/abc123', 'yuanbao'],
        ['https://www.perplexity.ai/search/abc123', 'perplexity'],
        ['https://poe.com/chat/abc123', 'custom-poe-com'],
    ];

    for (const [url, expectedId] of cases) {
        const { context, location } = loadMultiPlatformEnv({ url });
        const registry = new context.SiteAdapterRegistry();
        await registry.loadCustomAdapters();
        const adapter = await registry.detectAdapter();
        assert.ok(adapter, `Expected adapter for ${url}`);
        assert.equal(adapter.id || adapter.platformId, expectedId, `Expected ${expectedId} for ${url}`);
        assert.equal(adapter.isConversationRoute(location.pathname), true, `Expected conversation route for ${url}`);
    }
});

test('GeminiAdapter recognizes user-query messages, extracts text ignoring Angular comments, and refreshes updated marker text', async () => {
    const document = new Document();
    const scroller = new Element('div');
    scroller.style.overflowY = 'auto';
    const turnWrap = new Element('div', { attrs: { id: 'turn-1' } });
    turnWrap.id = 'turn-1';
    const query = new Element('user-query');
    const line = new Element('div', { attrs: { class: 'query-text-line' } });
    const textNode = { nodeType: 3, textContent: 'Gemini 测试问题' };
    Object.defineProperty(line, 'childNodes', { value: [{ nodeType: 8, textContent: 'ng-comment' }, textNode] });
    query.append(line);
    turnWrap.append(query);
    scroller.append(turnWrap);
    document.body.append(scroller);

    const { context } = loadMultiPlatformEnv({
        url: 'https://gemini.google.com/app/conv-1',
        document,
    });
    const registry = new context.SiteAdapterRegistry();
    await registry.loadCustomAdapters();
    const adapter = await registry.detectAdapter();

    assert.equal(adapter.platformId, 'gemini');
    assert.equal(adapter.extractConversationId('/app/conv-1'), 'conv-1');
    assert.equal(adapter.generateTurnId(query, 0), 'gemini-turn-1');
    assert.equal(adapter.extractText(query), 'Gemini 测试问题');
    assert.equal(adapter.observesTimelineMarkerText(), true);

    const manager = new context.TimelineManager(adapter);
    for (const name of [
        'injectToggleButton', 'updateTimelineHeight', 'updateTimelineGeometry',
        'syncTimelineTrackToMain', 'updateVirtualRangeAndRender', 'updateActiveDotUI',
        'scheduleScrollSync', 'updateIntersectionObserverTargets', 'setupDomCheckObserver',
        '_captureAutoBottomJumpCandidate'
    ]) {
        manager[name] = () => {};
    }
    manager.handleInitialNavigationOrRestore = async () => false;
    manager.ui.timelineBar = manager.ui.trackContent = new Element('div');
    manager.conversationContainer = scroller;
    manager.scrollContainer = scroller;
    manager.recalculateAndRenderMarkers();

    assert.equal(manager.markers.length, 1);
    assert.equal(manager.markers[0].id, 'gemini-turn-1');
    assert.equal(manager.markers[0].summary, 'Gemini 测试问题');

    // Gemini 编辑或延迟填充提问文本时应同步刷新摘要。
    textNode.textContent = 'Gemini 更新后的问题';
    manager.recalculateAndRenderMarkers();
    assert.equal(manager.markers[0].summary, 'Gemini 更新后的问题');
});
