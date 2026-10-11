#!/usr/bin/env node
// Sirve examples/repo como si fuera un repositorio remoto de cursos (catalogo.json + cursos/).
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'examples', 'repo');
const PORT = Number(process.env.PORT) || 8787;
const TYPES = { '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.sh': 'text/x-shellscript' };

function start(port = PORT) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = path.resolve(ROOT, '.' + rel);
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    fs.readFile(file, (err, data) => {
      const ok = !err;
      console.log(`${ok ? 200 : 404} ${rel}`);
      if (!ok) return res.writeHead(404).end('not found');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain; charset=utf-8' });
      res.end(data);
    });
  });
  server.listen(port, '127.0.0.1', () =>
    console.log(`Repositorio de ejemplo en http://localhost:${port}/catalogo.json  (Ctrl+C para parar)`)
  );
  return server;
}

module.exports = { start };
if (require.main === module) start();
