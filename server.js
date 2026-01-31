const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT ? Number(process.env.PORT) : 5173;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.csv': 'text/csv; charset=utf-8',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function safePath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const joined = path.join(ROOT, cleanPath);
  const resolved = path.resolve(joined);
  if (!resolved.startsWith(path.resolve(ROOT))) return null;
  return resolved;
}

function injectLiveReload(html) {
  const snippet = `\n<script>\n(() => {\n  try {\n    const proto = location.protocol === 'https:' ? 'wss' : 'ws';\n    const ws = new WebSocket(proto + '://' + location.host + '/__ws');\n    ws.onmessage = (ev) => {\n      if (ev.data === 'reload') location.reload();\n    };\n  } catch (_) {}\n})();\n</script>\n`;

  if (html.includes('/__ws') || html.includes('__ws')) return html;
  const idx = html.lastIndexOf('</body>');
  if (idx !== -1) return html.slice(0, idx) + snippet + html.slice(idx);
  return html + snippet;
}

const server = http.createServer((req, res) => {
  // websocket upgrade path is handled via 'upgrade' event
  const urlPath = req.url === '/' ? '/histograms.html' : req.url;
  const filePath = safePath(urlPath);
  if (!filePath) return send(res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Forbidden');

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const ct = MIME[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err2, buf) => {
      if (err2) return send(res, 500, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Server error');

      let body = buf;
      if (ext === '.html') {
        body = Buffer.from(injectLiveReload(buf.toString('utf8')), 'utf8');
      }

      send(res, 200, {
        'Content-Type': ct,
        'Cache-Control': 'no-store',
      }, body);
    });
  });
});

// WebSocket server for live reload
const wss = new WebSocketServer({ noServer: true });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

server.on('upgrade', (req, socket, head) => {
  const url = req.url || '';
  if (!url.startsWith('/__ws')) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

function broadcastReload() {
  for (const ws of clients) {
    try { ws.send('reload'); } catch (_) {}
  }
}

// Watch files and broadcast reload
const WATCH_FILES = [
  path.join(ROOT, 'histograms.html'),
  path.join(ROOT, 'fourthDown_histograms.json'),
  path.join(ROOT, 'top5.json'),
];

for (const fp of WATCH_FILES) {
  try {
    fs.watch(fp, { persistent: true }, () => broadcastReload());
  } catch (e) {
    // ignore if file missing at startup
  }
}

server.listen(PORT, () => {
  console.log(`Dev server running: http://localhost:${PORT}/`);
  console.log('Live reload watching:');
  for (const fp of WATCH_FILES) console.log(' - ' + path.basename(fp));
});
