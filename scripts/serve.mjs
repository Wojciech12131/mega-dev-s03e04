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
  const body = readFileSync(path);
  const head = { 'content-type': types[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store', 'accept-ranges': 'bytes' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? ''); // video seeking needs Range
  if (range) {
    const start = range[1] ? Number(range[1]) : body.length - Number(range[2]);
    const end = range[1] && range[2] ? Number(range[2]) : body.length - 1;
    res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${body.length}` });
    return res.end(body.subarray(start, end + 1));
  }
  res.writeHead(200, head);
  res.end(body);
}).listen(port, () => console.log(`serving ${dir} on http://localhost:${port}/`));
