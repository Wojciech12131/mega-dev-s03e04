// Tiny static server for local preview, no install needed. Usage: node scripts/serve.mjs [dir] [port]
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const dir = join(root, process.argv[2] ?? 'dist');
const port = Number(process.argv[3] ?? 4173);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webm': 'video/webm', '.mp4': 'video/mp4' };
createServer((req, res) => {
  const path = join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/\/$/, '/index.html')));
  if (!existsSync(path)) return res.writeHead(404).end('not found');
  res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(path));
}).listen(port, () => console.log(`serving ${dir} on http://localhost:${port}/`));
