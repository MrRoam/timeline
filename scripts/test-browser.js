#!/usr/bin/env node
// Real Chromium layout/observer regressions. No project dependencies are required.
// Usage: node scripts/test-browser.js [--serve | --routes-only]
// Set TIMELINE_TEST_CHROME to select a Chrome/Chromium executable.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const fixture = fs.readFileSync(path.join(root, 'tests/browser/scroll-fixture.html'), 'utf8');
const content = manifest.content_scripts.find(entry => entry.run_at === 'document_idle');
const runtimeFiles = new Set([...content.js, ...content.css,
    ...manifest.web_accessible_resources.flatMap(entry => entry.resources)]);
const session = `timeline-regression-${process.pid}`;
const scripts = content.js.map(file => `${file.endsWith('/index.js') && file === 'js/timeline/index.js'
    ? '<script>getCurrentPlatform = async () => getPlatformById("chatgpt"); matchesPlatform = async () => true;</script>' : ''}<script src="/${file}"></script>`).join('\n');
const styles = content.css.map(file => `<link rel="stylesheet" href="/${file}">`).join('\n');
const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname.startsWith('/c/') || pathname.startsWith('/uc/')) {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(fixture.replace('<!-- STYLES -->', styles).replace('<!-- SCRIPTS -->', scripts));
        return;
    }
    const file = path.resolve(root, `.${decodeURIComponent(pathname)}`);
    if (!runtimeFiles.has(pathname.slice(1)) || !file.startsWith(root + path.sep)
        || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        response.writeHead(404).end();
        return;
    }
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
    response.end(fs.readFileSync(file));
});

function browser(...args) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.env.AGENT_BROWSER_BIN || 'agent-browser', ['--session', session, ...args], { windowsHide: true });
        let output = '';
        child.stdout.on('data', chunk => { output += chunk; });
        child.stderr.on('data', chunk => { output += chunk; });
        child.on('error', reject);
        child.on('exit', code => code === 0 ? resolve(output.trim()) : reject(new Error(output.trim())));
    });
}

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/c/12345678-1234-1234-1234-123456789abc`;
    console.log(`Browser fixture: ${url}`);
    if (process.argv.includes('--serve')) return;
    try {
        const launch = process.env.TIMELINE_TEST_CHROME ? ['--executable-path', process.env.TIMELINE_TEST_CHROME] : [];
        console.log(await browser(...launch, 'open', url));
        for (const mode of ['legacy', 'heading', 'print', 'virtual', 'native', 'document']) {
            const suites = process.argv.includes('--routes-only') ? ['runRouteRegressions']
                : ['runScrollRegressions', 'runRouteRegressions'];
            for (const suite of suites) {
                await browser('open', `${mode === 'native' ? url.replace('/c/', '/uc/') : url}?mode=${mode}`);
                await browser('wait', '--fn', 'typeof timelineManagerInstance !== "undefined" && timelineManagerInstance?.markers.length === 12');
                const output = await browser('eval', '-b', Buffer.from(`${suite}()`).toString('base64'));
                const results = JSON.parse(output);
                for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${mode}: ${result.name} ${JSON.stringify(result.detail)}`);
                if (results.some(result => !result.pass)) process.exitCode = 1;
                const errors = await browser('errors');
                if (errors) { console.error(errors); process.exitCode = 1; }
            }
        }
    } finally {
        await browser('close').catch(error => console.error(error.message));
        server.closeAllConnections();
        server.close();
    }
})().catch(error => { console.error(error.message); server.close(); process.exitCode = 1; });
