import { useEffect, useId, useRef } from 'react';
import type { useAuth } from './auth.js';
import { Users, X } from './GameIcons.js';
import { FriendsPanel } from './FriendsPanel.js';

/** Native modality keeps focus and touch interactions inside the drawer. */
export function FriendsDrawer({ auth, onClose }: { auth: ReturnType<typeof useAuth>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null),
    surface = useRef<HTMLDivElement>(null),
    onCloseRef = useRef(onClose),
    closing = useRef(false),
    closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    backdropDown = useRef(false),
    headingId = useId();
  onCloseRef.current = onClose;
  useEffect(() => {
    const node = dialog.current,
      panel = surface.current;
    if (!node || !panel) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node.showModal();
    panel.classList.remove('is-closing');
    closing.current = false;
    // Commit the initial pose before opening; there is no ongoing animation loop.
    void panel.offsetWidth;
    panel.classList.add('is-open');
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      panel.classList.remove('is-open', 'is-closing');
      node.close();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  function close() {
    if (closing.current) return;
    closing.current = true;
    const panel = surface.current;
    panel?.classList.remove('is-open');
    panel?.classList.add('is-closing');
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 0
      : parseFloat(getComputedStyle(dialog.current!).getPropertyValue('--modal-close-dur')) || 150;
    closeTimer.current = setTimeout(() => {
      panel?.classList.remove('is-closing');
      dialog.current?.close();
      onCloseRef.current();
    }, duration);
  }
  return (
    <dialog
      ref={dialog}
      className="friends-drawer"
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onPointerDown={(event) => {
        backdropDown.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (backdropDown.current && event.target === event.currentTarget) close();
        backdropDown.current = false;
      }}
    >
      <div ref={surface} className="friends-drawer-surface t-modal">
        <header className="friends-drawer-heading">
          <span className="friends-drawer-emblem" aria-hidden="true">
            <Users size={33} />
          </span>
          <h2 id={headingId}>Friends</h2>
          <button type="button" className="friends-drawer-close" aria-label="Close friends" onClick={close}>
            <X size={24} />
          </button>
        </header>
        <FriendsPanel auth={auth} />
      </div>
    </dialog>
  );
}
