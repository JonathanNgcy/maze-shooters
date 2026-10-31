import { FLIGHT_TICKS, SIM_HZ } from '../shared/config';
import type { RealtimeSessionAPI, RoomOutcome } from '../shared/realtime';
import type { PlayerId } from '../shared/types';

export const playerName = (seat: PlayerId): string => seat === 'p1' ? 'Player 1' : 'Player 2';
export function onlineOutcomeText(outcome: RoomOutcome | null): string {
  if (!outcome) return '';
  if (outcome.cause === 'draw') return 'Draw — both players were hit at the same time.';
  if (outcome.cause === 'hit') return outcome.detail === 'self_hit'
    ? `${playerName(outcome.loser)} hit themselves. ${playerName(outcome.winner)} wins.`
    : `${playerName(outcome.winner)} wins — ${playerName(outcome.loser)} was hit.`;
  const reason = { leave: 'left the duel', disconnect: 'did not reconnect in time', ready_deadline: 'did not get ready in time' }[outcome.detail];
  return `${playerName(outcome.winner)} wins — ${playerName(outcome.loser)} ${reason}.`;
}

export function createOnlineHUD(root: HTMLElement, session: RealtimeSessionAPI) {
  const layer = document.createElement('div'); layer.className = 'hud online-hud';
  layer.innerHTML = `
    <header class="topbar"><div class="brand"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span>MAZE <b>SHOOTERS</b></span><span class="edition">ONLINE DUEL</span></div><div class="top-actions"><span class="online-room-label" hidden>ROOM <strong class="online-room-code"></strong></span><button type="button" class="quiet online-menu">Menu <kbd>Esc</kbd></button><a class="quiet online-offline-link" href="./?offline=1">Offline hotseat ↗</a></div></header>
    <div class="pilot-strip online-pilot" hidden><span class="seat-dot"></span><strong class="online-player"></strong><span class="separator"></span><span class="online-phase"></span></div>
    <div class="online-network" role="status" aria-live="polite" hidden><span class="online-network-message"></span><button type="button" class="quiet online-retry">Retry connection</button></div>
    <div class="telemetry online-telemetry" hidden aria-label="Your missile information"><div><span class="metric-label">TIME LEFT</span><strong class="online-time">18.0<span>s</span></strong></div><div><span class="metric-label">SPEED</span><strong class="online-speed">0.0<span>m/s</span></strong></div></div>
    <div class="reticle online-reticle" hidden aria-hidden="true"></div>
    <div class="ready-callout online-launch" hidden><span class="eyebrow">BOTH PLAYERS CAN FIRE</span><h2>Your gun is ready.</h2><p>Fire, then pilot your own missile.<br>Your opponent can launch at any time.<span class="online-touch-help">Touch: hold the on-screen thrust and turn buttons.</span></p><button type="button" class="primary online-fire">Fire <span>SPACE ↗</span></button></div>
    <div class="online-touch-controls" role="group" aria-label="Missile touch controls" hidden><span class="online-touch-hint">Touch: hold thrust + turn. Release to coast.</span><div class="online-touch-pair" role="group" aria-label="Turn"><button type="button" class="online-touch-button online-touch-left" data-online-control="left" aria-label="Turn left" aria-pressed="false"><span aria-hidden="true">←</span><small>Left</small></button><button type="button" class="online-touch-button online-touch-right" data-online-control="right" aria-label="Turn right" aria-pressed="false"><span aria-hidden="true">→</span><small>Right</small></button></div><div class="online-touch-pair" role="group" aria-label="Thrust"><button type="button" class="online-touch-button online-touch-reverse" data-online-control="reverse" aria-label="Reverse thrust" aria-pressed="false"><span aria-hidden="true">↓</span><small>Reverse</small></button><button type="button" class="online-touch-button online-touch-forward" data-online-control="forward" aria-label="Thrust forward" aria-pressed="false"><span aria-hidden="true">↑</span><small>Thrust</small></button></div></div>
    <div class="result-toast online-result" role="status" aria-live="polite" hidden></div>
    <div class="online-opponent" hidden></div>
    <footer class="control-bar online-controls" hidden><div class="keys"><span><kbd>W/↑</kbd><kbd>S/↓</kbd> Thrust / reverse</span><span><kbd>A/←</kbd><kbd>D/→</kbd> Rotate</span><span class="coast-help">Release to coast</span></div><span class="risk-copy">Hit yourself and you lose.</span></footer>
    <div class="curtain online-lobby"><div class="handoff-grid" aria-hidden="true"></div><section class="online-lobby-content"><span class="eyebrow">TWO BROWSERS · ONE DUEL</span><h1>Fire together.<br>Find them first.</h1><p>Two fixed players. One missile each.<br>Create a private room and share its code with a friend.</p><div class="online-room-entry"><button type="button" class="primary online-create">Create room <span>↗</span></button><span class="online-or">OR JOIN A FRIEND</span><form class="online-join-form"><label for="online-code">Room code</label><div><input id="online-code" class="online-join-code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="6" placeholder="ABC234" aria-label="Room code"><button type="submit" class="quiet online-join">Join room ↗</button></div></form></div><small><span class="online-keyboard-help">WASD or arrows to steer.</span><span class="online-touch-help">Touch controls for thrust and turning.</span> No turns. First player hit loses.</small></section></div>
    <div class="modal-cover online-waiting" hidden><section class="dialog"><span class="eyebrow">PRIVATE ROOM <span class="online-wait-code"></span></span><h2>Get both players ready.</h2><p>Share the room code. Once both players are ready, you can each fire independently.</p><div class="online-seat-list"><div class="online-seat-p1"></div><div class="online-seat-p2"></div></div><button type="button" class="primary online-ready">Ready <span>ENTER ↗</span></button><p class="online-ready-note"></p><button type="button" class="quiet online-wait-leave">Leave room</button></section></div>
    <div class="modal-cover online-suspend" hidden><section class="dialog"><span class="eyebrow">CONTROLS SUSPENDED</span><h2>Duel continues.</h2><p>This menu stops your controls. The server keeps both missiles and the match clock running.</p><button type="button" class="primary online-resume">Resume controls <span>ESC ↗</span></button><button type="button" class="quiet online-menu-leave">Leave room</button></section></div>
    <div class="modal-cover online-ended" hidden><section class="dialog"><span class="eyebrow">DUEL COMPLETE</span><h2 class="online-end-title"></h2><p class="online-end-detail"></p><button type="button" class="primary online-rematch">Request rematch <span>↗</span></button><p class="online-rematch-note">Both players must request a rematch.</p><button type="button" class="quiet online-end-leave">Leave room</button></section></div>
    <div class="modal-cover online-graphics-error" hidden><section class="dialog"><span class="eyebrow">GRAPHICS UNAVAILABLE</span><h2>Reload to restore the maze.</h2><p class="online-error-detail"></p><p>The online duel continues on the server.</p><button type="button" class="primary online-reload">Reload game <span>↗</span></button></section></div>
    <span class="screen-reader-status online-status" role="status" aria-live="polite"></span>`;
  root.append(layer);
  const get = <T extends HTMLElement = HTMLElement>(selector: string) => layer.querySelector<T>(selector)!;
  const on = (selector: string, action: () => void) => get(selector).addEventListener('click', () => { action(); root.focus({ preventScroll: true }); });
  on('.online-create', () => session.createRoom());
  on('.online-ready', () => { if (!get<HTMLButtonElement>('.online-ready').disabled) session.ready(); });
  on('.online-fire', () => { if (!get<HTMLButtonElement>('.online-fire').disabled) session.fire(); });
  on('.online-menu', () => session.suspendControls());
  on('.online-resume', () => session.resumeControls());
  on('.online-retry', () => session.reconnect());
  on('.online-rematch', () => { if (!get<HTMLButtonElement>('.online-rematch').disabled) session.rematch(); });
  on('.online-wait-leave', () => session.leave()); on('.online-menu-leave', () => session.leave()); on('.online-end-leave', () => session.leave());
  on('.online-reload', () => location.reload());
  get<HTMLFormElement>('.online-join-form').addEventListener('submit', (event) => { event.preventDefault(); const code = get<HTMLInputElement>('.online-join-code').value.trim().toUpperCase(); if (code) { session.joinRoom(code); root.focus({ preventScroll: true }); } });
  let signature = '', fatalError = false;
  const text = (selector: string, value: string) => { const element = get(selector); if (element.textContent !== value) element.textContent = value; };
  return {
    update() {
      const room = session.snapshot, seat = session.seat, state = room?.state;
      const own = seat && state?.shots[seat], otherSeat = seat === 'p1' ? 'p2' : 'p1';
      const connected = session.connection === 'connected';
      const playing = !!room && room.status === 'playing' && !!state;
      const waiting = !!room && room.status === 'waiting' && !!seat;
      const ended = !!room && ['ended', 'abandoned', 'error'].includes(room.status);
      const nextSignature = `${room?.roomId}/${room?.revision}/${session.connection}/${session.message}/${session.controlsSuspended}/${seat}`;
      layer.dataset.seat = seat ?? 'p1'; layer.dataset.phase = state?.phase ?? room?.status ?? 'lobby';
      layer.dataset.ownPhase = own?.phase ?? 'waiting'; layer.dataset.roomStatus = room?.status ?? 'idle';
      if (nextSignature !== signature) {
        signature = nextSignature;
        get('.online-lobby').hidden = !!room;
        get('.online-waiting').hidden = !waiting || fatalError;
        get('.online-ended').hidden = !ended || fatalError;
        get('.online-suspend').hidden = !session.controlsSuspended || !playing || ended || fatalError;
        get('.online-room-label').hidden = !room;
        text('.online-room-code', room?.code ?? ''); text('.online-wait-code', room?.code ?? '');
        get<HTMLButtonElement>('.online-create').disabled = session.connection === 'connecting' || session.connection === 'reconnecting';
        get<HTMLButtonElement>('.online-join').disabled = session.connection === 'connecting' || session.connection === 'reconnecting';
        get('.online-network').hidden = !['connecting', 'reconnecting', 'closed', 'error'].includes(session.connection) && (!session.message || session.message === 'Connected' || session.connection === 'idle');
        get('.online-menu').hidden = !playing;
        text('.online-network-message', session.message || ({ connecting: 'Connecting to the duel server…', reconnecting: 'Reconnecting — the duel continues on the server.', closed: 'Connection closed.', error: 'Could not connect to the duel server.' }[session.connection as 'connecting' | 'reconnecting' | 'closed' | 'error'] ?? ''));
        get('.online-retry').hidden = !['closed', 'error', 'reconnecting'].includes(session.connection);
        get('.online-pilot').hidden = !playing;
        text('.online-player', seat ? `${playerName(seat)} · you` : '');
        text('.online-phase', !connected ? 'Connection interrupted' : state?.phase === 'resolve' ? 'Duel resolving' : own?.phase === 'flight' ? 'Your missile in flight' : own?.phase === 'resolve' ? 'Shot resolved' : 'Your gun is ready');
        get('.online-launch').hidden = !playing || state?.phase !== 'playing' || own?.phase !== 'ready' || session.controlsSuspended;
        get<HTMLButtonElement>('.online-fire').disabled = !connected || !playing || state?.phase !== 'playing' || own?.phase !== 'ready' || session.controlsSuspended;
        get('.online-touch-controls').hidden = !connected || !playing || state?.phase !== 'playing' || own?.phase !== 'flight' || session.controlsSuspended || fatalError;
        get('.online-telemetry').hidden = !playing || own?.phase !== 'flight';
        get('.online-reticle').hidden = !playing || state?.phase !== 'playing' || own?.phase === 'resolve';
        get('.online-controls').hidden = !playing;
        get('.online-opponent').hidden = !playing;
        text('.online-opponent', `${playerName(otherSeat)} · ${state?.shots[otherSeat].phase === 'flight' ? 'missile in flight' : state?.shots[otherSeat].phase === 'resolve' ? 'shot resolving' : 'gun ready'}`);
        for (const id of ['p1', 'p2'] as const) {
          const s = room?.seats[id];
          text(`.online-seat-${id}`, `${playerName(id)}${id === seat ? ' · you' : ''} — ${!s?.connected ? 'waiting for connection' : !s.compatible ? 'checking maze' : s.ready ? 'ready' : 'connected'}`);
        }
        const ownSeat = seat && room?.seats[seat];
        get<HTMLButtonElement>('.online-ready').disabled = !connected || !waiting || !ownSeat || !ownSeat.compatible || ownSeat.ready;
        text('.online-ready', ownSeat?.ready ? 'Ready — waiting for your opponent' : 'Ready');
        text('.online-ready-note', ownSeat?.ready ? 'Your controls will be yours alone when the duel starts.' : 'Choose Ready when you have the keyboard.');
        const outcome = room?.outcome ?? state?.outcome ?? null;
        text('.online-end-title', outcome?.cause === 'draw' ? 'Draw.' : outcome?.winner ? `${playerName(outcome.winner)} wins.` : room?.status === 'abandoned' ? 'Room abandoned.' : 'Duel ended.');
        text('.online-end-detail', onlineOutcomeText(outcome) || 'The room is no longer active.');
        get<HTMLButtonElement>('.online-rematch').disabled = !connected || room?.status !== 'ended' || !seat || !!room.seats[seat].rematch;
        text('.online-rematch', seat && room?.seats[seat].rematch ? 'Rematch requested' : 'Request rematch');
        text('.online-rematch-note', room?.seats[otherSeat].rematch ? 'Your opponent requested a rematch.' : 'Both players must request a rematch.');
        let result = '';
        if (state?.outcome) result = onlineOutcomeText(state.outcome);
        else if (own?.phase === 'resolve' && own.result) result = own.result.reason === 'wall' ? 'Wall hit. Your gun will be ready again shortly.' : own.result.reason === 'timeout' ? 'Time up. Your gun will be ready again shortly.' : '';
        text('.online-result', result); get('.online-result').hidden = !result || ended;
        text('.online-status', `${seat ? playerName(seat) : 'Online duel'}. ${waiting ? 'Waiting for both players to get ready.' : ended ? onlineOutcomeText(outcome) : state?.phase === 'resolve' ? result : ''}`);
      }
      if (own?.projectile) {
        get('.online-time').innerHTML = `${(Math.ceil(Math.max(0, FLIGHT_TICKS - own.projectile.ageTicks) / SIM_HZ * 10) / 10).toFixed(1)}<span>s</span>`;
        get('.online-speed').innerHTML = `${Math.hypot(own.projectile.velocity.x, own.projectile.velocity.z).toFixed(1)}<span>m/s</span>`;
      }
    },
    error(message: string) { fatalError = true; text('.online-error-detail', message); get('.online-graphics-error').hidden = false; get('.online-touch-controls').hidden = true; get('.online-suspend').hidden = true; get('.online-ended').hidden = true; get('.online-waiting').hidden = true; },
    dispose() { layer.remove(); },
  };
}
