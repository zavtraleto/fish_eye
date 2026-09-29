import type { Dir, InputState } from './commands';

// Keyboard, touch and browser-level input guards (GDD §3).

const KEY_DIRS: Record<string, Dir> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

const ACTION_KEYS = new Set(['Space', 'Enter']);

function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}

/** A movement press steps once; the simulation repeats while the key is held. */
export function attachKeyboard(input: InputState, target: Window = window): () => void {
  const down: Dir[] = [];
  const sync = () => input.setHeld(down[down.length - 1] ?? null);

  const onDown = (e: KeyboardEvent) => {
    if (isTextField(e.target)) return;
    if (ACTION_KEYS.has(e.code)) {
      e.preventDefault();
      if (!e.repeat) input.push({ type: 'action' });
      return;
    }
    const dir = KEY_DIRS[e.code];
    if (!dir) return;
    e.preventDefault();
    if (e.repeat) return; // OS auto-repeat is ignored; the simulation handles hold repeat.
    const i = down.indexOf(dir);
    if (i >= 0) down.splice(i, 1);
    down.push(dir);
    input.push({ type: 'move', dir });
    sync();
  };
  const onUp = (e: KeyboardEvent) => {
    const dir = KEY_DIRS[e.code];
    if (!dir) return;
    const i = down.indexOf(dir);
    if (i >= 0) down.splice(i, 1);
    sync();
  };
  const onBlur = () => {
    down.length = 0;
    sync();
  };

  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', onBlur);
  return () => {
    target.removeEventListener('keydown', onDown);
    target.removeEventListener('keyup', onUp);
    target.removeEventListener('blur', onBlur);
  };
}

/**
 * Placeholder touch scheme until the GDD defines the real controls:
 * a swipe anywhere on `el` is one step, a tap is `action`.
 * Reacts on pointerup, so feedback is not immediate: replace it.
 */
export function attachSwipe(input: InputState, el: HTMLElement, minPx = 24): () => void {
  let start: { id: number; x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => {
    if (!start) start = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onUp = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < minPx) {
      input.push({ type: 'action' });
      return;
    }
    const dir: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    input.push({ type: 'move', dir });
  };
  const onCancel = () => {
    start = null;
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
  };
}

/**
 * Keeps the browser from turning in-game swipes into its own gestures
 * (back/forward navigation, pull-to-refresh). Touch moves are cancelled
 * everywhere except inside scrollable UI.
 */
export function blockBrowserGestures(doc: Document = document): void {
  const allowScroll = (t: EventTarget | null) => t instanceof Element && t.closest('.debug-panel') !== null;
  doc.addEventListener(
    'touchmove',
    (e) => {
      if (e.cancelable && !allowScroll(e.target)) e.preventDefault();
    },
    { passive: false },
  );
  // Multi-finger touches never zoom or navigate.
  doc.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length > 1 && e.cancelable) e.preventDefault();
    },
    { passive: false },
  );
}
