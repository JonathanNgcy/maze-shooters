import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { SIM_HZ } from '../src/shared/config';
import { MAX_CLIENT_MESSAGE_BYTES, MAX_SERVER_CATCHUP_TICKS } from '../src/shared/realtime';
import { createDuelAuthority } from './authority';
import type { DuelAuthorityOptions } from './authority';
import { createStaticHandler } from './static';

export type DuelServerOptions = DuelAuthorityOptions & {
  port?: number; host?: string; autoTick?: boolean;
  production?: boolean; staticRoot?: string; heartbeatIntervalMs?: number;
};

function capacity(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

/** CLI-only environment parsing leaves the library's local/test defaults explicit. */
export function serverOptionsFromEnvironment(env: NodeJS.ProcessEnv): DuelServerOptions {
  const production = env.NODE_ENV === 'production';
  const integer = (name: string, fallback: number): number => {
    const raw = env[name];
    if (raw === undefined) return fallback;
    if (!/^[0-9]+$/.test(raw)) throw new Error(`${name} must be an integer.`);
    return capacity(Number(raw), name);
  };
  const port = integer('PORT', 8787);
  if (port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const host = env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1');
  if (!host.trim() || host !== host.trim()) throw new Error('HOST must be a non-empty host address.');
  return {port, host, production,
    ...(production ? {staticRoot: fileURLToPath(new URL('../dist/', import.meta.url))} : {}),
    maxRooms: integer('MAX_ROOMS', production ? 16 : 128),
    maxConnections: integer('MAX_CONNECTIONS', production ? 32 : 256),
  };
}

/** Local by default; production explicitly serves only a built-assets root on the same origin. */
export async function createDuelServer(options: DuelServerOptions = {}) {
  if (options.production && !options.staticRoot) throw new Error('Production requires an explicit staticRoot.');
  const serveStatic = options.staticRoot ? await createStaticHandler(options.staticRoot) : null;
  const maxRooms = capacity(options.maxRooms ?? (options.production ? 16 : 128), 'maxRooms');
  const maxConnections = capacity(options.maxConnections ?? (options.production ? 32 : 256), 'maxConnections');
  const heartbeatIntervalMs = capacity(options.heartbeatIntervalMs ?? 30_000, 'heartbeatIntervalMs');
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)) throw new Error('port must be between 0 and 65535.');
  const authority = createDuelAuthority({...options, maxRooms, maxConnections});
  const now = options.now ?? (() => performance.now());
  const host = options.host ?? '127.0.0.1';
  const http = createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, {'allow': 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store'});
      response.end('Method not allowed'); return;
    }
    if (options.production && request.url === '/') {
      response.writeHead(302, {'location': '/?online=1', 'cache-control': 'no-store'});
      response.end(); return;
    }
    if (request.url === '/health') {
      response.writeHead(200, {'content-type': 'application/json', 'cache-control': 'no-store'});
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({status: 'ok'}));
    } else if (serveStatic) { void serveStatic(request, response); }
    else { response.writeHead(404, {'cache-control': 'no-store'}); response.end('Not found'); }
  });
  const sockets = new WebSocketServer({noServer: true, maxPayload: MAX_CLIENT_MESSAGE_BYTES});
  http.on('upgrade', (request, socket, head) => {
    if (request.url !== '/duel') { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return; }
    sockets.handleUpgrade(request, socket, head, connection => sockets.emit('connection', connection, request));
  });
  const alive = new WeakMap<WebSocket, boolean>();
  sockets.on('connection', socket => {
    alive.set(socket, true);
    socket.on('pong', () => alive.set(socket, true));
    const id = randomBytes(12).toString('hex');
    socket.on('close', () => authority.disconnect(id));
    socket.on('error', () => { /* Rejected/closing sockets can still receive malformed frames. */ });
    const connected = authority.connect({id,
      send(message) {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (socket.bufferedAmount > 256 * 1024) { socket.close(1013, 'Connection cannot keep up.'); return; }
        socket.send(JSON.stringify(message));
      },
      close(code, reason) {socket.close(code, reason);},
    });
    if (!connected) return;
    socket.on('message', (data, binary) => authority.receive(id, data.toString(), binary));
  });
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => reject(error);
    http.once('error', failed);
    http.listen(options.port ?? 8787, host, () => { http.removeListener('error', failed); resolve(); });
  });
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Could not determine server address.');
  let lastTime = now(), remainder = 0;
  const tickMs = 1000 / SIM_HZ;
  const timer = options.autoTick === false ? null : setInterval(() => {
    const time = now(); remainder += Math.max(0, time - lastTime); lastTime = time;
    const ticks = Math.floor((remainder + 1e-9) / tickMs);
    if (ticks > MAX_SERVER_CATCHUP_TICKS) { authority.failOverload(); remainder = 0; return; }
    if (ticks > 0) { authority.step(ticks); remainder = Math.max(0, remainder - ticks * tickMs); }
    else authority.checkDeadlines();
  }, 4);
  // A dead TCP peer otherwise keeps a seat and held input until the OS times out.
  const heartbeat = setInterval(() => {
    for (const socket of sockets.clients) {
      if (!alive.get(socket) || socket.readyState !== WebSocket.OPEN) { socket.terminate(); continue; }
      alive.set(socket, false);
      socket.ping(undefined, undefined, error => { if (error) socket.terminate(); });
    }
  }, heartbeatIntervalMs);
  heartbeat.unref();
  let closed = false;
  return {
    authority,
    address: {host, port: address.port, url: `ws://${host.includes(':') ? `[${host}]` : host}:${address.port}/duel`},
    async close(): Promise<void> {
      if (closed) return; closed = true;
      if (timer) clearInterval(timer);
      clearInterval(heartbeat);
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>(resolve => sockets.close(() => resolve()));
      await new Promise<void>(resolve => http.close(() => resolve()));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await createDuelServer(serverOptionsFromEnvironment(process.env));
  console.log(`Maze Shooters duel server: ${server.address.url}`);
  const stop = () => { void server.close().then(() => process.exit(0)); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
