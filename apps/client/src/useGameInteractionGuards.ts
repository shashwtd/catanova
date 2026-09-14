import { useEffect } from 'react';

/** Stop browser selection/drag artifacts without interfering with controls or board gestures. */
export function useGameInteractionGuards() {
  useEffect(() => {
    const prevent = (event: Event) => {
      const target =
        event.target instanceof Element
          ? event.target
          : event.target instanceof Node
            ? event.target.parentElement
            : null;
      if (!(target instanceof Element) || !target.closest('.game-world.playing')) return;
      if (target.closest('input, textarea, [contenteditable="true"], [role="textbox"]')) return;
      event.preventDefault();
    };
    document.addEventListener('selectstart', prevent);
    document.addEventListener('dragstart', prevent);
    return () => {
      document.removeEventListener('selectstart', prevent);
      document.removeEventListener('dragstart', prevent);
    };
  }, []);
}
