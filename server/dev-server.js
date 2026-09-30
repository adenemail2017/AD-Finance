/**
 * Zero-dependency static + API dev server for AD-Finance.
 * Serves the PWA with correct MIME types, no-cache for app code (so edits are
 * picked up instantly) and optional /api/sync passthrough when the API server
 * (server/server.js) is running.
 *
 *   node server/dev-server.js [port]      → http://localhost:4173
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function safeJoin(base, target) {
  const path = normalize(join(base, target));
  return path.startsWith(base) ? path : null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  // --- optional API passthrough -------------------------------------------
  if (pathname.startsWith('/api/')) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: false,
      hint: 'API server terpisah. Jalankan `node server/server.js` (default :8787) atau kosongkan endpoint sinkronisasi di Settings.',
    }));
    return;
  }

  if (pathname === '/') pathname = '/index.html';
  // SPA deep links fall back to the shell
  const isAppRoute = !extname(pathname);
  const filePath = safeJoin(ROOT, isAppRoute ? '/index.html' : pathname);

  try {
    if (!filePath) throw new Error('Invalid path');
    const info = await stat(filePath);
    if (info.isDirectory()) throw new Error('Directory');
    const body = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();

    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    };

    const isAppCode = ['.html', '.js', '.mjs', '.css', '.webmanifest'].includes(ext) || pathname === '/sw.js';
    headers['Cache-Control'] = isAppCode ? 'no-cache, must-revalidate' : 'public, max-age=3600';

    if (pathname === '/sw.js') {
      headers['Service-Worker-Allowed'] = '/';
      headers['Cache-Control'] = 'no-cache';
    }

    res.writeHead(200, headers);
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 — tidak ditemukan');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  AD-Finance — dev server`);
  console.log(`  ➜  http://localhost:${PORT}`);
  console.log(`  ➜  root: ${ROOT}`);
  console.log('  (Static PWA: semua data keuangan tetap tersimpan lokal di browser)\n');
});
