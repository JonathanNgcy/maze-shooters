import { MAX_CLIENT_MESSAGE_BYTES } from '../shared/realtime';
import type { ClientMessage } from '../shared/realtime';
import { validMask } from '../shared/math';

export class ProtocolError extends Error {
  readonly code: 'BAD_MESSAGE' | 'TOO_LARGE';
  constructor(code: 'BAD_MESSAGE' | 'TOO_LARGE', message = 'Invalid client message.') { super(message); this.code = code; }
}
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const requestId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);

/** Exact intent-only schemas. Identity, positions, outcomes and extra keys are rejected. */
export function parseClientMessage(raw: string): ClientMessage {
  if (typeof raw !== 'string') throw new ProtocolError('BAD_MESSAGE');
  if (new TextEncoder().encode(raw).byteLength > MAX_CLIENT_MESSAGE_BYTES) throw new ProtocolError('TOO_LARGE', 'Client message exceeds the size limit.');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new ProtocolError('BAD_MESSAGE'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ProtocolError('BAD_MESSAGE');
  const value = parsed as Record<string, unknown>;
  if (value.v !== 2 || typeof value.type !== 'string') throw new ProtocolError('BAD_MESSAGE');
  const exact = (...keys: string[]) => {
    const allowed = ['v', 'type', ...keys];
    return Object.keys(value).length === allowed.length && allowed.every(key => Object.hasOwn(value, key));
  };
  let valid = false;
  switch (value.type) {
    case 'create': valid = exact('requestId') && requestId(value.requestId); break;
    case 'join': valid = exact('requestId', 'code') && requestId(value.requestId) && typeof value.code === 'string' && /^[A-Z2-9]{6}$/.test(value.code); break;
    case 'resume': valid = exact('requestId', 'token') && requestId(value.requestId) && typeof value.token === 'string' && /^[A-Za-z0-9_-]{32}$/.test(value.token); break;
    case 'compatible': valid = exact('seq', 'rulesVersion', 'mapId', 'mapVersion') && positive(value.seq) && positive(value.rulesVersion) && identifier(value.mapId) && positive(value.mapVersion); break;
    case 'ready': case 'leave': valid = exact('seq') && positive(value.seq); break;
    case 'fire': case 'rematch': valid = exact('seq', 'matchId') && positive(value.seq) && identifier(value.matchId); break;
    case 'input': valid = exact('seq', 'matchId', 'shotId', 'mask') && positive(value.seq) && identifier(value.matchId) && positive(value.shotId) && typeof value.mask === 'number' && validMask(value.mask); break;
    case 'ping': valid = exact('seq', 'clientTimeMs') && positive(value.seq) && typeof value.clientTimeMs === 'number' && Number.isFinite(value.clientTimeMs) && value.clientTimeMs >= 0; break;
  }
  if (!valid) throw new ProtocolError('BAD_MESSAGE');
  return value as ClientMessage;
}
