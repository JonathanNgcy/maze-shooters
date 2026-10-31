import type { SessionAPI } from '../shared/types';
import { KEY } from '../shared/config';

const movement: Record<string, number> = {
  KeyW: KEY.W, ArrowUp: KEY.W,
  KeyA: KEY.A, ArrowLeft: KEY.A,
  KeyS: KEY.S, ArrowDown: KEY.S,
  KeyD: KEY.D, ArrowRight: KEY.D,
};
const editable = (target: EventTarget | null): boolean => target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** Physical down state survives a clearing boundary until keyup. */
export function createInput(root: HTMLElement, session: SessionAPI) {
  const down = new Set<string>();
  const held = new Set<string>();
  let mask = 0;
  let signature = '';
  const publish = () => {
    mask = 0;
    for (const code of held) mask |= movement[code];
    session.setControls(mask);
  };
  const clear = () => { held.clear(); mask = 0; session.setControls(0); };
  const focused = () => document.activeElement === root || root.contains(document.activeElement);
  const keydown = (event: KeyboardEvent) => {
    if (!focused() || editable(event.target)) return;
    const known = event.code in movement || ['Space', 'Enter', 'Escape'].includes(event.code);
    if (!known) return;
    // Arrow keys steer only in flight; capture their native scrolling on that surface.
    if (event.code.startsWith('Arrow') && session.current.phase === 'flight' && !session.paused) event.preventDefault();
    if (event.repeat || down.has(event.code)) {
      // Native buttons otherwise repeatedly activate on a held Enter.
      if (event.code === 'Enter' || event.code === 'Space') event.preventDefault();
      return;
    }
    down.add(event.code);
    if (event.code === 'Escape') {
      if (session.current.phase !== 'gameOver') {
        event.preventDefault();
        if (session.paused) session.resume(); else session.pause();
      }
      return;
    }
    if (session.paused) return;
    if (event.code in movement) {
      if (session.current.phase === 'flight') {
        held.add(event.code);
        publish();
      }
      return;
    }
    // Focused buttons keep native activation; never also send a global action.
    if ((event.target as HTMLElement | null)?.closest('button')) return;
    if (event.code === 'Enter' && session.current.phase === 'handoff') {
      event.preventDefault(); session.command('ready');
    } else if (event.code === 'Space' && session.current.phase === 'ready') {
      event.preventDefault(); session.command('fire');
    }
  };
  const keyup = (event: KeyboardEvent) => {
    down.delete(event.code);
    if (event.code in movement) { held.delete(event.code); publish(); }
  };
  const lostFocus = () => {
    clear();
    if (session.current.phase !== 'gameOver') session.pause('window lost focus');
  };
  const visibility = () => { if (document.hidden) lostFocus(); };
  const focusChanged = (event: FocusEvent) => {
    if (!focused() || editable(event.target)) clear();
  };
  const unsubscribe = session.subscribe(() => {
    const next = `${session.current.matchId}/${session.current.phase}/${session.paused}`;
    if (next !== signature) { signature = next; clear(); }
  });
  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('blur', lostFocus);
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('focusin', focusChanged);
  return { clear, dispose() {
    unsubscribe(); clear(); down.clear();
    window.removeEventListener('keydown', keydown);
    window.removeEventListener('keyup', keyup);
    window.removeEventListener('blur', lostFocus);
    document.removeEventListener('visibilitychange', visibility);
    document.removeEventListener('focusin', focusChanged);
  } };
}
