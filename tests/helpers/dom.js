// 最小 DOM 测试夹具：覆盖本项目使用的标签、类名和属性选择器，无生产依赖。
class Element {
    constructor(tag, { text = '', attrs = {}, rect = null } = {}) {
        this.tagName = tag.toUpperCase();
        this.nodeType = 1;
        this.parentElement = null;
        this.children = [];
        this.attributes = new Map(Object.entries(attrs));
        this._text = text;
        this._rect = rect || { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
        this.style = {};
        this.offsetHeight = 0;
    }

    append(...elements) {
        elements.forEach(element => { element.parentElement = this; this.children.push(element); });
        return this;
    }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(text) { this._text = text; this.children = []; }
    get childNodes() { return this.children; }
    get childElementCount() { return this.children.length; }
    get isConnected() { return this.tagName === 'BODY' || !!this.parentElement?.isConnected; }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    getBoundingClientRect() { return this._rect; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    matches(selectors) {
        return selectors.split(',').some(selector => {
            const value = selector.trim();
            const tag = value.match(/^[\w-]+/);
            if (tag && this.tagName.toLowerCase() !== tag[0].toLowerCase()) return false;
            const classes = [...value.matchAll(/\.([\w-]+)/g)];
            const ownClasses = (this.getAttribute('class') || '').split(/\s+/);
            if (classes.some(([, name]) => !ownClasses.includes(name))) return false;
            const attrs = [...value.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
            return attrs.every(([, name, expected]) => this.hasAttribute(name)
                && (expected === undefined || this.getAttribute(name) === expected));
        });
    }
    closest(selector) {
        let node = this;
        while (node) {
            if (node.matches(selector)) return node;
            node = node.parentElement;
        }
        return null;
    }
    querySelectorAll(selector) {
        const result = [];
        const walk = node => node.children.forEach(child => {
            if (child.matches(selector)) result.push(child);
            walk(child);
        });
        walk(this);
        return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    cloneNode(deep) {
        const clone = new Element(this.tagName, { text: this._text, attrs: Object.fromEntries(this.attributes) });
        if (deep) clone.append(...this.children.map(child => child.cloneNode(true)));
        return clone;
    }
    remove() {
        if (this.parentElement) {
            this.parentElement.children = this.parentElement.children.filter(child => child !== this);
            this.parentElement = null;
        }
    }
}

class Document {
    constructor() {
        this.body = new Element('body');
        this.listeners = new Map();
    }
    querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
    querySelector(selector) { return this.body.querySelector(selector); }
    getElementById(id) { return this.querySelector(`[id="${id}"]`); }
    addEventListener(type, handler) {
        const handlers = this.listeners.get(type) || new Set();
        handlers.add(handler);
        this.listeners.set(type, handlers);
    }
    removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
    dispatchEvent(event) {
        [...(this.listeners.get(event.type) || [])].forEach(handler => handler(event));
        return true;
    }
}

module.exports = { Element, Document };
