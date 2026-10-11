#!/usr/bin/env node
// Levanta el repositorio de ejemplo y abre el editor con la extensión sobre examples/workspace.
const { spawnSync } = require('child_process');
const path = require('path');
const { start } = require('./serve-examples');

const server = start();
const ide = spawnSync(process.execPath, [path.join(__dirname, 'ide.js'), 'example'], { stdio: 'inherit' });
if (ide.status !== 0) {
  server.close();
  process.exit(ide.status ?? 1);
}
console.log('Editor lanzado. Deja esta terminal abierta mientras pruebas las descargas.');
