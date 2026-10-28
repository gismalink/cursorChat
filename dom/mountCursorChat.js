export function mountCursorChat({ getWsUrl, loadUser, subscribeUser, enabled = true }) {
    const MAX_TEXT_LEN = 128;
    const IDLE_HIDE_MS = 5000;
    const SEND_HZ = 20;
    const overlay = document.createElement('div');
    overlay.id = 'live-cursors-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    document.body.appendChild(overlay);

    const selfBubble = document.createElement('div');
    selfBubble.className = 'live-cursor self';
    selfBubble.style.display = 'none';
    const selfName = document.createElement('div');
    selfName.className = 'name';
    const selfText = document.createElement('div');
    selfText.className = 'text';
    const selfInput = document.createElement('textarea');
    selfInput.className = 'input';
    selfInput.maxLength = MAX_TEXT_LEN;
    selfInput.placeholder = '/ to type, esc to close';
    selfInput.autocomplete = 'off';
    selfInput.spellcheck = false;
    selfInput.rows = 1;

    function autosizeInput() {
        // Auto-grow textarea to fit content line-by-line (starts as 1 line).
        selfInput.style.height = 'auto';
        const next = Math.max(32, selfInput.scrollHeight);
        selfInput.style.height = `${next}px`;
    }

    selfBubble.appendChild(selfName);
    selfBubble.appendChild(selfText);
    selfBubble.appendChild(selfInput);
    overlay.appendChild(selfBubble);

    // User doesn't need to see their own name, only others.
    selfName.style.display = 'none';

    let ws = null;
    let selfId = null;
    let selfUsername = null;

    let pointerX01 = 0.5;
    let pointerY01 = 0.5;
    let pointerSeen = false;

    let visible = document.visibilityState === 'visible';

    let editorOpen = false;
    let lastEditAt = 0;
    let fadeTimer = 0;

    const otherEls = new Map();

    function ensureOtherEl(id) {
        let el = otherEls.get(id);
        if (el) return el;

        const root = document.createElement('div');
        root.className = 'live-cursor other';

        const name = document.createElement('div');
        name.className = 'name';

        const text = document.createElement('div');
        text.className = 'text';

        root.appendChild(name);
        root.appendChild(text);
        overlay.appendChild(root);

        el = { root, name, text };
        otherEls.set(id, el);
        return el;
    }

    function cleanupOthers(activeIds) {
        for (const [id, el] of otherEls.entries()) {
            if (activeIds.has(id)) continue;
            el.root.remove();
            otherEls.delete(id);
        }
    }

    function setSelfVisible(v) {
        selfBubble.style.display = v ? '' : 'none';
    }

    function setEditorOpen(v) {
        editorOpen = v;
        if (fadeTimer) {
            clearTimeout(fadeTimer);
            fadeTimer = 0;
        }

        if (v) {
            // Allow sending state even if the user hasn't moved the pointer yet.
            pointerSeen = true;
            selfText.style.display = 'none';
            selfInput.style.display = '';
            selfBubble.classList.remove('fade');
            selfInput.value = '';
            autosizeInput();
            selfInput.focus({ preventScroll: true });
            lastEditAt = performance.now();
            setSelfVisible(true);
        } else {
            selfInput.blur();
            selfInput.style.display = 'none';
            selfText.style.display = 'none';
            selfBubble.classList.remove('fade');
            selfInput.style.height = '32px';
        }

        pushStateSoon();
    }

    function scheduleFadeOut() {
        if (fadeTimer) clearTimeout(fadeTimer);
        fadeTimer = window.setTimeout(() => {
            if (!editorOpen) return;
            // Start fade.
            selfBubble.classList.add('fade');

            // After transition, close editor.
            window.setTimeout(() => {
                if (!editorOpen) return;
                setEditorOpen(false);
            }, 380);
        }, IDLE_HIDE_MS);
    }

    function clamp01(n) {
        if (!Number.isFinite(n)) return 0;
        if (n < 0) return 0;
        if (n > 1) return 1;
        return n;
    }

    function onPointerMove(e) {
        const w = Math.max(1, document.documentElement.clientWidth);
        const h = Math.max(1, document.documentElement.clientHeight);
        pointerX01 = clamp01(e.clientX / w);
        pointerY01 = clamp01(e.clientY / h);
        pointerSeen = true;

        // Position local bubble even if not connected (pre-position).
        placeBubble(selfBubble, pointerX01, pointerY01);
        pushStateSoon();
    }

    function placeBubble(root, x01, y01) {
        const w = Math.max(1, document.documentElement.clientWidth);
        const h = Math.max(1, document.documentElement.clientHeight);

        const x = x01 * w;
        const y = y01 * h;

        // Anchor at exact pointer location; CSS positions name/text around this anchor.
        root.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }

    function isTypingTarget(el) {
        if (!el) return false;
        const tag = (el.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || el.isContentEditable;
    }

    function onKeyDown(e) {
        if (e.key === 'Escape' && editorOpen) {
            e.preventDefault();
            setEditorOpen(false);
            return;
        }

        if (!enabled || e.key !== '/') return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (isTypingTarget(document.activeElement)) return;

        e.preventDefault();

        if (!selfUsername) return; // only for authenticated users
        if (!visible) return;

        // Always open fresh field.
        setEditorOpen(true);
    }

    function onVisibilityChange() {
        visible = document.visibilityState === 'visible';

        if (!visible) {
            // Hide editor immediately when background.
            if (editorOpen) {
                setEditorOpen(false);
            }
        }

        pushStateSoon();
    }

    function connect() {
        if (!selfUsername) return;

        ws = new WebSocket(getWsUrl());

        ws.addEventListener('open', () => {
            ws?.send(JSON.stringify({ type: 'auth', username: selfUsername }));
            pushStateSoon(true);
        });

        ws.addEventListener('message', (evt) => {
            let msg;
            try {
                msg = JSON.parse(String(evt.data || ''));
            } catch {
                return;
            }

            if (!msg || typeof msg.type !== 'string') return;

            if (msg.type === 'hello') {
                selfId = msg.id || null;
                return;
            }

            if (msg.type === 'snapshot') {
                if (!enabled) return;
                const users = Array.isArray(msg.users) ? msg.users : [];
                const activeIds = new Set();

                for (const u of users) {
                    if (!u || !u.id) continue;
                    activeIds.add(u.id);
                    if (u.id === selfId) continue;

                    const el = ensureOtherEl(u.id);
                    el.name.textContent = u.username || 'user';
                    const text = (u.text || '').slice(0, MAX_TEXT_LEN);
                    el.text.textContent = text;
                    el.text.style.display = text ? 'inline-block' : 'none';

                    placeBubble(el.root, clamp01(u.x), clamp01(u.y));
                }

                cleanupOthers(activeIds);
            }
        });

        ws.addEventListener('close', () => {
            ws = null;
            selfId = null;
            // Remove other cursors.
            cleanupOthers(new Set());
            // Try reconnect if still authenticated.
            if (selfUsername) {
                window.setTimeout(connect, 1200);
            }
        });

        ws.addEventListener('error', () => {
            // close handler will retry
        });
    }

    let lastSendAt = 0;
    let sendQueued = false;

    function pushStateSoon(force) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        if (enabled && !pointerSeen && !editorOpen) return;

        const now = performance.now();
        const minInterval = 1000 / SEND_HZ;

        if (force || now - lastSendAt >= minInterval) {
            lastSendAt = now;
            sendState();
            return;
        }

        if (sendQueued) return;
        sendQueued = true;
        window.setTimeout(() => {
            sendQueued = false;
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            lastSendAt = performance.now();
            sendState();
        }, minInterval);
    }

    function sendState() {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        // Self display.
        selfName.textContent = selfUsername || '';
        placeBubble(selfBubble, pointerX01, pointerY01);

        const text = enabled && editorOpen ? selfInput.value : '';
        selfText.textContent = text;
        // Don't show an empty bubble.
        selfText.style.display = 'none';

        setSelfVisible(enabled && Boolean(selfUsername) && visible);

        ws.send(JSON.stringify({
            type: 'state',
            visible: enabled && Boolean(selfUsername) && visible,
            x: pointerX01,
            y: pointerY01,
            text: String(text || '').slice(0, MAX_TEXT_LEN)
        }));
    }

    selfInput.addEventListener('input', () => {
        if (selfInput.value.length > MAX_TEXT_LEN) {
            selfInput.value = selfInput.value.slice(0, MAX_TEXT_LEN);
        }
        autosizeInput();
        lastEditAt = performance.now();
        scheduleFadeOut();
        pushStateSoon(true);
    });

    selfInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            setEditorOpen(false);
            return;
        }

        if (e.key === 'Enter') {
            // Keep it simple: close on Enter.
            e.preventDefault();
            setEditorOpen(false);
            return;
        }
    });

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', onVisibilityChange);

    function setUsername(name) {
        const next = String(name || '').trim();
        if (selfUsername === next) return;
        selfUsername = next;
        if (ws) ws.close();
        else connect();
    }
    const unsubscribeUser = subscribeUser(setUsername);
    loadUser().then(setUsername).catch(() => {});
    return {
        setEnabled(value) {
            enabled = Boolean(value);
            if (!enabled) {
                setEditorOpen(false);
                cleanupOthers(new Set());
                setSelfVisible(false);
                pushStateSoon(true);
            } else pushStateSoon(true);
        },
        destroy() {
            enabled = false;
            selfUsername = null;
            if (ws) ws.close();
            clearTimeout(fadeTimer);
            unsubscribeUser();
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('visibilitychange', onVisibilityChange);
            overlay.remove();
        }
    };
}
