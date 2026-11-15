/* This page is browser-opened only; it is not a web-accessible resource. */
(async () => {
    try {
        const callback = new URL(location.hash.slice(1));
        if (callback.protocol !== 'http:' || callback.hostname !== '127.0.0.1'
            || !/^\/done\/[a-f0-9]{48}$/.test(callback.pathname)
            || callback.search || callback.username || callback.password) {
            throw new Error('无效的本地更新请求，请通过 update-chrome.cmd 启动。');
        }
        // Existing content scripts identify their own tabs, without the tabs permission.
        const tabs = await chrome.tabs.query({});
        const ids = (await Promise.all(tabs.map(async tab => {
            try {
                const reply = await chrome.tabs.sendMessage(tab.id, { type: 'TIMELINE_LOCAL_UPDATE_PROBE' });
                return reply?.timeline === true ? tab.id : null;
            } catch { return null; }
        }))).filter(Number.isInteger);
        await chrome.storage.local.set({ timelineLocalUpdate: {
            tabIds: ids, callback: callback.href, createdAt: Date.now(),
        } });
        chrome.runtime.reload();
    } catch (error) {
        document.getElementById('status').textContent = `更新未完成：${error.message}`;
    }
})();
