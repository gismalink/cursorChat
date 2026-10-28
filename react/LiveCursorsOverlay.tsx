/**
 * LiveCursorsOverlay.tsx — плавающие курсоры участников комнаты с bubble-сообщениями.
 */
import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { LiveCursorPeer } from "./useLiveCursors";


type LiveCursorSelfBubble = {
  open: boolean;
  text: string;
  userName: string;
  avatarConfig?: Record<string, unknown>;
  x: number;
  y: number;
  visible: boolean;
};

type LiveCursorsOverlayProps = {
  active: boolean;
  peers: LiveCursorPeer[];
  selfBubble: LiveCursorSelfBubble;
  editorPlaceholder: string;
  onEditorTextChange: (value: string) => void;
  onEditorBlur: () => void;
  onEditorFocus: () => void;
  onEditorKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
};

function placeBubbleStyle(x: number, y: number): CSSProperties {
  const width = typeof window !== "undefined" ? window.innerWidth : 1;
  const height = typeof window !== "undefined" ? window.innerHeight : 1;

  return {
    transform: `translate(${Math.round(x * width)}px, ${Math.round(y * height)}px)`
  };
}

function LiveCursorBubble({
  userName,
  avatarConfig,
  text,
  isSelf,
  editorOpen,
  editorText,
  editorPlaceholder,
  onEditorTextChange,
  onEditorBlur,
  onEditorFocus,
  onEditorKeyDown,
  textareaRef
}: {
  userName: string;
  avatarConfig?: Record<string, unknown>;
  text: string;
  isSelf: boolean;
  editorOpen?: boolean;
  editorText?: string;
  editorPlaceholder?: string;
  onEditorTextChange?: (value: string) => void;
  onEditorBlur?: () => void;
  onEditorFocus?: () => void;
  onEditorKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const showText = !isSelf && Boolean(text.trim());

  return (
    <div className={`live-cursor-bubble ${isSelf ? "is-self" : "is-peer"}`.trim()}>
      {!isSelf ? <span className="live-cursor-pointer" aria-hidden="true" /> : null}
      {!isSelf ? (
        <div className="live-cursor-nameplate">
          <span className="live-cursor-avatar">{userName.slice(0, 1)}</span>
          <span className="live-cursor-name">{userName}</span>
        </div>
      ) : null}
      {showText ? (
        <div className="live-cursor-text">{text}</div>
      ) : null}
      {isSelf && editorOpen ? (
        <textarea
          data-agent-id="live-cursor.editor"
          data-agent-state="editing"
          ref={textareaRef}
          className="live-cursor-input"
          value={editorText}
          placeholder={editorPlaceholder}
          rows={1}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => onEditorTextChange?.(event.currentTarget.value)}
          onBlur={() => onEditorBlur?.()}
          onFocus={() => onEditorFocus?.()}
          onKeyDown={onEditorKeyDown}
        />
      ) : null}
    </div>
  );
}

export function LiveCursorsOverlay({
  active,
  peers,
  selfBubble,
  editorPlaceholder,
  onEditorTextChange,
  onEditorBlur,
  onEditorFocus,
  onEditorKeyDown
}: LiveCursorsOverlayProps) {
  const selfTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!selfBubble.open) {
      return;
    }

    const element = selfTextareaRef.current;
    if (!element) {
      return;
    }

    element.focus();
    element.style.height = "auto";
    element.style.height = `${Math.max(34, element.scrollHeight)}px`;
    element.scrollTop = 0;
  }, [selfBubble.open, selfBubble.text]);

  if (!active || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="live-cursors-overlay" aria-hidden="true">
      {peers.map((peer) => (
        <div
          key={peer.userId}
          className="live-cursor-root is-peer"
          style={placeBubbleStyle(peer.x, peer.y)}
        >
          <LiveCursorBubble
            userName={peer.userName}
            avatarConfig={peer.avatarConfig}
            text={peer.text}
            isSelf={false}
          />
        </div>
      ))}
      {selfBubble.open ? (
        <div
          className="live-cursor-root is-self"
          style={placeBubbleStyle(selfBubble.x, selfBubble.y)}
        >
          <LiveCursorBubble
            userName={selfBubble.userName}
            avatarConfig={selfBubble.avatarConfig}
            text={selfBubble.text}
            isSelf
            editorOpen={selfBubble.open}
            editorText={selfBubble.text}
            editorPlaceholder={editorPlaceholder}
            onEditorTextChange={onEditorTextChange}
            onEditorBlur={onEditorBlur}
            onEditorFocus={onEditorFocus}
            onEditorKeyDown={onEditorKeyDown}
            textareaRef={selfTextareaRef}
          />
        </div>
      ) : null}
    </div>,
    document.body
  );
}
