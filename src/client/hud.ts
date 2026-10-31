import type { MatchState, PlayerId, SessionAPI } from '../shared/types';
import { FLIGHT_TICKS, SIM_HZ } from '../shared/config';
import { otherPlayer } from '../shared/math';

const player = (id: PlayerId | null): string => id === 'p1' ? 'Player 1' : 'Player 2';
const phaseLabel = { handoff: 'Handoff', ready: 'Ready to launch', flight: 'In flight', resolve: 'Shot resolved', gameOver: 'Match complete' };
export function outcome(state: MatchState): string {
  const r = state.result;
  if (!r) return '';
  if (r.reason === 'wall') return `Wall hit. ${player(otherPlayer(r.shooter))} is next.`;
  if (r.reason === 'timeout') return `Time up. ${player(otherPlayer(r.shooter))} is next.`;
  if (r.victim === r.shooter) return `${player(r.victim)} hit themselves. ${player(state.winner)} wins.`;
  return `${player(state.winner)} wins — ${player(r.victim)} was hit.`;
}

export function createHUD(root: HTMLElement, session: SessionAPI) {
  const layer = document.createElement('div'); layer.className = 'hud';
  layer.innerHTML = `
    <header class="topbar">
      <div class="brand"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span>MAZE <b>SHOOTERS</b></span><span class="edition">OFFLINE DUEL</span></div>
      <div class="top-actions"><span class="match-id"></span><button type="button" class="quiet pause-button" aria-label="Pause">Pause <kbd>Esc</kbd></button><a class="quiet offline-online-link" style="pointer-events:auto;text-decoration:none" href="?online=1">Online duel ↗</a></div>
    </header>
    <div class="pilot-strip"><span class="seat-dot"></span><strong class="active-player"></strong><span class="separator"></span><span class="phase-label"></span></div>
    <div class="telemetry" aria-label="Flight information"><div><span class="metric-label">TIME LEFT</span><strong class="time-value">18.0<span>s</span></strong></div><div><span class="metric-label">SPEED</span><strong class="speed-value">0.0<span>m/s</span></strong></div></div>
    <div class="reticle" aria-hidden="true"><span></span></div>
    <div class="ready-callout"><span class="eyebrow">FIXED POSITION · ONE SHOT</span><h2>Your gun is fixed.</h2><p>Fire, then steer the projectile.<br>Your map keeps every cell your missile crosses.</p><p class="first-help">Space: fire. W/S or ↑/↓: thrust. A/D or ←/→: rotate. Release to coast. Hit yourself and you lose.</p><button type="button" class="primary fire-button">Fire <span>SPACE ↗</span></button></div>
    <div class="result-toast" role="status" aria-live="polite"></div>
    <footer class="control-bar"><div class="keys"><span><kbd>W/↑</kbd><kbd>S/↓</kbd> Thrust / reverse</span><span><kbd>A/←</kbd><kbd>D/→</kbd> Rotate</span><span class="coast-help">Release to coast</span></div><span class="risk-copy">Hit yourself and you lose.</span></footer>
    <div class="curtain handoff-screen"><div class="handoff-grid" aria-hidden="true"></div><div class="handoff-content"><span class="eyebrow">LOCAL HOTSEAT · TWO PLAYERS</span><div class="seat-number" aria-hidden="true">01</div><h1>Player 1, you're up.</h1><p class="handoff-intro">One maze. One steerable shot.<br>Hand over the keyboard when your turn ends.</p><button type="button" class="primary ready-button">Ready <span>ENTER ↗</span></button><div class="handoff-rules"><span><b>01</b> Fixed guns</span><span><b>02</b> Pilot your shot</span><span><b>03</b> First hit wins</span></div></div><div class="handoff-note">18 seconds of flight · WASD or arrow keys · Fixed players</div></div>
    <div class="modal-cover pause-screen" hidden><section class="dialog"><span class="eyebrow">TAKE YOUR TIME</span><h2>Paused</h2><p class="pause-reason">Your shot will wait.</p><button type="button" class="primary resume-button">Resume <span>ESC ↗</span></button></section></div>
    <div class="modal-cover end-screen" hidden><section class="dialog"><span class="eyebrow">DUEL COMPLETE</span><h2 class="winner-title"></h2><p class="winner-detail"></p><button type="button" class="primary rematch-button">Rematch <span>↗</span></button><small>Same maze. The other player opens.</small></section></div>
    <div class="modal-cover error-screen" hidden><section class="dialog"><span class="eyebrow">GRAPHICS UNAVAILABLE</span><h2>Let's get you back in.</h2><p class="error-detail"></p><button type="button" class="primary reload-button">Reload game <span>↗</span></button></section></div>
    <div class="keyboard-note">A desktop keyboard and landscape window are required to play.</div>
    <span class="screen-reader-status" role="status" aria-live="polite"></span>`;
  root.append(layer);
  const get = <T extends HTMLElement = HTMLElement>(selector: string): T => layer.querySelector<T>(selector)!;
  const on = (selector: string, action: () => void) => get(selector).addEventListener('click', () => { action(); root.focus({ preventScroll: true }); });
  on('.ready-button', () => { if (!session.paused && session.current.phase === 'handoff') session.command('ready'); });
  on('.fire-button', () => { if (!session.paused && session.current.phase === 'ready') session.command('fire'); });
  on('.pause-button', () => session.pause());
  on('.resume-button', () => session.resume());
  on('.rematch-button', () => session.rematch());
  on('.reload-button', () => location.reload());
  let signature = '';
  let error = false;
  return {
    update() {
      const s = session.current;
      layer.dataset.phase = s.phase; layer.dataset.seat = s.activePlayer;
      const changed = `${s.matchId}/${s.phase}/${session.paused}` !== signature;
      if (changed) {
        signature = `${s.matchId}/${s.phase}/${session.paused}`;
        get('.active-player').textContent = player(s.activePlayer);
        get('.phase-label').textContent = phaseLabel[s.phase];
        get('.match-id').textContent = `MATCH ${String(s.matchNumber).padStart(2, '0')} / TURN ${String(s.turnId).padStart(2, '0')}`;
        get('.handoff-screen').hidden = s.phase !== 'handoff';
        get('.handoff-screen h1').textContent = `${player(s.activePlayer)}, you're up.`;
        get('.seat-number').textContent = s.activePlayer === 'p1' ? '01' : '02';
        get('.ready-callout').hidden = s.phase !== 'ready';
        get('.pause-screen').hidden = !session.paused || error;
        get('.pause-reason').textContent = session.pauseReason === 'window lost focus' ? 'Paused — window lost focus. Resume when you are ready.' : 'Your shot will wait. Resume when you are ready.';
        get('.end-screen').hidden = s.phase !== 'gameOver' || error;
        get<HTMLButtonElement>('.pause-button').disabled = s.phase === 'gameOver' || session.paused || error;
        get('.winner-title').textContent = s.winner ? `${player(s.winner)} wins.` : '';
        get('.winner-detail').textContent = outcome(s);
        get('.result-toast').textContent = outcome(s);
        get('.result-toast').hidden = s.phase !== 'resolve';
        get('.screen-reader-status').textContent = `${player(s.activePlayer)}. ${phaseLabel[s.phase]}. ${outcome(s)}`;
        get('.telemetry').hidden = s.phase !== 'flight';
        get('.reticle').hidden = s.phase !== 'ready' && s.phase !== 'flight';
        get('.control-bar').hidden = s.phase === 'handoff' || s.phase === 'gameOver';
        get('.pilot-strip').hidden = s.phase === 'handoff';
      }
      if (s.projectile) {
        const remaining = Math.ceil((FLIGHT_TICKS - s.projectile.ageTicks) / SIM_HZ * 10) / 10;
        get('.time-value').innerHTML = `${remaining.toFixed(1)}<span>s</span>`;
        get('.speed-value').innerHTML = `${Math.hypot(s.projectile.velocity.x, s.projectile.velocity.z).toFixed(1)}<span>m/s</span>`;
      }
    },
    error(message: string) {
      error = true; get('.error-detail').textContent = message;
      get('.error-screen').hidden = false; get('.pause-screen').hidden = true; get('.end-screen').hidden = true;
    },
    dispose() { layer.remove(); },
  };
}
