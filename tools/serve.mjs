// Zero-dependency static file server for local/LAN testing of the PWA.
// Usage: node tools/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { networkInterfaces } from 'node:os';

const root = resolve(process.cwd());
const port = Number(process.argv[2] || 8099);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    const target = join(root, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!target.startsWith(root + sep) && target !== root) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(target);
    const file = info.isDirectory()
      ? await readFile(join(target, 'index.html'))
      : await readFile(target);

    res.writeHead(200, {
      'Content-Type': TYPES[extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      // Service workers must not be served from a stale cache during testing.
      'Service-Worker-Allowed': '/'
    });
    res.end(file);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500).end(
      err.code === 'ENOENT' ? 'Not found' : 'Server error'
    );
  }
});

server.listen(port, '0.0.0.0', () => {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter(nic => nic && nic.family === 'IPv4' && !nic.internal)
    .map(nic => nic.address);

  console.log(`Serving ${root}`);
  console.log(`  Local:   http://localhost:${port}/`);
  addresses.forEach(address => console.log(`  Network: http://${address}:${port}/`));
});
