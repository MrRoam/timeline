#!/usr/bin/env node
// Windows: update the checked-out source and reload its unpacked Chrome extension.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

function git(...args) {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0) {
        throw new Error(result.error?.message || result.stderr.trim() || `git ${args[0]} 失败`);
    }
    return result.stdout.trim();
}

function findInstallation(userData, profile) {
    const matches = new Map();
    for (const directory of fs.readdirSync(userData, { withFileTypes: true })) {
        if (!directory.isDirectory() || (profile && directory.name !== profile)) continue;
        for (const filename of ['Preferences', 'Secure Preferences']) {
            let settings;
            try {
                settings = JSON.parse(fs.readFileSync(path.join(userData, directory.name, filename), 'utf8')).extensions?.settings;
            } catch { continue; }
            for (const [id, entry] of Object.entries(settings || {})) {
                if (!/^[a-p]{32}$/.test(id) || !entry.path || entry.location !== 4) continue;
                try {
                    const loadedPath = fs.realpathSync(entry.path);
                    if (loadedPath.toLowerCase() === fs.realpathSync(root).toLowerCase()) {
                        matches.set(`${directory.name}/${id}`, { profile: directory.name, id });
                    }
                } catch { /* An extension from a deleted directory is not this checkout. */ }
            }
        }
    }
    if (matches.size !== 1) {
        throw new Error(matches.size
            ? '多个 Chrome 配置加载了本目录。请运行 update-chrome.cmd --profile "Default"（改为目标配置目录名）。'
            : '未找到从本仓库加载的 Chrome 扩展。请在 chrome://extensions 开启开发者模式并加载本仓库目录。');
    }
    return [...matches.values()][0];
}

async function run(args = process.argv.slice(2)) {
    if (args.includes('--help')) {
        console.log('用法: update-chrome.cmd [--profile "Default"]\n需要 Git、Node.js 和从本仓库加载的 Chrome 扩展。更新会刷新 ChatGPT 页面，请先保存草稿。');
        return;
    }
    if (args.length && (args.length !== 2 || args[0] !== '--profile' || !args[1])) {
        throw new Error('参数无效。运行 update-chrome.cmd --help 查看用法。');
    }
    if (process.platform !== 'win32') throw new Error('此启动脚本用于 Windows Chrome。');
    const chrome = [
        path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    ].find(file => fs.existsSync(file));
    if (!chrome) throw new Error('未找到 Chrome。');
    const userData = path.join(process.env.LOCALAPPDATA, 'Google/Chrome/User Data');
    const installation = findInstallation(userData, args[1]);
    if (git('status', '--porcelain')) throw new Error('工作区有未提交改动。请先提交或自行暂存，再更新。');
    git('rev-parse', '--abbrev-ref', '@{upstream}');
    console.log('正在拉取远端更新……');
    console.log(git('pull', '--ff-only'));
    console.log(`正在重载扩展（Chrome 配置：${installation.profile}）……`);
    const token = crypto.randomBytes(24).toString('hex');
    await new Promise((resolve, reject) => {
        let timer;
        const server = http.createServer((request, response) => {
            const url = new URL(request.url, 'http://127.0.0.1');
            if (url.pathname !== `/done/${token}`) {
                response.writeHead(404).end();
                return;
            }
            const count = Number(url.searchParams.get('refreshed')) || 0;
            const failed = Number(url.searchParams.get('failed')) || 0;
            const message = `Timeline 扩展已重载，已请求刷新 ${count} 个 ChatGPT 标签页。`
                + (failed ? ` ${failed} 个标签页刷新失败，请手动刷新。` : '')
                + (count === 0 ? ' 如果仍有旧页面，请手动刷新。' : '');
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            response.end(`<!doctype html><meta charset="utf-8"><title>Timeline 更新完成</title><p>${message}</p><p>可以关闭此页面。</p>`);
            console.log(message);
            clearTimeout(timer);
            server.close();
            if (failed) reject(new Error('部分标签页刷新失败。')); else resolve();
        });
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const callback = `http://127.0.0.1:${server.address().port}/done/${token}`;
            const url = `chrome-extension://${installation.id}/popup/local-update.html#${callback}`;
            const child = spawn(chrome, [`--profile-directory=${installation.profile}`, url], {
                detached: true, stdio: 'ignore', windowsHide: true,
            });
            child.on('error', error => { clearTimeout(timer); server.close(); reject(error); });
            child.unref();
            timer = setTimeout(() => {
                server.close();
                reject(new Error('Git 已更新，但 60 秒内未收到扩展重载确认。首次使用请在 chrome://extensions 手动重载 Timeline 后重试；并确认已允许扩展访问 ChatGPT。'));
            }, 60000);
        });
    });
}

if (require.main === module) run().catch(error => {
    console.error(`更新失败：${error.message}`);
    process.exitCode = 1;
});
module.exports = { findInstallation, run };
