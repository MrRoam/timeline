const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { findInstallation } = require('../scripts/update-chrome');
const root = path.resolve(__dirname, '..');
const callback = `http://127.0.0.1:12345/done/${'a'.repeat(48)}`;

test('profile discovery selects this unpacked checkout and rejects ambiguous profiles', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-update-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const id = 'a'.repeat(32);
    for (const profile of ['Default', 'Profile 1']) {
        fs.mkdirSync(path.join(dir, profile));
        fs.writeFileSync(path.join(dir, profile, 'Secure Preferences'), JSON.stringify({
            extensions: { settings: { [id]: { path: root, location: 4 } } },
        }));
    }
    assert.throws(() => findInstallation(dir), /多个 Chrome/);
    assert.deepEqual(findInstallation(dir, 'Default'), { profile: 'Default', id });
    assert.throws(() => findInstallation(dir, 'Missing'), /未找到/);
});

async function background(pending, failId) {
    const reloaded = [], opened = [], removed = [];
    const context = {
        URL, Date, console,
        chrome: {
            storage: { local: {
                get: async () => ({ timelineLocalUpdate: pending }),
                remove: async key => removed.push(key),
            } },
            tabs: {
                reload: async id => { if (id === failId) throw new Error('closed'); reloaded.push(id); },
                create: async tab => opened.push(tab.url),
            },
            action: { onClicked: { addListener() {} } },
        },
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'js/background.js'), 'utf8'), context);
    await new Promise(resolve => setImmediate(resolve));
    return { reloaded, opened, removed };
}

test('reload recovery consumes saved request, refreshes only saved tabs and reports failures', async () => {
    const result = await background({ callback, tabIds: [7, 9], createdAt: Date.now() }, 9);
    assert.deepEqual(result.reloaded, [7]);
    assert.deepEqual(result.removed, ['timelineLocalUpdate']);
    const url = new URL(result.opened[0]);
    assert.equal(url.searchParams.get('refreshed'), '1');
    assert.equal(url.searchParams.get('failed'), '1');
});

test('normal startup and stale or external callbacks never refresh tabs', async () => {
    for (const pending of [undefined,
        { callback, tabIds: [7], createdAt: Date.now() - 61000 },
        { callback: callback.replace('127.0.0.1', 'example.com'), tabIds: [7], createdAt: Date.now() },
    ]) {
        const result = await background(pending);
        assert.deepEqual(result.reloaded, []);
        assert.deepEqual(result.opened, []);
    }
});

test('update page saves identified tabs before reloading extension without opening panels', async () => {
    const calls = [];
    const context = {
        URL, Date, location: { hash: `#${callback}` },
        document: { getElementById: () => ({}) },
        chrome: {
            tabs: {
                query: async () => [{ id: 3 }, { id: 4 }],
                sendMessage: async (id, message) => {
                    assert.equal(message.type, 'TIMELINE_LOCAL_UPDATE_PROBE');
                    if (id === 4) throw new Error('no content script');
                    return { timeline: true };
                },
            },
            storage: { local: { set: async data => calls.push(data) } },
            runtime: { reload: () => calls.push('reload') },
        },
    };
    await vm.runInNewContext(fs.readFileSync(path.join(root, 'popup/local-update.js'), 'utf8'), context);
    assert.deepEqual(Array.from(calls[0].timelineLocalUpdate.tabIds), [3]);
    assert.equal(calls[0].timelineLocalUpdate.callback, callback);
    assert.equal(calls[1], 'reload');
});
