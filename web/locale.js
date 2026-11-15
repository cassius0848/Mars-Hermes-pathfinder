import { english } from './locale-text.js';

// One interface language in pages, workers and offline mission packages.
// Legacy URL parameters and browser language preferences are intentionally ignored.
export const language = 'en';

export function t(message, values) {
  const format = Object.hasOwn(english, message) ? english[message] : message;
  if (!values) return format;
  return format.replace(/\{(\d+)\}/g, (match, index) => {
    if (!(index in values)) return match;
    const value = values[index];
    return typeof value === 'string' ? t(value) : String(value);
  });
}

export function localizeData(data) {
  if (typeof data === 'string') return t(data);
  if (Array.isArray(data)) return data.map(localizeData);
  if (data && typeof data === 'object') {
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, localizeData(value)]));
  }
  return data;
}

export function initLanguage() {
  document.documentElement.lang = 'en';
}
