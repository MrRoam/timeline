const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

function flattenContentScriptFiles(kind) {
    return manifest.content_scripts.flatMap(script => script[kind] || []);
}

test('manifest injects multi-platform timeline feature set and preserves retained scope', () => {
    const mainScript = manifest.content_scripts.find(script =>
        script.world !== 'MAIN'
    );
    assert.ok(mainScript, 'should define main isolated content script');
    for (const domain of [
        'https://chatgpt.com/*',
        'https://chat.openai.com/*',
        'https://gemini.google.com/*',
        'https://claude.ai/*',
        'https://chat.deepseek.com/*',
        'https://doubao.com/*',
        'https://grok.com/*',
        'https://kimi.com/*',
        'https://qianwen.com/*',
        'https://chat.qwen.ai/*',
        'https://yiyan.baidu.com/*',
        'https://yuanbao.tencent.com/*',
        'https://perplexity.ai/*',
        'https://poe.com/*',
    ]) {
        assert.ok(mainScript.matches.includes(domain), `${domain} should be matched`);
    }

    const jsFiles = flattenContentScriptFiles('js');
    const cssFiles = flattenContentScriptFiles('css');
    const injectedFiles = [...jsFiles, ...cssFiles];

    const required = [
        'js/apiCapture/chatgpt.js',
        'js/apiCapture/claude.js',
        'js/global/constants.js',
        'js/timeline/adapters/custom-sites.js',
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
        'js/timeline/index.js',
        'js/timeline/question-list/index.js',
        'js/timeline/star-input-modal/star-input-modal.js',
        'js/panelModal/tabs/starred/index.js',
    ];
    for (const file of required) {
        assert.ok(jsFiles.includes(file), `${file} should stay injected`);
        assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} should exist on disk`);
    }

    const ordered = [
        'js/global/constants.js',
        'js/timeline/adapters/custom-sites.js',
        'js/timeline/adapters/base.js',
        'js/timeline/adapters/chatgpt.js',
        'js/timeline/adapters/gemini.js',
        'js/timeline/adapters/claude.js',
        'js/timeline/adapters/custom.js',
        'js/timeline/adapters/registry.js',
        'js/timeline/timeline-manager.js',
        'js/timeline/index.js'
    ];
    for (let index = 1; index < ordered.length; index++) {
        assert.ok(jsFiles.indexOf(ordered[index - 1]) < jsFiles.indexOf(ordered[index]),
            `${ordered[index - 1]} should load before ${ordered[index]}`);
    }

    const chatgptCapture = manifest.content_scripts.find(script =>
        (script.js || []).includes('js/apiCapture/chatgpt.js')
    );
    assert.equal(chatgptCapture?.world, 'MAIN');
    assert.equal(chatgptCapture?.run_at, 'document_start');

    const claudeCapture = manifest.content_scripts.find(script =>
        (script.js || []).includes('js/apiCapture/claude.js')
    );
    assert.equal(claudeCapture?.world, 'MAIN');
    assert.equal(claudeCapture?.run_at, 'document_start');
    assert.ok(claudeCapture?.matches.includes('https://claude.ai/*'));

    const removedFeaturePathParts = [
        'formula/',
        'runner/',
        'smartInputBox/',
        'quickAsk/',
        'highlight/',
        'scrollToBottom/',
        'chat-width-manager',
        'mirrorSite/',
        'notepad/',
        'chat-time-recorder',
        'ai-state-monitor',
        'changelog-modal',
        'sidebarStarred/adapters/',
        'sidebarStarred/sidebar-starred-manager',
    ];
    for (const part of removedFeaturePathParts) {
        assert.equal(
            injectedFiles.some(file => file.includes(part)),
            false,
            `${part} should not be injected`
        );
    }
});

test('manifest exposes platform logos without runner sandbox resources', () => {
    const resources = manifest.web_accessible_resources.flatMap(entry => entry.resources || []);
    assert.ok(resources.includes('images/logo/gemini.webp'));
    assert.ok(resources.includes('images/logo/claude.webp'));
    for (const resource of resources) {
        assert.ok(fs.existsSync(path.join(ROOT, resource)), `${resource} should exist on disk`);
    }
    assert.equal(resources.some(resource => resource.includes('runner/')), false);
    assert.equal('sandbox' in manifest, false);
    assert.equal('content_security_policy' in manifest, false);
});
