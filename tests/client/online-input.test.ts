import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOnlineInput } from '../../src/client/online-input';
import type { RealtimeSessionAPI, RoomSnapshot } from '../../src/shared/realtime';

class Element extends EventTarget {
  dataset: Record<string, string> = {};
  tagName = 'BUTTON'; isContentEditable = false;
  attributes = new Map<string, string>(); captures = new Set<number>();
  closest(selector: string) { return selector === '[data-online-control]' && this.dataset.onlineControl ? this : selector === 'button' && this.tagName === 'BUTTON' ? this : null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  hasPointerCapture(id: number) { return this.captures.has(id); }
  setPointerCapture(id: number) { this.captures.add(id); }
  releasePointerCapture(id: number) { this.captures.delete(id); }
  contains(target: unknown) { return target instanceof Element; }
  focus() { (document as unknown as { activeElement: unknown }).activeElement = this; }
}
function event(type: string, properties: Record<string, unknown> = {}) {
  const e = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(properties)) Object.defineProperty(e, key, { value });
  return e;
}
function setup(phase: 'ready' | 'flight' = 'flight') {
  const root = new Element(); root.tagName = 'MAIN';
  const windowEvents = new EventTarget();
  const documentEvents = Object.assign(new EventTarget(), { activeElement: root, hidden: false });
  vi.stubGlobal('HTMLElement', Element); vi.stubGlobal('window', windowEvents); vi.stubGlobal('document', documentEvents);
  const listeners = new Set<() => void>();
  const room = {
    roomId: 'room', code: 'ABC234', revision: 1, eventId: 0, serverTimeMs: 0, status: 'playing', explored: [], history: [], lastProcessedSeq: 0, outcome: null,
    seats: {}, state: { matchId: 'm1', matchNumber: 1, tick: 1, phase: 'playing', nextShotId: 2, resolveTicksRemaining: 0, outcome: null, shots: { p1: { phase, projectile: { shotId: 1 }, result: null, resolveTicksRemaining: 0 }, p2: { phase: 'ready' } } },
  } as unknown as RoomSnapshot;
  const masks: number[] = [];
  let suspended = false;
  const session = {
    snapshot: room, seat: 'p1', connection: 'connected', get controlsSuspended() { return suspended; },
    setControls(mask: number) { masks.push(mask); },
    suspendControls() { suspended = true; notify(); },
    resumeControls() { suspended = false; notify(); },
    subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); },
  } as unknown as RealtimeSessionAPI;
  function notify() { for (const fn of listeners) fn(); }
  const input = createOnlineInput(root as unknown as HTMLElement, session); notify(); masks.length = 0;
  const button = (action: string) => { const b = new Element(); b.dataset.onlineControl = action; return b; };
  const press = (b: Element, id: number) => root.dispatchEvent(event('pointerdown', { target: b, pointerId: id, button: 0 }));
  const release = (id: number, type = 'pointerup') => windowEvents.dispatchEvent(event(type, { pointerId: id }));
  const key = (code: string, type = 'keydown', repeat = false) => windowEvents.dispatchEvent(event(type, { code, repeat, target: root }));
  const setPhase = (next: 'ready' | 'flight' | 'resolve') => { (room.state!.shots.p1 as unknown as { phase: string }).phase = next; notify(); };
  return { root, windowEvents, documentEvents, session, masks, input, button, press, release, key, notify, setPhase };
}
afterEach(() => vi.unstubAllGlobals());

describe('online held touch controls', () => {
  it('combines two fingers and keyboard aliases without adding force or dropping another hold', () => {
    const s = setup(), forward = s.button('forward'), right = s.button('right');
    s.press(forward, 1); s.press(right, 2); expect(s.masks.at(-1)).toBe(9);
    s.key('KeyW'); s.release(1); expect(s.masks.at(-1)).toBe(9);
    s.release(2); expect(s.masks.at(-1)).toBe(1);
    s.key('KeyW', 'keyup'); expect(s.masks.at(-1)).toBe(0);
    expect(forward.attributes.get('aria-pressed')).toBe('false');
    expect(right.attributes.get('aria-pressed')).toBe('false'); s.input.dispose();
  });
  it('keeps an action held when a second finger on that button is released, and cancels lost pointers', () => {
    const s = setup(), reverse = s.button('reverse');
    s.press(reverse, 1); s.press(reverse, 2); s.release(1); expect(s.masks.at(-1)).toBe(4);
    expect(reverse.attributes.get('aria-pressed')).toBe('true');
    s.release(2, 'pointercancel'); expect(s.masks.at(-1)).toBe(0);
    const left = s.button('left'); s.press(left, 3); s.release(3, 'lostpointercapture'); expect(s.masks.at(-1)).toBe(0);
    s.press(left, 3); expect(s.masks.at(-1)).toBe(0);
    s.release(3); s.press(left, 3); expect(s.masks.at(-1)).toBe(2); s.input.dispose();
  });
  it('clears capture and masks at a phase boundary and cannot reuse a preheld contact after launch', () => {
    const s = setup('ready'), forward = s.button('forward');
    s.press(forward, 1); expect(s.masks).toEqual([]);
    s.setPhase('flight'); s.press(forward, 1); expect(s.masks.at(-1)).toBe(0);
    s.release(1); s.press(forward, 1); expect(s.masks.at(-1)).toBe(1); expect(forward.captures.has(1)).toBe(true);
    s.setPhase('resolve'); expect(s.masks.at(-1)).toBe(0); expect(forward.captures.has(1)).toBe(false);
    expect(forward.attributes.get('aria-pressed')).toBe('false');
    s.setPhase('flight'); s.press(forward, 1); expect(s.masks.at(-1)).toBe(0);
    s.release(1); s.press(forward, 1); expect(s.masks.at(-1)).toBe(1); s.input.dispose();
  });
  it('suspends and clears on blur/hide/menu, and needs a fresh contact after resume', () => {
    const s = setup(), right = s.button('right'); s.press(right, 1);
    s.windowEvents.dispatchEvent(event('blur')); expect(s.session.controlsSuspended).toBe(true); expect(s.masks.at(-1)).toBe(0);
    s.session.resumeControls(); s.press(right, 1); expect(s.masks.at(-1)).toBe(0);
    s.release(1); s.press(right, 1); expect(s.masks.at(-1)).toBe(8);
    s.key('Escape'); expect(s.session.controlsSuspended).toBe(true); expect(s.masks.at(-1)).toBe(0);
    s.key('Escape', 'keyup'); s.session.resumeControls(); s.release(1); s.press(right, 2);
    s.documentEvents.hidden = true; s.documentEvents.dispatchEvent(event('visibilitychange')); expect(s.masks.at(-1)).toBe(0);
    s.input.dispose();
  });
  it('clears on connection loss and disposal and removes pointer listeners', () => {
    const s = setup(), forward = s.button('forward'); s.press(forward, 1);
    (s.session as unknown as { connection: string }).connection = 'reconnecting'; s.notify(); expect(s.masks.at(-1)).toBe(0);
    (s.session as unknown as { connection: string }).connection = 'connected'; s.notify();
    s.release(1); s.press(forward, 1); expect(s.masks.at(-1)).toBe(1);
    s.input.dispose(); expect(s.masks.at(-1)).toBe(0); const count = s.masks.length;
    s.release(1); s.press(forward, 2); s.key('KeyW'); expect(s.masks).toHaveLength(count);
  });
});
