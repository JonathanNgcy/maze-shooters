import type { RealtimeSessionAPI } from '../shared/realtime';
import type { PlayerId, ProjectileState } from '../shared/types';
import { createCameras } from './cameras';
import { createScene, type OnlineSceneView } from './scene';
import { createExplorationMap } from './exploration-map';
import { createOnlineHUD } from './online-hud';
import { createOnlineInput } from './online-input';
import './styles.css';
import './online.css';

/** Explicit seat-based presentation. Server time continues while menus or tabs are inactive. */
export function createOnlineApp(root: HTMLElement, session: RealtimeSessionAPI) {
  root.classList.add('game', 'online-game');
  const canvas = document.createElement('canvas'); canvas.className = 'world'; canvas.setAttribute('aria-label', 'Online three dimensional maze view'); root.append(canvas);
  const hud = createOnlineHUD(root, session);
  const input = createOnlineInput(root, session);
  const exploration = createExplorationMap(root, session.world, { resetOnRematch: true });
  const cameras = createCameras(session.world);
  let world: ReturnType<typeof createScene> | undefined;
  let animation = 0, disposed = false, failed = false;
  let lastSeat: PlayerId = 'p1', lastMatch = '';
  let cameraStationary = true;
  const fail = (message: string) => {
    if (failed) return;
    failed = true; cancelAnimationFrame(animation); input.dispose(); exploration.dispose();
    session.suspendControls(); hud.error(message);
  };
  const view = (interpolated: boolean): OnlineSceneView | null => {
    const room = session.snapshot, state = room?.state, seat = session.seat;
    if (!room || !state || !seat) return null;
    const live = room.status === 'playing' && state.phase === 'playing';
    const projectiles: readonly ProjectileState[] = live ? (interpolated ? session.projectiles : Object.values(state.shots).flatMap((shot) => shot.phase === 'flight' && shot.projectile ? [shot.projectile] : [])) : [];
    return {
      matchId: state.matchId, seat, tick: state.tick,
      phases: { p1: state.shots.p1.phase, p2: state.shots.p2.phase },
      projectiles: projectiles.filter((p) => state.shots[p.owner].phase === 'flight'),
      history: room.history,
      stationary: live && state.shots[seat].phase === 'ready', hideOwnProjectile: cameras.noseView,
      results: Object.values(state.shots).flatMap((shot) => shot.result ? [shot.result] : []),
    };
  };
  const observe = () => {
    hud.update();
    if (failed || disposed) return;
    const room = session.snapshot, state = room?.state, seat = session.seat;
    if (seat) lastSeat = seat;
    if (state && seat && room) {
      lastMatch = state.matchId;
      const own = state.shots[seat];
      exploration.setKnowledge({ matchId: state.matchId, seat, phase: room.status === 'ended' || room.status === 'abandoned' || state.phase === 'gameOver' ? 'gameOver' : own.phase, projectile: own.projectile, discovered: room.explored });
      const sample = view(false); if (sample) world?.observeOnline(sample);
    } else exploration.setKnowledge({ matchId: lastMatch || 'waiting', seat: lastSeat, phase: 'waiting', projectile: null, discovered: [] });
  };
  const resize = () => { const width = Math.max(1, root.clientWidth), height = Math.max(1, root.clientHeight); world?.resize(width, height); cameras.resize(width, height); };
  const contextLost = (event: Event) => { event.preventDefault(); fail('The graphics context was lost. Reload to restore the maze. Your opponent and the server keep playing.'); };
  const focus = () => root.focus({ preventScroll: true });
  canvas.addEventListener('webglcontextlost', contextLost); canvas.addEventListener('pointerdown', focus); window.addEventListener('resize', resize);
  const unsubscribe = session.subscribe(observe);
  try { world = createScene(canvas, session.world); resize(); cameras.readySeat(session.seat ?? 'p1'); world.prepareOnline(cameras.camera); }
  catch (error) { fail(error instanceof Error ? error.message : 'WebGL 2 could not start. Enable graphics acceleration and reload.'); }
  observe();
  function frame(time: number) {
    if (disposed || failed || !world) return;
    try {
      session.frame(time);
      const sample = view(true), room = session.snapshot, state = room?.state, seat = session.seat;
      if (sample && state && seat) {
        const own = sample.projectiles.find((p) => p.owner === seat);
        if (sample.stationary) { cameras.readySeat(seat); cameraStationary = true; }
        else if (room?.status === 'playing' && state.phase === 'playing' && own) { cameras.flight(own); cameraStationary = false; }
        world.updateOnline({ ...sample, stationary: cameraStationary, hideOwnProjectile: cameras.noseView });
      } else if (seat) { cameras.readySeat(seat); cameraStationary = true; }
      hud.update(); world.renderer.render(world.scene, cameras.camera);
      animation = requestAnimationFrame(frame);
    } catch (error) { fail(error instanceof Error ? error.message : 'The online view could not continue. Reload to reconnect.'); }
  }
  if (!failed) animation = requestAnimationFrame(frame);
  root.focus({ preventScroll: true });
  return { dispose() {
    if (disposed) return; disposed = true;
    cancelAnimationFrame(animation); unsubscribe(); input.dispose(); exploration.dispose(); hud.dispose(); world?.dispose();
    canvas.removeEventListener('webglcontextlost', contextLost); canvas.removeEventListener('pointerdown', focus); window.removeEventListener('resize', resize);
    canvas.remove(); root.classList.remove('game', 'online-game');
  } };
}
