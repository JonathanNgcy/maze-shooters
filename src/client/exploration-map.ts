import { GRID_SIZE, TILE_SIZE } from '../shared/config';
import type { MatchState, PlayerId, Vec2 } from '../shared/types';
import type { CreateExplorationMap } from './exploration-contract';
import { createExplorationModel } from './exploration';
import './exploration-map.css';

const seatName = (seat: PlayerId) => seat === 'p1' ? 'Player 1' : 'Player 2';
const coordinate = (point: Vec2) => ({
  x: (point.x / TILE_SIZE + GRID_SIZE / 2) / GRID_SIZE * 100,
  y: (point.z / TILE_SIZE + GRID_SIZE / 2) / GRID_SIZE * 100,
});

export const createExplorationMap: CreateExplorationMap = (root, world, options) => {
  const model = createExplorationModel(world, options);
  const panel = document.createElement('aside');
  panel.className = 'exploration-map'; panel.hidden = true;
  panel.innerHTML = `<div class="exploration-heading"><span class="exploration-title">PRIVATE EXPLORATION</span><span class="exploration-north" aria-label="North is up">N ↑</span></div><div class="exploration-owner"></div><div class="exploration-board" aria-label="Explored maze cells"><div class="exploration-grid"></div><span class="exploration-home" data-marker="home" hidden aria-label="Your fixed home"></span><span class="exploration-missile" data-marker="projectile" hidden aria-label="Your live missile"></span></div><div class="exploration-footer"><span class="exploration-count"></span><span class="exploration-legend"><i></i> Flown <b></b> Wall</span></div>`;
  root.append(panel);
  const grid = panel.querySelector<HTMLElement>('.exploration-grid')!;
  grid.style.setProperty('--exploration-grid-size', String(GRID_SIZE));
  const owner = panel.querySelector<HTMLElement>('.exploration-owner')!;
  const count = panel.querySelector<HTMLElement>('.exploration-count')!;
  const home = panel.querySelector<HTMLElement>('.exploration-home')!;
  const missile = panel.querySelector<HTMLElement>('.exploration-missile')!;
  let cells: HTMLElement[] = [];
  let lastSeat: PlayerId | null = null;
  let lastMatch: string | null = null;
  let disposed = false;
  function blank() {
    grid.replaceChildren(); cells = []; owner.textContent = ''; count.textContent = '';
    home.hidden = true; missile.hidden = true; home.removeAttribute('style'); missile.removeAttribute('style');
    panel.removeAttribute('data-seat'); panel.removeAttribute('data-discovered'); panel.removeAttribute('aria-label'); panel.hidden = true;
    lastSeat = null; lastMatch = null;
  }
  function buildCells() {
    const fragment = document.createDocumentFragment();
    cells = Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, cell) => {
      const element = document.createElement('span'); element.className = 'exploration-cell';
      element.dataset.cell = String(cell); element.dataset.kind = 'fog';
      element.setAttribute('aria-hidden', 'true'); fragment.append(element); return element;
    });
    grid.replaceChildren(fragment);
  }
  function place(marker: HTMLElement, point: Vec2, heading?: number) {
    const p = coordinate(point);
    if (![p.x, p.y].every(Number.isFinite) || p.x < 0 || p.x >= 100 || p.y < 0 || p.y >= 100) { marker.hidden = true; return; }
    marker.hidden = false; marker.style.left = `${p.x}%`; marker.style.top = `${p.y}%`;
    if (heading !== undefined) marker.style.transform = `translate(-50%,-50%) rotate(${heading}rad)`;
  }
  function render(seat: PlayerId, matchId: string, phase: string, projectile: MatchState['projectile'], changed: boolean) {
    const switched = seat !== lastSeat || matchId !== lastMatch;
    if (switched || cells.length === 0) {
      buildCells(); lastSeat = seat; lastMatch = matchId;
      panel.dataset.seat = seat; panel.setAttribute('aria-label', `${seatName(seat)} private exploration map`);
      owner.textContent = `${seatName(seat)} · your explored cells`;
    }
    panel.hidden = false;
    if (changed || switched) {
      cells.forEach((element, cell) => { element.dataset.kind = model.cellKind(seat, cell); });
      const explored = model.discovered(seat).length;
      count.textContent = `${explored} ${explored === 1 ? 'cell' : 'cells'} flown`;
      panel.dataset.discovered = String(explored);
    }
    const spawn = world.spawns.find((p) => p.id === seat);
    if (spawn) place(home, spawn.position); else home.hidden = true;
    if (phase === 'flight' && projectile?.owner === seat) place(missile, projectile.position, projectile.heading);
    else { missile.hidden = true; missile.removeAttribute('style'); }
  }
  let knowledgeMatch: string | null = null;
  return {
    observe(state: MatchState) {
      if (disposed) return;
      const changed = model.observe(state);
      if (state.phase === 'handoff') { blank(); return; }
      render(state.activePlayer, state.matchId, state.phase, state.projectile, changed);
    },
    setKnowledge(view) {
      if (disposed) return;
      if (view.matchId !== knowledgeMatch) { model.reset(); knowledgeMatch = view.matchId; }
      // Online knowledge is the complete server-supplied seat slice. No sampled or
      // interpolated missile segment can reveal another cell on the client.
      const changed = model.restore({ p1: view.seat === 'p1' ? view.discovered : [], p2: view.seat === 'p2' ? view.discovered : [] });
      if (view.phase === 'waiting') { blank(); return; }
      render(view.seat, view.matchId, view.phase, view.projectile, changed);
    },
    serialize: model.serialize,
    dispose() { if (disposed) return; disposed = true; blank(); panel.remove(); },
  };
};
