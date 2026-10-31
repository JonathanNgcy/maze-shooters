import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDuelServer, serverOptionsFromEnvironment } from '../../server/index';

const running: Awaited<ReturnType<typeof createDuelServer>>[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const server of running.splice(0)) await server.close();
  for (const directory of directories.splice(0)) await rm(directory, {recursive: true, force: true});
});
async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'maze-static-')); directories.push(parent);
  const root = join(parent, 'dist'); await mkdir(join(root, 'assets'), {recursive: true});
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Built maze</title><script src="/assets/entry-Abcd1234.js"></script>');
  await writeFile(join(root, 'assets', 'entry-Abcd1234.js'), 'console.log("local build");');
  await writeFile(join(root, 'assets', 'entry-Abcd1234.css'), 'body{color:white}');
  await writeFile(join(root, 'assets', 'logo.svg'), '<svg></svg>');
  await writeFile(join(root, 'assets', 'third-party-licenses.txt'), 'Third-party MIT notices');
  await writeFile(join(parent, 'secret.js'), 'private source');
  await symlink(join(parent, 'secret.js'), join(root, 'assets', 'escape-Abcd1234.js'));
  const server = await createDuelServer({production: true, staticRoot: root, port: 0, autoTick: false}); running.push(server);
  return {root, server};
}
function get(server: Awaited<ReturnType<typeof createDuelServer>>, path: string, method = 'GET') {
  return new Promise<{status: number; headers: import('node:http').IncomingHttpHeaders; body: string}>((resolve, reject) => {
    const outgoing = request({host: server.address.host, port: server.address.port, path, method}, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', chunk => {body += chunk;});
      response.on('end', () => resolve({status: response.statusCode!, headers: response.headers, body}));
    });
    outgoing.on('error', reject); outgoing.end();
  });
}

describe('production built-assets HTTP host', () => {
  it('serves the built entry/query, exact JS/CSS MIME and correct index/hashed cache policy', async () => {
    const {server} = await fixture();
    for (const method of ['GET', 'HEAD']) {
      const redirected = await get(server, '/', method);
      expect(redirected.status).toBe(302); expect(redirected.headers.location).toBe('/?online=1'); expect(redirected.headers['cache-control']).toBe('no-store'); expect(redirected.body).toBe('');
    }
    for (const path of ['/?online=1', '/?offline=1', '/index.html']) {
      const page = await get(server, path); expect(page.status).toBe(200); expect(page.body).toContain('Built maze');
      expect(page.headers['content-type']).toBe('text/html; charset=utf-8'); expect(page.headers['cache-control']).toBe('no-store');
    }
    const script = await get(server, '/assets/entry-Abcd1234.js?v=1');
    expect(script).toMatchObject({status: 200, body: 'console.log("local build");'});
    expect(script.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(script.headers['cache-control']).toBe('public, max-age=31536000, immutable'); expect(script.headers['x-content-type-options']).toBe('nosniff');
    expect((await get(server, '/assets/entry-Abcd1234.css')).headers['content-type']).toBe('text/css; charset=utf-8');
    const logo = await get(server, '/assets/logo.svg'); expect(logo.headers['content-type']).toBe('image/svg+xml'); expect(logo.headers['cache-control']).toBe('no-store');
    const notices = await get(server, '/assets/third-party-licenses.txt'); expect(notices.body).toBe('Third-party MIT notices'); expect(notices.headers['content-type']).toBe('text/plain; charset=utf-8');
    const head = await get(server, '/assets/entry-Abcd1234.js', 'HEAD'); expect(head.status).toBe(200); expect(head.body).toBe(''); expect(Number(head.headers['content-length'])).toBe(Buffer.byteLength(script.body));
    expect(await get(server, '/health')).toMatchObject({status: 200, body: '{"status":"ok"}'});
  });
  it('rejects raw/encoded traversal, symlink escape, missing assets and unsupported methods without an index fallback', async () => {
    const {server} = await fixture();
    for (const path of ['/../secret.js', '/assets/%2e%2e/%2e%2e/secret.js', '/assets/%2e%2e%2fsecret.js', '/assets/..\\secret.js', '/assets/%00.js', '/assets/%ZZ.js']) {
      const result = await get(server, path); expect(result.status, path).toBe(400); expect(result.body).not.toContain('private source');
    }
    for (const path of ['/src/main.ts', '/package.json', '/assets/missing-Abcd1234.js', '/assets/escape-Abcd1234.js', '/assets/', '/duel', '/unknown']) {
      const result = await get(server, path); expect(result.status, path).toBe(404); expect(result.body).not.toContain('Built maze'); expect(result.body).not.toContain('private source');
    }
    for (const method of ['POST', 'PUT', 'DELETE']) {const result = await get(server, '/', method); expect(result.status).toBe(405); expect(result.headers.allow).toBe('GET, HEAD');}
  });
  it('requires an explicit built root in production and keeps default development HTTP behavior', async () => {
    await expect(createDuelServer({production: true, port: 0})).rejects.toThrow(/staticRoot/);
    await expect(createDuelServer({staticRoot: 'dist', port: 0})).rejects.toThrow(/absolute/);
    const server = await createDuelServer({port: 0, autoTick: false}); running.push(server);
    expect((await get(server, '/')).status).toBe(404); expect((await get(server, '/health')).status).toBe(200);
    for (const options of [{maxRooms: 0}, {maxConnections: NaN}, {heartbeatIntervalMs: -1}, {port: 65536}]) await expect(createDuelServer({...options, autoTick: false})).rejects.toThrow();
  });
});

describe('production CLI configuration', () => {
  it('defaults to the small demo capacity/public bind only when production is explicit', () => {
    expect(serverOptionsFromEnvironment({})).toEqual({port: 8787, host: '127.0.0.1', production: false, maxRooms: 128, maxConnections: 256});
    expect(serverOptionsFromEnvironment({NODE_ENV: 'production'})).toMatchObject({port: 8787, host: '0.0.0.0', production: true, maxRooms: 16, maxConnections: 32});
    expect(serverOptionsFromEnvironment({NODE_ENV: 'production'}).staticRoot).toMatch(/\/dist\/$/);
    expect(serverOptionsFromEnvironment({NODE_ENV: 'production', PORT: '10000', MAX_ROOMS: '4', MAX_CONNECTIONS: '8', HOST: '127.0.0.1'})).toMatchObject({port: 10000, host: '127.0.0.1', maxRooms: 4, maxConnections: 8});
  });
  it('rejects malformed, non-finite, fractional, negative and zero capacity/port values before listen', () => {
    for (const key of ['MAX_ROOMS', 'MAX_CONNECTIONS', 'PORT']) for (const value of ['', 'NaN', 'Infinity', '-1', '0', '1.5', '1e2', '9007199254740992']) expect(() => serverOptionsFromEnvironment({[key]: value}), `${key}=${value}`).toThrow();
    expect(() => serverOptionsFromEnvironment({PORT: '65536'})).toThrow(); expect(() => serverOptionsFromEnvironment({HOST: ' '})).toThrow();
  });
});
