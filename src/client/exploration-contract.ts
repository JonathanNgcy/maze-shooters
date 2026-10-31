import type { MatchState, PlayerId, ProjectileState, WorldGeometry } from '../shared/types';

/** Presentation-only knowledge; never an authoritative map, collider or match field. */
export type ExplorationDiscovery = Readonly<{ p1: readonly number[]; p2: readonly number[] }>;
export type ExplorationOptions = Readonly<{
  resetOnRematch: boolean;
  initialDiscovery?: unknown;
  onDiscoveryChange?: (discovery: ExplorationDiscovery) => void;
}>;
export interface ExplorationMapUI {
  /** Observe every authority snapshot so catch-up/render skips cannot lose explored cells. */
  observe(state: MatchState): void;
  /** Online authority supplies exact tick-accumulated knowledge rather than interpolated paths. */
  setKnowledge(view: Readonly<{ matchId:string; seat:PlayerId; phase:'waiting'|'ready'|'flight'|'resolve'|'gameOver'; projectile:ProjectileState|null; discovered:readonly number[] }>): void;
  serialize(): ExplorationDiscovery;
  dispose(): void;
}
export type CreateExplorationMap = (
  root: HTMLElement,
  world: WorldGeometry,
  options: ExplorationOptions,
) => ExplorationMapUI;
