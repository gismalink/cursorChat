/**
 * useLiveCursors.ts — realtime курсоры участников комнаты/волны с bubble-сообщениями.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
export type PresenceCursorEventPayload = {
  roomId?: string;
  roomSlug?: string;
  userId?: string;
  userName?: string;
  avatarConfig?: Record<string, unknown>;
  x?: number;
  y?: number;
  text?: string;
  visible?: boolean;
  ts?: string;
};



const asTrimmedString = (value: unknown): string => typeof value === "string" ? value.trim() : "";
import {
  minIntervalMsForHz,
  resolvePresenceCursorSendRates
} from "../core/presenceCursorPressure";

const MAX_CURSOR_TEXT_LEN = 128;
const IDLE_HIDE_MS = 5000;
const STALE_PEER_MS = 15000;

export type LiveCursorPeer = {
  userId: string;
  userName: string;
  avatarConfig?: Record<string, unknown>;
  x: number;
  y: number;
  text: string;
  visible: boolean;
  ts: string;
};

type UseLiveCursorsArgs = {
  enabled: boolean;
  connected: boolean;
  roomSlug: string;
  joinedRoomSlug: string;
  roomAudienceSize?: number;
  currentUserId: string;
  currentUserName: string;
  avatarConfig?: Record<string, unknown>;
  sendWsEvent: (
    type: string,
    payload: Record<string, unknown>,
    options?: { maxRetries?: number; trackAck?: boolean }
  ) => void;
};

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

export function useLiveCursors({
  enabled,
  connected,
  roomSlug,
  joinedRoomSlug,
  roomAudienceSize = 1,
  currentUserId,
  currentUserName,
  avatarConfig,
  sendWsEvent
}: UseLiveCursorsArgs) {
  const [peersByUserId, setPeersByUserId] = useState<Record<string, LiveCursorPeer>>({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorText, setEditorText] = useState("");
  const [selfPointer, setSelfPointer] = useState({ x: 0.5, y: 0.5, seen: false });
  const [tabVisible, setTabVisible] = useState(() => (
    typeof document === "undefined" ? true : document.visibilityState === "visible"
  ));

  const sendWsEventRef = useRef(sendWsEvent);
  sendWsEventRef.current = sendWsEvent;
  const editorOpenRef = useRef(editorOpen);
  const editorTextRef = useRef(editorText);
  const selfPointerRef = useRef(selfPointer);
  const tabVisibleRef = useRef(tabVisible);
  const fadeTimerRef = useRef<number | null>(null);
  const lastPointerSendAtRef = useRef(0);
  const lastTextSendAtRef = useRef(0);
  const pointerSendQueuedRef = useRef(false);
  const textSendQueuedRef = useRef(false);
  const roomAudienceSizeRef = useRef(roomAudienceSize);
  const selfPointerPaintRafRef = useRef<number | null>(null);

  useEffect(() => {
    roomAudienceSizeRef.current = Math.max(1, roomAudienceSize);
  }, [roomAudienceSize]);

  useEffect(() => {
    editorOpenRef.current = editorOpen;
  }, [editorOpen]);

  useEffect(() => {
    editorTextRef.current = editorText;
  }, [editorText]);

  useEffect(() => {
    selfPointerRef.current = selfPointer;
  }, [selfPointer]);

  useEffect(() => {
    tabVisibleRef.current = tabVisible;
  }, [tabVisible]);

  const normalizedRoomSlug = asTrimmedString(roomSlug);
  const normalizedJoinedRoomSlug = asTrimmedString(joinedRoomSlug);
  const roomJoinedForCursor = normalizedRoomSlug.length > 0
    && normalizedJoinedRoomSlug === normalizedRoomSlug;
  const active = enabled
    && roomJoinedForCursor
    && asTrimmedString(currentUserId).length > 0
    && connected;

  const activeRef = useRef(active);
  activeRef.current = active;
  const roomRef = useRef(normalizedRoomSlug);
  roomRef.current = normalizedRoomSlug;

  const scheduleSelfPointerPaint = useCallback(() => {
    if (selfPointerPaintRafRef.current !== null) {
      return;
    }

    selfPointerPaintRafRef.current = window.requestAnimationFrame(() => {
      selfPointerPaintRafRef.current = null;
      setSelfPointer({ ...selfPointerRef.current });
    });
  }, []);

  const pushCursorState = useCallback((force = false, kind: "pointer" | "text" = "pointer") => {
    if (!activeRef.current || roomRef.current !== normalizedRoomSlug) {
      return;
    }

    const pointer = selfPointerRef.current;
    if (!pointer.seen && !editorOpenRef.current) {
      return;
    }

    const sendRates = resolvePresenceCursorSendRates(roomAudienceSizeRef.current);
    const hz = kind === "text" ? sendRates.textHz : sendRates.pointerHz;
    const minInterval = minIntervalMsForHz(hz);
    const lastSendAtRef = kind === "text" ? lastTextSendAtRef : lastPointerSendAtRef;
    const sendQueuedRef = kind === "text" ? textSendQueuedRef : pointerSendQueuedRef;

    const now = performance.now();
    if (!force && now - lastSendAtRef.current < minInterval) {
      if (sendQueuedRef.current) {
        return;
      }

      sendQueuedRef.current = true;
      window.setTimeout(() => {
        sendQueuedRef.current = false;
        pushCursorState(true, kind);
      }, minInterval);
      return;
    }

    lastSendAtRef.current = now;
    sendWsEventRef.current("presence.cursor", {
      roomSlug: normalizedRoomSlug,
      x: clampUnit(pointer.x),
      y: clampUnit(pointer.y),
      text: editorOpenRef.current ? editorTextRef.current.slice(0, MAX_CURSOR_TEXT_LEN) : "",
      visible: tabVisibleRef.current
    }, { maxRetries: 0, trackAck: false });
  }, [active, normalizedRoomSlug]);

  const clearFadeTimer = useCallback(() => {
    if (fadeTimerRef.current !== null) {
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
  }, []);

  const scheduleFadeClose = useCallback(() => {
    clearFadeTimer();
    fadeTimerRef.current = window.setTimeout(() => {
      editorTextRef.current = "";
      setEditorOpen(false);
      setEditorText("");
      pushCursorState(true, "pointer");
    }, IDLE_HIDE_MS);
  }, [clearFadeTimer, pushCursorState]);

  const openEditor = useCallback(() => {
    if (!activeRef.current) {
      return;
    }

    clearFadeTimer();
    editorOpenRef.current = true;
    setEditorOpen(true);
    pushCursorState(true);
  }, [active, clearFadeTimer, pushCursorState]);

  const closeEditor = useCallback(() => {
    clearFadeTimer();
    editorOpenRef.current = false;
    editorTextRef.current = "";
    setEditorOpen(false);
    setEditorText("");
    pushCursorState(true);
  }, [clearFadeTimer, pushCursorState]);

  const handlePresenceCursor = useCallback((payload: PresenceCursorEventPayload) => {
    if (!activeRef.current) return;
    const payloadRoomSlug = asTrimmedString(payload.roomSlug);
    if (payloadRoomSlug && payloadRoomSlug !== normalizedRoomSlug) {
      return;
    }

    const userId = asTrimmedString(payload.userId);
    if (!userId || userId === asTrimmedString(currentUserId)) {
      return;
    }

    if (payload.visible === false) {
      setPeersByUserId((prev) => {
        if (!prev[userId]) {
          return prev;
        }

        const next = { ...prev };
        delete next[userId];
        return next;
      });
      return;
    }

    const x = clampUnit(Number(payload.x));
    const y = clampUnit(Number(payload.y));
    const text = typeof payload.text === "string"
      ? payload.text.slice(0, MAX_CURSOR_TEXT_LEN)
      : "";
    const userName = asTrimmedString(payload.userName) || userId;
    const ts = asTrimmedString(payload.ts) || new Date().toISOString();

    setPeersByUserId((prev) => ({
      ...prev,
      [userId]: {
        userId,
        userName,
        avatarConfig: payload.avatarConfig,
        x,
        y,
        text,
        visible: true,
        ts
      }
    }));
  }, [currentUserId, normalizedRoomSlug]);

  useEffect(() => {
    clearFadeTimer();
    editorOpenRef.current = false;
    editorTextRef.current = "";
    setPeersByUserId({});
    setEditorOpen(false);
    setEditorText("");
    pushCursorState(true);
  }, [normalizedRoomSlug, pushCursorState, clearFadeTimer]);

  useEffect(() => {
    if (!active) return;
    return () => {
      sendWsEventRef.current("presence.cursor", { roomSlug: normalizedRoomSlug, x: 0, y: 0, text: "", visible: false }, { maxRetries: 0, trackAck: false });
    };
  }, [active, normalizedRoomSlug]);

  useEffect(() => {
    if (!active) {
      editorOpenRef.current = false;
      editorTextRef.current = "";
      setPeersByUserId({});
      setEditorOpen(false);
      setEditorText("");
      return undefined;
    }

    const onPointerMove = (event: PointerEvent) => {
      const width = window.innerWidth || 1;
      const height = window.innerHeight || 1;
      selfPointerRef.current = {
        x: event.clientX / width,
        y: event.clientY / height,
        seen: true
      };
      scheduleSelfPointerPaint();
      pushCursorState();
    };

    const onVisibilityChange = () => {
      const nextVisible = document.visibilityState === "visible";
      tabVisibleRef.current = nextVisible;
      setTabVisible(nextVisible);
      if (!nextVisible) {
        closeEditor();
      }
      pushCursorState(true, "pointer");
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (isEditableTarget(event.target)) {
          return;
        }

        event.preventDefault();
        openEditor();
        return;
      }

      if (event.key === "Escape" && editorOpenRef.current) {
        event.preventDefault();
        closeEditor();
      }
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("keydown", onKeyDown);
      if (selfPointerPaintRafRef.current !== null) {
        window.cancelAnimationFrame(selfPointerPaintRafRef.current);
        selfPointerPaintRafRef.current = null;
      }
    };
  }, [active, closeEditor, openEditor, pushCursorState, scheduleSelfPointerPaint]);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      const cutoff = Date.now() - STALE_PEER_MS;
      setPeersByUserId((prev) => {
        let changed = false;
        const next: Record<string, LiveCursorPeer> = {};

        Object.entries(prev).forEach(([userId, peer]) => {
          const ts = Date.parse(peer.ts);
          if (Number.isFinite(ts) && ts >= cutoff) {
            next[userId] = peer;
          } else {
            changed = true;
          }
        });

        return changed ? next : prev;
      });
    }, 3000);

    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => () => clearFadeTimer(), [clearFadeTimer]);

  const peers = useMemo(() => Object.values(peersByUserId), [peersByUserId]);

  const onEditorTextChange = useCallback((value: string) => {
    const next = value.slice(0, MAX_CURSOR_TEXT_LEN);
    editorTextRef.current = next;
    setEditorText(next);
    scheduleFadeClose();
    pushCursorState(true, "text");
  }, [pushCursorState, scheduleFadeClose]);

  const onEditorBlur = useCallback(() => {
    scheduleFadeClose();
  }, [scheduleFadeClose]);

  const onEditorFocus = useCallback(() => {
    clearFadeTimer();
  }, [clearFadeTimer]);

  const onEditorKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      closeEditor();
    }
  }, [closeEditor]);

  return {
    active,
    peers,
    selfBubble: {
      open: editorOpen,
      text: editorText,
      userName: asTrimmedString(currentUserName) || "you",
      avatarConfig,
      x: selfPointer.x,
      y: selfPointer.y,
      visible: tabVisible && (selfPointer.seen || editorOpen)
    },
    onEditorTextChange,
    onEditorBlur,
    onEditorFocus,
    onEditorKeyDown,
    closeEditor,
    handlePresenceCursor
  };
}
