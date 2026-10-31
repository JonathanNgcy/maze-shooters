import type { SessionAPI } from '../shared/types';
import { createCameras, renderProjectile } from './cameras';
import { createHUD } from './hud';
import { createInput } from './input';
import { createScene } from './scene';
import { createExplorationMap } from './exploration-map';
import './styles.css';

/** Presentation owns its resources and requests intent, never edits match state. */
export function createApp(root: HTMLElement, session: SessionAPI) {
  root.classList.add('game');
  const canvas = document.createElement('canvas');
  canvas.className = 'world';
  canvas.setAttribute('aria-label', 'Three dimensional maze view');
  root.append(canvas);
  const hud = createHUD(root, session);
  const exploration = createExplorationMap(root, session.world, {
    resetOnRematch: true,
  });
  const input = createInput(root, session);
  const cameras = createCameras(session.world);
  let world: ReturnType<typeof createScene> | undefined;
  let animation = 0;
  let disposed = false;
  let failed = false;
  const fail = (message: string) => {
    failed = true; cancelAnimationFrame(animation); input.dispose(); exploration.dispose(); session.pause('graphics unavailable'); hud.error(message);
  };
  const resize = () => {
    const width = Math.max(1, root.clientWidth), height = Math.max(1, root.clientHeight);
    world?.resize(width, height); cameras.resize(width, height);
  };
  const contextLost = (event: Event) => {
    event.preventDefault();
    fail('The graphics context was lost. Reload the game to restore the maze.');
  };
  canvas.addEventListener('webglcontextlost', contextLost);
  window.addEventListener('resize', resize);
  const focusSurface = () => root.focus({ preventScroll: true });
  canvas.addEventListener('pointerdown', focusSurface);
  // Observe every authority tick so render skips cannot lose impacts or explored cells.
  const unsubscribe = session.subscribe(() => {
    world?.observe(session.current);
    exploration.observe(session.current);
    hud.update();
  });
  exploration.observe(session.current);
  hud.update();
  try { world = createScene(canvas, session.world); world.observe(session.current); resize(); cameras.ready(session.current); }
  catch (error) { fail(error instanceof Error ? error.message : 'WebGL 2 could not start. Enable graphics acceleration and reload.'); }
  function frame(time: number) {
    if (disposed || failed || !world) return;
    try {
      session.frame(time);
      const state = session.current;
      const sample = session.paused ? state.projectile : renderProjectile(state, session.previous, session.alpha);
      if (!session.paused) {
        if (state.phase === 'ready' || state.phase === 'handoff') cameras.ready(state);
        else if (state.phase === 'flight' && sample) cameras.flight(sample);
      }
      world.update(state, sample, cameras.noseView);
      hud.update();
      world.renderer.render(world.scene, cameras.camera);
      animation = requestAnimationFrame(frame);
    } catch (error) { fail(error instanceof Error ? error.message : 'The game could not continue. Reload to try again.'); }
  }
  if (!failed) animation = requestAnimationFrame(frame);
  root.focus({ preventScroll: true });
  return {
    dispose() {
      if (disposed) return;
      disposed = true; cancelAnimationFrame(animation); unsubscribe(); input.dispose();
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('pointerdown', focusSurface);
      window.removeEventListener('resize', resize);
      exploration.dispose(); world?.dispose(); hud.dispose(); canvas.remove(); root.classList.remove('game');
    },
  };
}
