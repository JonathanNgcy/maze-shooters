import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, sep } from 'node:path';

const mime: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
};

/** Only the built entry and asset directory are public; there is no source-tree or SPA fallback. */
export async function createStaticHandler(directory: string) {
  if (!isAbsolute(directory)) throw new Error('staticRoot must be an absolute built-assets directory.');
  const root = await realpath(directory);
  if (!(await stat(root)).isDirectory() || !(await stat(join(root, 'index.html'))).isFile()) throw new Error('staticRoot must contain a built index.html.');
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const send = (status: number, body: string) => {
      response.writeHead(status, {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    const target = request.url?.split('?', 1)[0] ?? '';
    let pathname: string;
    try { pathname = decodeURIComponent(target); }
    catch { send(400, 'Bad request'); return; }
    if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part === '.' || part === '..')) { send(400, 'Bad request'); return; }
    const index = pathname === '/' || pathname === '/index.html';
    if (!index && (!pathname.startsWith('/assets/') || pathname.split('/').slice(2).some(part => !part || part.startsWith('.') || !/^[\w.-]+$/.test(part)))) { send(404, 'Not found'); return; }
    const contentType = index ? 'text/html; charset=utf-8' : mime[extname(pathname)];
    if (!contentType) { send(404, 'Not found'); return; }
    try {
      const file = await realpath(join(root, index ? 'index.html' : pathname.slice(1)));
      const fromRoot = relative(root, file);
      if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) { send(404, 'Not found'); return; }
      if (!(await stat(file)).isFile()) { send(404, 'Not found'); return; }
      const body = await readFile(file);
      const hashed = !index && /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/i.test(pathname);
      response.writeHead(200, {'content-type': contentType, 'content-length': body.length, 'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-store', 'x-content-type-options': 'nosniff'});
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      send(code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' ? 404 : 500, code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' ? 'Not found' : 'Could not read built asset');
    }
  };
}
