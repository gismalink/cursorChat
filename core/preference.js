export const cursorChatIcon = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 3l7 16 2-7 7-2z"/><path d="M13 3h7a1 1 0 0 1 1 1v9l-3-2h-3"/></svg>';
export function readEnabled(storage, key = 'cursorChat.enabled') {
    try { return storage.getItem(key) !== 'false'; } catch { return true; }
}
export function saveEnabled(storage, enabled, key = 'cursorChat.enabled') {
    try { storage.setItem(key, String(enabled)); } catch {}
}
