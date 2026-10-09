const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadEntry({ pathname = '/', enabled = true, hasTurns = false, failFirst = false } = {}) {
    const state = { enabled, hasTurns, attempts: 0, destroyed: 0, readiness: null, unsubscribed: 0 };
    const events = new Map();
    const adapter = {
        prepareTimelineNodes() {},
        getUserMessageSelector: () => '.user-message',
        isConversationRoute: pathname => pathname.startsWith('/c/')
    };
    const location = { pathname, href: `https://chatgpt.com${pathname}` };
    const context = {
        location, console,
        document: { querySelector: selector => selector === '.user-message' && state.hasTurns ? {} : null },
        window: {
            addEventListener: (type, handler) => events.set(type, handler),
            removeEventListener: (type, handler) => { if (events.get(type) === handler) events.delete(type); },
            DOMObserverManager: { getInstance: () => ({ subscribeBody: (_, options) => {
                state.readiness = options.callback;
                return () => { state.unsubscribed++; };
            } }) }
        },
        chrome: { storage: {
            local: { get: async () => ({ timelinePlatformSettings: { chatgpt: state.enabled } }) },
            onChanged: { addListener() {} }
        } },
        getCurrentPlatform: async () => ({ id: 'chatgpt', features: { timeline: true } }),
        SiteAdapterRegistry: class {
            async detectAdapter() { return adapter; }
            async loadCustomAdapters() {}
            async isSupportedSite() { return true; }
        },
        TimelineManager: class {
            constructor() { this.conversationContainer = { isConnected: true }; }
            async init() { state.attempts++; return !(failFirst && state.attempts === 1); }
            destroy() { state.destroyed++; }
            ensureContainersUpToDate() { this.conversationContainer.isConnected = true; }
        },
        TimelineUtils: {
            removeEventListenerSafe: (target, type, handler) => target.removeEventListener(type, handler),
            removeElementSafe() {}
        },
        TIMELINE_CONFIG: { INIT_RETRY_DELAYS: [0, 0] },
        setTimeout: callback => { callback(); return 0; }
    };
    vm.createContext(context);
    const source = fs.readFileSync(path.join(__dirname, '..', 'js/timeline/index.js'), 'utf8');
    vm.runInContext(source + '\nthis.entry = { handleUrlChange, canInitialize, manager: () => timelineManagerInstance };', context);
    return { state, events, location, entry: context.entry };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('timeline starts route monitoring on the homepage before any message exists', async () => {
    const { state, events, location, entry } = loadEntry();
    await settle();
    assert(events.has('url:change'));
    assert.equal(state.attempts, 0);
    state.hasTurns = true;
    Object.assign(location, { pathname: '/c/first', href: 'https://chatgpt.com/c/first' });
    await entry.handleUrlChange();
    await settle();
    assert.equal(state.attempts, 1);
    assert(entry.manager());
});

test('timeline recovers when conversation content arrives after retries, including the next route', async () => {
    const { state, location, entry } = loadEntry({ pathname: '/c/slow' });
    await settle();
    assert.equal(state.attempts, 0);
    state.hasTurns = true;
    state.readiness();
    await settle();
    assert.equal(state.attempts, 1);
    state.hasTurns = false;
    Object.assign(location, { pathname: '/c/next', href: 'https://chatgpt.com/c/next' });
    await entry.handleUrlChange();
    await settle();
    assert.equal(entry.manager(), null);
    assert.equal(state.unsubscribed, 0);
    state.hasTurns = true;
    state.readiness();
    await settle();
    assert.equal(state.attempts, 2);
    assert(entry.manager());
    entry.manager().conversationContainer.isConnected = false;
    state.readiness();
    assert(entry.manager().conversationContainer.isConnected);
});

test('timeline retries a failed initialization without treating found messages as success', async () => {
    const { state, entry } = loadEntry({ pathname: '/c/test', hasTurns: true, failFirst: true });
    await settle();
    assert.equal(state.attempts, 2);
    assert.equal(state.destroyed, 1);
    assert(entry.manager());
});

test('DOM changes detect chat navigation without a url:change event and replace the connected old timeline', async () => {
    const { state, location, entry } = loadEntry({ pathname: '/c/first', hasTurns: true });
    await settle();
    const oldManager = entry.manager();
    assert(oldManager.conversationContainer.isConnected);

    Object.assign(location, { pathname: '/c/second', href: 'https://chatgpt.com/c/second' });
    state.readiness();
    await settle();

    assert.equal(state.destroyed, 1);
    assert.equal(state.attempts, 2);
    assert(entry.manager());
    assert.notEqual(entry.manager(), oldManager);

    // 延迟到达的轮询事件不应重复销毁刚创建的实例。
    await entry.handleUrlChange();
    assert.equal(state.destroyed, 1);
    assert.equal(state.attempts, 2);
});

test('DOM route detection clears the old timeline while the next chat loads and recovers on arrival', async () => {
    const { state, location, entry } = loadEntry({ pathname: '/c/first', hasTurns: true });
    await settle();
    state.hasTurns = false;
    Object.assign(location, { pathname: '/c/slow', href: 'https://chatgpt.com/c/slow' });
    state.readiness();
    await settle();
    assert.equal(entry.manager(), null);
    assert.equal(state.destroyed, 1);

    state.hasTurns = true;
    state.readiness();
    await settle();
    assert.equal(state.attempts, 2);
    assert(entry.manager());

    Object.assign(location, { pathname: '/', href: 'https://chatgpt.com/' });
    state.readiness();
    await settle();
    assert.equal(entry.manager(), null);
    assert.equal(state.destroyed, 2);
});

test('disabled timeline still observes routes and waits for the platform to be enabled', async () => {
    const { state, events, entry } = loadEntry({ pathname: '/c/test', hasTurns: true, enabled: false });
    await settle();
    assert(events.has('url:change'));
    assert.equal(state.attempts, 0);
    state.enabled = true;
    state.readiness();
    await settle();
    assert.equal(state.attempts, 1);
    assert(entry.manager());
});
