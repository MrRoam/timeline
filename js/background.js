/**
 * Background Service Worker
 *
 * Retained responsibility:
 * - Open the in-page panel on supported ChatGPT tabs.
 * - Fall back to the guide page when the current tab is unsupported.
 */

const SUPPORTED_DOMAINS = ['chatgpt.com', 'chat.openai.com'];

// Top-level startup also runs after runtime.reload(), unlike runtime.onStartup.
async function finishLocalUpdate() {
    const { timelineLocalUpdate: pending } = await chrome.storage.local.get('timelineLocalUpdate');
    if (!pending) return;
    await chrome.storage.local.remove('timelineLocalUpdate');
    if (!Number.isFinite(pending.createdAt) || Date.now() - pending.createdAt > 60000
        || pending.createdAt > Date.now() || !Array.isArray(pending.tabIds)) return;
    const callback = new URL(pending.callback);
    if (callback.protocol !== 'http:' || callback.hostname !== '127.0.0.1'
        || !/^\/done\/[a-f0-9]{48}$/.test(callback.pathname)
        || callback.search || callback.username || callback.password) return;
    const results = await Promise.all(pending.tabIds.filter(Number.isInteger).map(async id => {
        try { await chrome.tabs.reload(id); return true; } catch { return false; }
    }));
    callback.searchParams.set('refreshed', String(results.filter(Boolean).length));
    callback.searchParams.set('failed', String(results.filter(result => !result).length));
    // Browser navigation reports completion without adding localhost host permissions.
    await chrome.tabs.create({ url: callback.href });
}

finishLocalUpdate().catch(error => console.error('Timeline local update failed:', error));

function isSupportedSite(url) {
    try {
        const hostname = new URL(url).hostname;
        return SUPPORTED_DOMAINS.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
    } catch {
        return false;
    }
}

chrome.action.onClicked.addListener(async (tab) => {
    if (tab?.url && isSupportedSite(tab.url)) {
        try {
            await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_PANEL_MODAL' });
            return;
        } catch {}
    }

    chrome.tabs.create({ url: chrome.runtime.getURL('popup/guide.html') });
});
