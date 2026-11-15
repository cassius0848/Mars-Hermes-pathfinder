import { english, chineseMarkup } from './locale-text.js';

const inPage = typeof document !== 'undefined';
const preferenceKey = 'marth-hermes-language';
function detectLanguage() {
  const requested = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lang') : null;
  if (requested === 'en' || requested === 'zh') return requested;
  if (!inPage) return 'zh';
  try { return localStorage.getItem(preferenceKey) === 'zh' ? 'zh' : 'en'; }
  catch { return 'en'; }
}
export const language = detectLanguage();

export function t(message, values) {
  const format = language === 'en' && Object.hasOwn(english, message) ? english[message] : message;
  if (!values) return format;
  return format.replace(/\{(\d+)\}/g, (match, index) => {
    if (!(index in values)) return match;
    const value = values[index];
    return typeof value === 'string' ? t(value) : String(value);
  });
}

export function localizeData(data) {
  if (language !== 'en') return data;
  if (typeof data === 'string') return t(data);
  if (Array.isArray(data)) return data.map(localizeData);
  if (data && typeof data === 'object') {
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, localizeData(value)]));
  }
  return data;
}

export function initLanguage() {
  if (language === 'zh') {
    document.documentElement.lang = 'zh-CN';
    const translate = text => {
      const key = text.trim();
      return Object.hasOwn(chineseMarkup, key) ? text.replace(key, () => chineseMarkup[key]) : text;
    };
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) node.nodeValue = translate(node.nodeValue);
    for (const element of document.querySelectorAll('[aria-label],[title],[alt],[placeholder],meta[name="description"]')) {
      for (const attr of ['aria-label', 'title', 'alt', 'placeholder', 'content']) {
        if (element.hasAttribute(attr)) element.setAttribute(attr, translate(element.getAttribute(attr)));
      }
    }
  }
  const button = document.querySelector('.language-switch');
  if (!button) return;
  const next = language === 'zh' ? 'en' : 'zh';
  button.lang = next === 'zh' ? 'zh-CN' : 'en';
  button.textContent = next === 'zh' ? '中文' : 'English';
  button.setAttribute('aria-label', next === 'zh' ? '切换为中文' : 'Switch to English');
  button.onclick = () => {
    try { localStorage.setItem(preferenceKey, next); } catch {}
    const url = new URL(location.href);
    url.searchParams.set('lang', next);
    location.assign(url.href);
  };
}

