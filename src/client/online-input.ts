import { KEY } from '../shared/config';
import type { RealtimeSessionAPI } from '../shared/realtime';

const movement: Record<string, number> = { KeyW: KEY.W, ArrowUp: KEY.W, KeyA: KEY.A, ArrowLeft: KEY.A, KeyS: KEY.S, ArrowDown: KEY.S, KeyD: KEY.D, ArrowRight: KEY.D };
const touchMovement: Record<string, number> = { forward: KEY.W, reverse: KEY.S, left: KEY.A, right: KEY.D };
const editable = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
export function createOnlineInput(root: HTMLElement, session: RealtimeSessionAPI) {
  const down = new Set<string>(), held = new Set<string>();
  const pointerDown = new Set<number>();
  const pointers = new Map<number, { mask: number; button: HTMLElement }>();
  let signature = '';
  let disposed = false;
  const focused = () => document.activeElement === root || root.contains(document.activeElement);
  const flight = () => session.connection === 'connected' && !session.controlsSuspended && session.snapshot?.status === 'playing' && session.snapshot.state?.phase === 'playing' && session.seat !== null && session.snapshot.state.shots[session.seat].phase === 'flight';
  const publish = () => {
    let mask = 0;
    for (const code of held) mask |= movement[code];
    for (const pointer of pointers.values()) mask |= pointer.mask;
    session.setControls(mask);
  };
  const pressed = (button: HTMLElement) => button.setAttribute('aria-pressed', String([...pointers.values()].some((p) => p.button === button)));
  const clear = () => {
    held.clear();
    const captured = [...pointers.entries()]; pointers.clear();
    for (const [id, { button }] of captured) {
      button.setAttribute('aria-pressed', 'false');
      if (button.hasPointerCapture(id)) button.releasePointerCapture(id);
    }
    session.setControls(0);
  };
  const pointerdown = (event: PointerEvent) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-online-control]');
    const mask = button && touchMovement[button.dataset.onlineControl ?? ''];
    if (!button || !mask || event.button !== 0 || pointerDown.has(event.pointerId)) return;
    event.preventDefault(); pointerDown.add(event.pointerId);
    if (!flight()) return;
    root.focus({ preventScroll: true });
    try { button.setPointerCapture(event.pointerId); } catch { return; }
    pointers.set(event.pointerId, { mask, button }); pressed(button); publish();
  };
  const pointerend = (event: PointerEvent) => {
    const owned = pointerDown.has(event.pointerId);
    if (event.type !== 'lostpointercapture') pointerDown.delete(event.pointerId);
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    if (owned) event.preventDefault();
    pointers.delete(event.pointerId); pressed(pointer.button); publish();
  };
  const keydown = (event: KeyboardEvent) => {
    if (!focused() || editable(event.target)) return;
    if (!(event.code in movement) && !['Space', 'Enter', 'Escape'].includes(event.code)) return;
    if (event.code.startsWith('Arrow') && flight()) event.preventDefault();
    if (event.repeat || down.has(event.code)) { if (event.code === 'Space' || event.code === 'Enter') event.preventDefault(); return; }
    down.add(event.code);
    if (event.code === 'Escape') {
      event.preventDefault();
      if (session.controlsSuspended) session.resumeControls(); else session.suspendControls();
      return;
    }
    if (session.controlsSuspended) return;
    if (event.code in movement) { if (flight()) { held.add(event.code); publish(); } return; }
    if ((event.target as HTMLElement | null)?.closest('button')) return;
    const room = session.snapshot, seat = session.seat;
    if (session.connection !== 'connected' || !room || !seat) return;
    if (event.code === 'Enter' && room.status === 'waiting' && !room.seats[seat].ready && room.seats[seat].compatible) { event.preventDefault(); session.ready(); }
    if (event.code === 'Space' && room.status === 'playing' && room.state?.phase === 'playing' && room.state.shots[seat].phase === 'ready') { event.preventDefault(); session.fire(); }
  };
  const keyup = (event: KeyboardEvent) => { down.delete(event.code); if (event.code in movement) { held.delete(event.code); publish(); } };
  const blur = () => { clear(); session.suspendControls(); };
  const visibility = () => { if (document.hidden) blur(); };
  const focus = (event: FocusEvent) => { if (!focused() || editable(event.target)) clear(); };
  const unsubscribe = session.subscribe(() => {
    const state = session.snapshot?.state, own = session.seat && state?.shots[session.seat];
    const next = `${session.connection}/${session.seat}/${state?.matchId}/${state?.phase}/${own?.phase}/${own?.projectile?.shotId}/${session.controlsSuspended}`;
    if (signature !== next) { signature = next; clear(); }
  });
  root.addEventListener('pointerdown', pointerdown);
  window.addEventListener('pointerup', pointerend); window.addEventListener('pointercancel', pointerend); window.addEventListener('lostpointercapture', pointerend);
  window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', blur);
  document.addEventListener('visibilitychange', visibility); document.addEventListener('focusin', focus);
  return { clear, dispose() {
    if (disposed) return; disposed = true; unsubscribe(); clear(); down.clear(); pointerDown.clear();
    root.removeEventListener('pointerdown', pointerdown);
    window.removeEventListener('pointerup', pointerend); window.removeEventListener('pointercancel', pointerend); window.removeEventListener('lostpointercapture', pointerend);
    window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur);
    document.removeEventListener('visibilitychange', visibility); document.removeEventListener('focusin', focus);
  } };
}
