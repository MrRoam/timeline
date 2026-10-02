#!/usr/bin/env node

/**
 * 按 manifest.json 打包当前启用的 Chrome 扩展，并更新 dist/chrome-unpacked。
 * 仅包含运行文件、语言包、图标、引导页和许可证，避免把旧 dist 或开发文件打进包。
 * 用法：node scripts/build-chrome.js（需要 zip 命令）
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
if (!/^\d+(?:\.\d+){0,3}$/.test(manifest.version)) throw new Error('扩展版本号无效');

const files = new Set(['manifest.json', 'LICENSE']);
const addFile = relative => {
    const absolute = path.resolve(ROOT, relative);
    if (!absolute.startsWith(ROOT + path.sep) || !fs.statSync(absolute).isFile()) {
        throw new Error(`扩展运行文件无效：${relative}`);
    }
    files.add(path.relative(ROOT, absolute).replace(/\\/g, '/'));
};
const addDirectory = relative => {
    for (const entry of fs.readdirSync(path.join(ROOT, relative), { withFileTypes: true })) {
        const child = path.join(relative, entry.name);
        if (entry.isDirectory()) addDirectory(child);
        else addFile(child);
    }
};

if (manifest.background?.service_worker) addFile(manifest.background.service_worker);
Object.values(manifest.icons || {}).forEach(addFile);
for (const script of manifest.content_scripts || []) {
    [...(script.js || []), ...(script.css || [])].forEach(addFile);
}
for (const entry of manifest.web_accessible_resources || []) entry.resources.forEach(addFile);
['_locales', 'popup', 'images/logo'].forEach(addDirectory);

const zipPath = path.join(ROOT, `AIChatTimeline-v${manifest.version}-chrome.zip`);
const unpackedPath = path.join(ROOT, 'dist', 'chrome-unpacked');
// 固定且已验证的输出路径；仅删除将要重新生成的 ZIP，不递归删除现有目录。
if (path.dirname(zipPath) !== ROOT) throw new Error('打包路径超出项目目录');
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execFileSync('zip', ['-q', zipPath, ...files], { cwd: ROOT, stdio: 'pipe' });
execFileSync('zip', ['-T', zipPath], { cwd: ROOT, stdio: 'pipe' });

for (const file of files) {
    const target = path.join(unpackedPath, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, file), target);
}
console.log(`[Chrome Build] Version: ${manifest.version}`);
console.log(`[Chrome Build] Packaged: ${path.basename(zipPath)} (${files.size} files)`);
console.log(`[Chrome Build] Updated: ${unpackedPath}`);
