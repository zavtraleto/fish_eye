import { tuning } from '../../config/tuning';
import type { Button, InputState } from './commands';

// Keyboard and mouse (GDD §3).

const KEY_BUTTONS: Record<string, Button> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'dash',
};

function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}

/** Held keys set `input.held`; a fresh press also queues a `press` command. */
export function attachKeyboard(input: InputState, target: Window = window): () => void {
  const onDown = (e: KeyboardEvent) => {
    if (isTextField(e.target)) return;
    const button = KEY_BUTTONS[e.code];
    if (!button) return;
    e.preventDefault();
    if (e.repeat) return;
    input.held[button] = true;
    input.push({ type: 'press', button });
  };
  const onUp = (e: KeyboardEvent) => {
    const button = KEY_BUTTONS[e.code];
    if (button) input.held[button] = false;
  };
  const onBlur = () => input.releaseAll();

  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', onBlur);
  return () => {
    target.removeEventListener('keydown', onDown);
    target.removeEventListener('keyup', onUp);
    target.removeEventListener('blur', onBlur);
  };
}

export interface MouseLook {
  readonly locked: boolean;
  detach(): void;
}

/**
 * A click queues `confirm` and grabs Pointer Lock; losing the lock queues
 * `pause`, regaining it `resume` (GDD §3, §14.1). Mouse motion turns
 * `input.look` right in the event handler, so the next render frame already
 * shows it (GDD §3.2).
 */
export function attachMouseLook(input: InputState, el: HTMLElement): MouseLook {
  const look: MouseLook = { locked: false, detach };

  const request = () => {
    // Raw input without OS acceleration where the browser supports it.
    // Chrome refuses a re-lock right after Esc: the player clicks again.
    const p = el.requestPointerLock({ unadjustedMovement: true }) as Promise<void> | undefined;
    p?.catch(() => (el.requestPointerLock() as Promise<void> | undefined)?.catch(() => undefined));
  };
  const onClick = () => {
    input.push({ type: 'confirm' });
    if (document.pointerLockElement !== el) request();
  };
  const onLockChange = () => {
    const locked = document.pointerLockElement === el;
    (look as { locked: boolean }).locked = locked;
    if (!locked) input.releaseAll();
    input.push({ type: locked ? 'resume' : 'pause' });
  };
  const onMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== el) return;
    const s = tuning.player.MOUSE_SENSITIVITY;
    const limit = (tuning.camera.PITCH_LIMIT * Math.PI) / 180;
    input.look.yaw -= e.movementX * s;
    input.look.pitch = Math.min(limit, Math.max(-limit, input.look.pitch - e.movementY * s));
  };

  el.addEventListener('click', onClick);
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('mousemove', onMove);

  function detach(): void {
    el.removeEventListener('click', onClick);
    document.removeEventListener('pointerlockchange', onLockChange);
    document.removeEventListener('mousemove', onMove);
  }
  return look;
}
